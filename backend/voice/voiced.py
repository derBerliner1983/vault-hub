#!/usr/bin/env python3
"""
Vault-Hub Voice-Daemon – lokal & kostenlos.

Ein schlanker HTTP-Dienst (nur Python-Standardbibliothek als Server) für
Spracherkennung (STT) und Sprachausgabe (TTS):

  * STT:  faster-whisper (Whisper lokal, multilingual inkl. Deutsch/Englisch/Thai)
  * TTS:  Piper   (Deutsch, Englisch, … – schnell & leicht)
          Kokoro  (Englisch u.a. – sehr hohe Qualität; KEIN Deutsch/Thai)

Die Stimme wird als "<engine>:<voice>" adressiert, z.B. "piper:de_DE-thorsten-medium"
oder "kokoro:am_michael". Ohne Präfix = Piper. Es werden KEINE Daten in die Cloud
geschickt.

Endpunkte:
  GET  /health                         -> {ok, stt, tts, model, catalog, ...}
  GET  /voices                         -> Stimmen-Katalog je Sprache (+ installiert)
  POST /transcribe?lang=de&model=base  -> Body: int16le 16 kHz mono -> {text, lang}
  POST /tts?lang=de&voice=<engine:id>  -> Body: UTF-8 Text          -> audio/wav
"""
import io
import os
import collections
import re
import json
import time
import wave
import base64
import shutil
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("VOICE_PORT", "11435"))
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "auto")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
CACHE = os.environ.get("VOICE_CACHE", os.path.expanduser("~/.cache/vault-hub-voice"))
os.makedirs(CACHE, exist_ok=True)
# HuggingFace-Downloads (Whisper, Qwen) in den Voice-Cache lenken, damit die
# Cache-Verwaltung alles an einem Ort findet und löschen kann.
os.environ.setdefault("HF_HOME", os.path.join(CACHE, "hf"))

# ── Piper-Stimmen (rhasspy/piper-voices) ─────────────────────────────────────────
PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
PIPER_VOICES = {
    "de": [
        {"id": "de_DE-thorsten-medium", "label": "Thorsten (mittel)", "rel": "de/de_DE/thorsten/medium/de_DE-thorsten-medium"},
        {"id": "de_DE-thorsten-high",   "label": "Thorsten (hoch)",   "rel": "de/de_DE/thorsten/high/de_DE-thorsten-high"},
        {"id": "de_DE-eva_k-x_low",     "label": "Eva",               "rel": "de/de_DE/eva_k/x_low/de_DE-eva_k-x_low"},
        {"id": "de_DE-kerstin-low",     "label": "Kerstin",           "rel": "de/de_DE/kerstin/low/de_DE-kerstin-low"},
        {"id": "de_DE-karlsson-low",    "label": "Karlsson",          "rel": "de/de_DE/karlsson/low/de_DE-karlsson-low"},
    ],
    "en": [
        {"id": "en_US-amy-medium",    "label": "Amy (US)",    "rel": "en/en_US/amy/medium/en_US-amy-medium"},
        {"id": "en_US-lessac-medium", "label": "Lessac (US)", "rel": "en/en_US/lessac/medium/en_US-lessac-medium"},
        {"id": "en_GB-alan-medium",   "label": "Alan (GB)",   "rel": "en/en_GB/alan/medium/en_GB-alan-medium"},
    ],
    "th": [],
}
PIPER_REL = {v["id"]: v["rel"] for langs in PIPER_VOICES.values() for v in langs}

# ── Kokoro-Stimmen (nur Sprachen, die Kokoro kann – KEIN Deutsch/Thai) ───────────
KOKORO_ONNX_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
KOKORO_VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
KOKORO_VOICES = {
    "en": [
        {"id": "af_heart",   "label": "Heart (US)"},
        {"id": "af_bella",   "label": "Bella (US)"},
        {"id": "am_michael", "label": "Michael (US)"},
        {"id": "am_adam",    "label": "Adam (US)"},
        {"id": "bf_emma",    "label": "Emma (GB)"},
        {"id": "bm_george",  "label": "George (GB)"},
    ],
}

# ── Qwen3-TTS (optional, schwer: PyTorch; sehr gute Qualität inkl. DEUTSCH) ───────
# Wird nur genutzt, wenn `qwen-tts` installiert ist (install.sh --voice-qwen).
# Kein Thai (Qwen unterstützt: zh,en,ja,ko,de,fr,ru,pt,es,it).
QWEN_MODEL = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
QWEN_LANG = {"de": "German", "en": "English"}
QWEN_SPEAKERS = ["Ryan", "Serena", "Vivian", "Dylan", "Eric", "Aiden"]
QWEN_VOICES = {
    "de": [{"id": s, "label": s} for s in QWEN_SPEAKERS],
    "en": [{"id": s, "label": s} for s in QWEN_SPEAKERS],
}

_whisper = {}   # size -> WhisperModel
_piper = {}     # voice_id -> PiperVoice
_kokoro = None  # Kokoro-Instanz
_qwen = None    # Qwen3TTSModel-Instanz
_qwen_loading = False  # läuft gerade ein Qwen-Modell-Download/Ladevorgang?
_qwen_error = ""       # letzte Fehlermeldung beim Qwen-Laden (für die GUI)
QWEN_EST_BYTES = 3_800_000_000  # grober Richtwert (~3,8 GB) für die Fortschrittsanzeige


_LOG_RING = collections.deque(maxlen=200)


def log(*a):
    line = " ".join(str(x) for x in a)
    _LOG_RING.append(time.strftime("%H:%M:%S ") + line)
    print("[voiced]", line, flush=True)


def _download(url: str, dest: str):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    log(f"lade herunter: {os.path.basename(dest)}")
    tmp = dest + ".part"
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, dest)


# ── STT: faster-whisper (je Modellgröße gecacht) ─────────────────────────────────
def get_whisper(size: str):
    size = size or DEFAULT_MODEL
    if size not in _whisper:
        from faster_whisper import WhisperModel  # type: ignore
        log(f"lade Whisper-Modell '{size}' (device={WHISPER_DEVICE}, compute={WHISPER_COMPUTE})")
        _whisper[size] = WhisperModel(size, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
        log(f"Whisper '{size}' bereit")
    return _whisper[size]


def transcribe(pcm: bytes, lang: str, size: str) -> str:
    import numpy as np  # type: ignore
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    if audio.size == 0:
        return ""
    model = get_whisper(size)
    # beam_size=5 deutlich genauer als greedy (1); temperature=0 stabil;
    # language erzwungen (kein Fehl-Erkennen der Sprache).
    segments, _info = model.transcribe(
        audio, language=lang or None, beam_size=5, best_of=5, temperature=0.0,
        vad_filter=True, condition_on_previous_text=False,
    )
    return "".join(s.text for s in segments).strip()


# ── TTS: Piper ───────────────────────────────────────────────────────────────────
def _piper_paths(voice_id: str):
    return os.path.join(CACHE, voice_id + ".onnx"), os.path.join(CACHE, voice_id + ".onnx.json")


def get_piper(voice_id: str):
    if voice_id in _piper:
        return _piper[voice_id]
    rel = PIPER_REL.get(voice_id)
    if not rel:
        _piper[voice_id] = None
        return None
    from piper import PiperVoice  # type: ignore
    onnx, conf = _piper_paths(voice_id)
    _download(f"{PIPER_BASE}/{rel}.onnx", onnx)
    _download(f"{PIPER_BASE}/{rel}.onnx.json", conf)
    voice = PiperVoice.load(onnx, config_path=conf)
    _piper[voice_id] = voice
    log(f"Piper-Stimme geladen: {voice_id}")
    return voice


def _chunk_pcm_bytes(ch) -> bytes:
    """PCM-16LE aus einem Piper-AudioChunk holen (verschiedene API-Versionen)."""
    if hasattr(ch, "audio_int16_bytes"):
        return ch.audio_int16_bytes
    if hasattr(ch, "audio_int16_array"):
        import numpy as np  # type: ignore
        return np.asarray(ch.audio_int16_array, dtype="<i2").tobytes()
    if hasattr(ch, "audio_float_array"):
        import numpy as np  # type: ignore
        a = np.clip(np.asarray(ch.audio_float_array, dtype="float32"), -1.0, 1.0)
        return (a * 32767).astype("<i2").tobytes()
    return b""


def piper_tts(text: str, voice_id: str) -> bytes:
    voice = get_piper(voice_id)
    if voice is None:
        raise RuntimeError(f"unbekannte Piper-Stimme '{voice_id}'")
    sr = int(getattr(getattr(voice, "config", None), "sample_rate", 22050) or 22050)

    # Neue piper-tts-API: synthesize(text) -> Iterator[AudioChunk]
    chunks = None
    try:
        gen = voice.synthesize(text)
        # Generator/Iterator? (alte API bräuchte 2 Argumente → TypeError)
        if hasattr(gen, "__iter__") and not isinstance(gen, (bytes, bytearray)):
            chunks = list(gen)
    except TypeError:
        chunks = None

    buf = io.BytesIO()
    if chunks and any(_chunk_pcm_bytes(c) for c in chunks):
        first = chunks[0]
        sr = int(getattr(first, "sample_rate", sr) or sr)
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(int(getattr(first, "sample_channels", 1) or 1))
            wf.setsampwidth(int(getattr(first, "sample_width", 2) or 2))
            wf.setframerate(sr)
            for c in chunks:
                wf.writeframes(_chunk_pcm_bytes(c))
        return buf.getvalue()

    # Fallback: alte API synthesize(text, wav_file) bzw. synthesize_wav(...)
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
        if hasattr(voice, "synthesize_wav"):
            voice.synthesize_wav(text, wf)
        else:
            voice.synthesize(text, wf)
    return buf.getvalue()


# ── TTS: Kokoro (nur wenn kokoro-onnx installiert) ───────────────────────────────
def _kokoro_files_ready() -> bool:
    return os.path.exists(os.path.join(CACHE, "kokoro-v1.0.onnx"))


def get_kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro  # type: ignore
        onnx = os.path.join(CACHE, "kokoro-v1.0.onnx")
        voices = os.path.join(CACHE, "voices-v1.0.bin")
        _download(KOKORO_ONNX_URL, onnx)
        _download(KOKORO_VOICES_URL, voices)
        _kokoro = Kokoro(onnx, voices)
        log("Kokoro geladen")
    return _kokoro


def _pkg_installed(name: str) -> bool:
    # Prüft, OB ein Paket installiert ist – OHNE es zu importieren (kein Laden
    # von PyTorch/onnxruntime). Wichtig, damit /health nicht blockiert.
    try:
        import importlib.util
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


def kokoro_available() -> bool:
    return _pkg_installed("kokoro_onnx")


def kokoro_tts(text: str, voice_id: str) -> bytes:
    import numpy as np  # type: ignore
    k = get_kokoro()
    lang = "en-gb" if voice_id[:1] == "b" else "en-us"
    samples, sr = k.create(text, voice=voice_id, speed=1.0, lang=lang)
    pcm16 = (np.clip(np.asarray(samples), -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sr))
        wf.writeframes(pcm16)
    return buf.getvalue()


# ── TTS: Qwen3-TTS (optional) ────────────────────────────────────────────────────
def qwen_available() -> bool:
    return _pkg_installed("qwen_tts")


def qwen_model_bytes() -> int:
    # Wie viel vom Qwen-Modell liegt schon auf der Platte (für Fortschrittsanzeige)?
    # Zählt sowohl fertige Modell-Ordner als auch laufende Downloads (HuggingFace
    # legt Teildateien als *.incomplete unter blobs/ ab bzw. in temporären Ordnern).
    total = 0
    try:
        for hub in _hub_dirs():
            for d in os.listdir(hub):
                full = os.path.join(hub, d)
                dl = d.lower()
                # Fertiger/teilweiser Modell-Ordner (models--Qwen--Qwen3-TTS-…)
                if d.startswith("models--") and ("qwen3-tts" in dl or ("qwen" in dl and "tts" in dl)):
                    total += _dir_size(full)
                # Laufender Download in einem temporären Ordner des Hubs
                elif d.startswith((".", "tmp")) and os.path.isdir(full):
                    total += _dir_size(full)
    except Exception:
        pass
    return total


def qwen_model_ready() -> bool:
    # geladen (im Speicher) ODER vollständig auf Platte
    return _qwen is not None or qwen_model_bytes() > QWEN_EST_BYTES * 0.9


def start_qwen_load() -> None:
    # Lädt/downloadet das Qwen-Modell im Hintergrund (blockiert /health nicht).
    global _qwen_loading
    if _qwen is not None or _qwen_loading:
        return
    _qwen_loading = True
    log(f"Qwen-Ladevorgang gestartet: Modell '{QWEN_MODEL}', Cache {os.environ.get('HF_HOME')}")
    log("Schritt 1/2: PyTorch + qwen-tts werden importiert (kann beim ersten Mal 1–2 Min dauern) …")

    def _run():
        global _qwen_loading, _qwen_error
        try:
            get_qwen()
            _qwen_error = ""
            log("Qwen-Modell geladen und bereit.")
        except Exception as e:  # noqa: BLE001
            _qwen_error = str(e)
            log("Qwen laden FEHLGESCHLAGEN:", repr(e))
        finally:
            _qwen_loading = False

    import threading
    threading.Thread(target=_run, daemon=True).start()


def get_qwen():
    global _qwen
    if _qwen is None:
        import torch  # type: ignore
        from qwen_tts import Qwen3TTSModel  # type: ignore
        cuda = torch.cuda.is_available()
        log("Schritt 2/2: Modell wird geladen/heruntergeladen (mehrere GB) – Fortschritt siehe Anzeige.")
        log(f"lade Qwen3-TTS '{QWEN_MODEL}' (device={'cuda' if cuda else 'cpu'}) – kann dauern")
        _qwen = Qwen3TTSModel.from_pretrained(
            QWEN_MODEL,
            device_map="cuda:0" if cuda else "cpu",
            dtype=torch.bfloat16 if cuda else torch.float32,
        )
        log("Qwen3-TTS bereit")
    return _qwen


def qwen_tts(text: str, speaker: str, lang: str) -> bytes:
    import numpy as np  # type: ignore
    model = get_qwen()
    language = QWEN_LANG.get(lang, "English")
    wavs, sr = model.generate_custom_voice(text=text, language=language, speaker=speaker or "Ryan")
    samples = np.asarray(wavs[0], dtype=np.float32)
    pcm16 = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sr))
        wf.writeframes(pcm16)
    return buf.getvalue()


# ── Geklonte Stimmen (Qwen zero-shot voice clone) ────────────────────────────────
CLONES_DIR = os.path.join(CACHE, "clones")
os.makedirs(CLONES_DIR, exist_ok=True)
CLONES_JSON = os.path.join(CACHE, "clones.json")


def load_clones():
    try:
        with open(CLONES_JSON, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_clones(d):
    with open(CLONES_JSON, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)


_clones = load_clones()


def add_clone(name: str, text: str, pcm16: bytes) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "stimme").lower()).strip("-") or "stimme"
    cid = base
    n = 1
    while cid in _clones:
        n += 1
        cid = f"{base}-{n}"
    wav_name = cid + ".wav"
    with wave.open(os.path.join(CLONES_DIR, wav_name), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(pcm16)
    _clones[cid] = {"name": name or cid, "text": text or "", "wav": wav_name, "created": int(time.time())}
    save_clones(_clones)
    return cid


def remove_clone(cid: str):
    e = _clones.pop(cid, None)
    if e:
        try:
            os.remove(os.path.join(CLONES_DIR, e["wav"]))
        except Exception:
            pass
        save_clones(_clones)


def clone_tts(text: str, cid: str, lang: str) -> bytes:
    import numpy as np  # type: ignore
    e = _clones.get(cid)
    if not e:
        raise RuntimeError(f"unbekannte Klonstimme '{cid}'")
    with wave.open(os.path.join(CLONES_DIR, e["wav"]), "rb") as wf:
        sr = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    ref = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    model = get_qwen()
    wavs, osr = model.generate_voice_clone(
        text=text,
        language=QWEN_LANG.get(lang, "English"),
        ref_audio=(ref, sr),
        ref_text=e.get("text") or "",
    )
    samples = np.asarray(wavs[0], dtype=np.float32)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(osr))
        wf.writeframes(pcm)
    return buf.getvalue()


def default_voice(lang: str):
    opts = PIPER_VOICES.get(lang) or []
    return "piper:" + opts[0]["id"] if opts else None


def synthesize(text: str, lang: str, voice_id: str) -> bytes:
    vid = voice_id or default_voice(lang)
    if not vid:
        raise RuntimeError(f"keine TTS-Stimme für '{lang}'")
    engine, sep, name = vid.partition(":")
    if not sep:  # ohne Präfix = Piper
        engine, name = "piper", vid
    if engine == "kokoro":
        return kokoro_tts(text, name)
    if engine == "qwen":
        return qwen_tts(text, name, lang)
    if engine == "clone":
        return clone_tts(text, name, lang)
    return piper_tts(text, name)


def catalog_with_state():
    kok = kokoro_available()
    qw = qwen_available()
    out = {}
    for lang in ["de", "en", "th"]:
        items = []
        for v in PIPER_VOICES.get(lang, []):
            onnx, _ = _piper_paths(v["id"])
            items.append({"id": "piper:" + v["id"], "label": v["label"] + " · Piper", "installed": os.path.exists(onnx)})
        if kok:
            for v in KOKORO_VOICES.get(lang, []):
                items.append({"id": "kokoro:" + v["id"], "label": v["label"] + " · Kokoro", "installed": _kokoro_files_ready()})
        if qw:
            qready = qwen_model_ready()
            for v in QWEN_VOICES.get(lang, []):
                items.append({"id": "qwen:" + v["id"], "label": v["label"] + " · Qwen", "installed": qready})
            # Geklonte Stimmen (Qwen) – für Deutsch & Englisch nutzbar
            if lang in ("de", "en"):
                for cid, e in _clones.items():
                    items.append({"id": "clone:" + cid, "label": (e.get("name") or cid) + " · Klon", "installed": True})
        out[lang] = items
    return out


# ── Cache-Verwaltung (heruntergeladene Modelle/Stimmen anzeigen & löschen) ───────
def _dir_size(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except Exception:
                pass
    return total


def _hub_dirs():
    dirs = [os.path.join(os.environ.get("HF_HOME", os.path.join(CACHE, "hf")), "hub"),
            os.path.expanduser("~/.cache/huggingface/hub")]
    seen, out = set(), []
    for d in dirs:
        if d not in seen and os.path.isdir(d):
            seen.add(d); out.append(d)
    return out


def _hf_label(dirname: str) -> str:
    if "faster-whisper" in dirname:
        return "Whisper " + dirname.rsplit("-", 1)[-1]
    if "Qwen3-TTS" in dirname:
        size = "1.7B" if "1.7B" in dirname else "0.6B" if "0.6B" in dirname else ""
        return ("Qwen3-TTS " + size).strip()
    return dirname[len("models--"):].replace("--", "/") if dirname.startswith("models--") else dirname


def list_cache():
    items = []
    for hub in _hub_dirs():
        for d in os.listdir(hub):
            full = os.path.join(hub, d)
            if os.path.isdir(full) and d.startswith("models--"):
                items.append({"id": "hf:" + d, "label": _hf_label(d), "kind": "modell", "bytes": _dir_size(full)})
    for f in sorted(os.listdir(CACHE)):
        if f.endswith(".onnx") and not f.startswith("kokoro"):
            vid = f[:-5]
            b = os.path.getsize(os.path.join(CACHE, f))
            j = os.path.join(CACHE, f + ".json")
            if os.path.exists(j):
                b += os.path.getsize(j)
            items.append({"id": "piper:" + vid, "label": vid + " (Piper)", "kind": "stimme", "bytes": b})
    kf = [os.path.join(CACHE, "kokoro-v1.0.onnx"), os.path.join(CACHE, "voices-v1.0.bin")]
    if any(os.path.exists(x) for x in kf):
        items.append({"id": "kokoro", "label": "Kokoro-Modell", "kind": "modell",
                      "bytes": sum(os.path.getsize(x) for x in kf if os.path.exists(x))})
    if os.path.isdir(CLONES_DIR) and os.listdir(CLONES_DIR):
        items.append({"id": "clones", "label": "Geklonte Stimmen", "kind": "stimme", "bytes": _dir_size(CLONES_DIR)})
    items.sort(key=lambda x: -x["bytes"])
    return items


def delete_cache(cid: str):
    global _kokoro, _qwen
    if cid.startswith("hf:"):
        name = cid[3:]
        for hub in _hub_dirs():
            full = os.path.join(hub, name)
            if os.path.isdir(full):
                shutil.rmtree(full, ignore_errors=True)
        _whisper.clear(); _qwen = None
    elif cid.startswith("piper:"):
        vid = cid[6:]
        for ext in (".onnx", ".onnx.json"):
            try:
                os.remove(os.path.join(CACHE, vid + ext))
            except Exception:
                pass
        _piper.pop(vid, None)
    elif cid == "kokoro":
        for x in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
            try:
                os.remove(os.path.join(CACHE, x))
            except Exception:
                pass
        _kokoro = None
    elif cid == "clones":
        shutil.rmtree(CLONES_DIR, ignore_errors=True)
        os.makedirs(CLONES_DIR, exist_ok=True)
        _clones.clear(); save_clones(_clones)


# ── HTTP-Server ──────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"))

    def log_message(self, *a):
        pass

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/health":
            cat = catalog_with_state()
            qw_avail = qwen_available()
            self._json(200, {
                "ok": True, "stt": True,
                "tts": any(cat.values()),
                "model": DEFAULT_MODEL,
                "loaded": list(_whisper.keys()),
                "kokoro": kokoro_available(),
                "qwen": qw_avail,
                "qwen_loading": _qwen_loading,
                "qwen_ready": (_qwen is not None) or (qwen_model_bytes() > QWEN_EST_BYTES * 0.9),
                "qwen_bytes": qwen_model_bytes() if qw_avail else 0,
                "qwen_total": QWEN_EST_BYTES,
                "qwen_error": _qwen_error,
                "catalog": cat,
            })
        elif p == "/logs":
            self._json(200, {"lines": list(_LOG_RING)})
        elif p == "/voices":
            self._json(200, {"catalog": catalog_with_state()})
        elif p == "/clones":
            self._json(200, {"clones": [{"id": k, "name": v.get("name"), "text": v.get("text")} for k, v in _clones.items()]})
        elif p == "/cache":
            self._json(200, {"items": list_cache()})
        else:
            self._json(404, {"error": "not found"})

    def do_DELETE(self):
        u = urlparse(self.path)
        if u.path.startswith("/clone/"):
            remove_clone(u.path.rsplit("/", 1)[-1])
            self._json(200, {"ok": True})
        elif u.path == "/cache":
            cid = parse_qs(u.query).get("id", [""])[0]
            if cid:
                delete_cache(cid)
                self._json(200, {"ok": True})
            else:
                self._json(400, {"error": "id fehlt"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        lang = (qs.get("lang", ["de"])[0] or "de")[:2]
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        try:
            if u.path == "/qwen/load":
                start_qwen_load()
                self._json(200, {"ok": True, "loading": _qwen_loading, "ready": qwen_model_ready()})
            elif u.path == "/transcribe":
                size = qs.get("model", [DEFAULT_MODEL])[0] or DEFAULT_MODEL
                self._json(200, {"text": transcribe(body, lang, size), "lang": lang})
            elif u.path == "/tts":
                voice_id = qs.get("voice", [""])[0]
                wav = synthesize(body.decode("utf-8", "ignore"), lang, voice_id)
                self._send(200, wav, ctype="audio/wav")
            elif u.path == "/clone":
                data = json.loads(body.decode("utf-8", "ignore") or "{}")
                pcm = base64.b64decode(data.get("pcm_b64", ""))
                if len(pcm) < 8000:
                    self._json(400, {"error": "Aufnahme zu kurz"})
                else:
                    cid = add_clone(data.get("name", ""), data.get("text", ""), pcm)
                    self._json(200, {"id": cid})
            else:
                self._json(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            log("Fehler:", repr(e))
            self._json(500, {"error": str(e)})


def main():
    log(f"starte auf 127.0.0.1:{PORT} (Kokoro verfügbar: {kokoro_available()})")
    # Wichtig: den HTTP-Server SOFORT starten, damit /health erreichbar ist.
    # Das Whisper-Modell wird NICHT blockierend vorgeladen (das ließ /health
    # hängen → „nicht installiert") und auch nicht fest 'base', sondern erst
    # bei der ersten Transkription in der in der GUI gewählten Größe.
    import threading
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)

    def _preload():
        # optionales Vorladen NUR wenn ausdrücklich gewünscht (WHISPER_PRELOAD=1)
        if os.environ.get("WHISPER_PRELOAD") == "1":
            try:
                get_whisper(DEFAULT_MODEL)
            except Exception as e:  # noqa: BLE001
                log("Vorladen fehlgeschlagen:", repr(e))
    threading.Thread(target=_preload, daemon=True).start()
    log("HTTP-Server bereit (Modell lädt beim ersten Sprechen).")
    srv.serve_forever()


if __name__ == "__main__":
    main()
