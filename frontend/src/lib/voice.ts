import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

// ── Audio-Hilfen ─────────────────────────────────────────────────────────────────
function floatTo16kInt16(input: Float32Array, inRate: number): Int16Array {
  const ratio = inRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const frac = idx - i0;
    const s = input[i0] * (1 - frac) + (input[i0 + 1] || 0) * frac;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32768)));
  }
  return out;
}

/** Kurze Aufnahme über das Mikrofon → 16-kHz-Mono-PCM (für „Weckwort einsprechen"). */
export async function recordPcm(ms = 2500): Promise<ArrayBuffer> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ac = new AudioContext();
  const src = ac.createMediaStreamSource(stream);
  const node = ac.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  const inRate = ac.sampleRate;
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(node); node.connect(ac.destination);
  await new Promise((r) => setTimeout(r, ms));
  node.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); void ac.close();
  const total = chunks.reduce((n, b) => n + b.length, 0);
  const merged = new Float32Array(total);
  let off = 0; for (const b of chunks) { merged.set(b, off); off += b.length; }
  return floatTo16kInt16(merged, inRate).buffer as ArrayBuffer;
}

// ── Push-to-Talk (Leertaste): aufnehmen → STT → LLM → Antwort vorlesen ───────────
// Reines HTTP (kein WebSocket), daher robust hinter Reverse-Proxy/Tunnel.
export interface PttState {
  supported: boolean;
  recording: boolean;   // Leertaste gedrückt, nimmt auf
  busy: boolean;        // erkennt / denkt
  speaking: boolean;    // liest Antwort vor
  status: string;
  lines: { role: 'you' | 'ai' | 'sys'; text: string }[];
  error: string | null;
}

export function usePushToTalk(getCfg: () => { lang: string } | null, onBusyChange?: (b: boolean) => void) {
  const [state, setState] = useState<PttState>({
    supported: typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!window.AudioContext,
    recording: false, busy: false, speaking: false, status: '', lines: [], error: null,
  });
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const outAnalyser = useRef<AnalyserNode | null>(null);
  const rec = useRef<{ stream: MediaStream; ac: AudioContext; node: ScriptProcessorNode; src: MediaStreamAudioSourceNode; chunks: Float32Array[]; rate: number } | null>(null);
  const playCtx = useRef<AudioContext | null>(null);
  const linesRef = useRef<PttState['lines']>([]);
  const patch = (p: Partial<PttState>) => setState((s) => ({ ...s, ...p }));
  const addLine = (l: PttState['lines'][number]) => setState((s) => { const lines = [...s.lines.slice(-20), l]; linesRef.current = lines; return { ...s, lines }; });

  const setBusy = useCallback((b: boolean) => onBusyChange?.(b), [onBusyChange]);

  const start = useCallback(async () => {
    if (rec.current || state.recording) return;
    patch({ error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ac = new AudioContext();
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser); micAnalyser.current = analyser;
      const node = ac.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(node); node.connect(ac.destination);
      rec.current = { stream, ac, node, src, chunks, rate: ac.sampleRate };
      patch({ recording: true, status: 'Ich höre … (Leertaste loslassen zum Senden)' });
      setBusy(true);
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : 'Mikrofon-Zugriff verweigert', recording: false });
      setBusy(false);
    }
  }, [state.recording, setBusy]);

  const playAudio = useCallback(async (b64: string) => {
    try {
      const bin = atob(b64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (!playCtx.current) playCtx.current = new AudioContext();
      const pc = playCtx.current;
      if (!outAnalyser.current) { const an = pc.createAnalyser(); an.fftSize = 256; an.connect(pc.destination); outAnalyser.current = an; }
      const buf = await pc.decodeAudioData(bytes.buffer);
      const s = pc.createBufferSource(); s.buffer = buf; s.connect(outAnalyser.current);
      patch({ speaking: true }); setBusy(true);
      s.onended = () => { patch({ speaking: false }); setBusy(false); };
      s.start();
    } catch { patch({ speaking: false }); setBusy(false); }
  }, [setBusy]);

  const stop = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    try { r.node.disconnect(); r.src.disconnect(); r.stream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    const total = r.chunks.reduce((n, b) => n + b.length, 0);
    const merged = new Float32Array(total);
    let off = 0; for (const b of r.chunks) { merged.set(b, off); off += b.length; }
    try { void r.ac.close(); } catch { /* */ }
    micAnalyser.current = null;
    patch({ recording: false });
    const cfg = getCfg();
    if (!cfg || total / r.rate < 0.3) { patch({ status: 'Zu kurz – nochmal', busy: false }); setBusy(false); return; }
    const pcm = floatTo16kInt16(merged, r.rate).buffer as ArrayBuffer;
    patch({ busy: true, status: 'Erkenne …' });
    try {
      const { text } = await api.voice.sttOnce(pcm, cfg.lang);
      if (!text) { patch({ busy: false, status: 'Nichts verstanden – nochmal' }); setBusy(false); return; }
      // Gesprächsverlauf (vor der neuen Zeile) als Gedächtnis mitschicken
      const history = linesRef.current
        .filter((l) => l.role === 'you' || l.role === 'ai')
        .map((l) => ({ role: (l.role === 'you' ? 'user' : 'assistant') as 'user' | 'assistant', text: l.text }));
      addLine({ role: 'you', text });
      patch({ status: 'Denkt nach …' });
      const { answer, audio } = await api.voice.ask(text, cfg.lang, history);
      addLine({ role: 'ai', text: answer });
      patch({ busy: false, status: 'Antwort' });
      if (audio) await playAudio(audio); else setBusy(false);
    } catch (e) {
      addLine({ role: 'sys', text: e instanceof Error ? e.message : 'Fehler' });
      patch({ busy: false, status: 'Fehler' }); setBusy(false);
    }
  }, [getCfg, playAudio, setBusy]);

  return { state, start, stop, micAnalyser, outAnalyser };
}

export interface VoiceLine { role: 'you' | 'ai' | 'sys'; text: string }
export interface VoiceState {
  supported: boolean;
  active: boolean;       // Zuhören läuft (WS offen)
  connecting: boolean;
  muted: boolean;
  awake: boolean;        // Weckwort erkannt / hört Befehl
  speaking: boolean;     // gibt gerade Audio aus / verarbeitet
  status: string;
  heard: string;         // zuletzt erkannter Text (Feedback, auch ohne Weckwort)
  lines: VoiceLine[];
  error: string | null;
}

/**
 * Sprachsteuerung im Browser: Mikrofon aufnehmen, Sprachsegmente (Energie-VAD)
 * an den Server streamen und die gesprochene Antwort abspielen. Läuft dauerhaft
 * (mit Auto-Reconnect); ein Mute-Schalter pausiert nur die Aufnahme.
 * Weckwort-Erkennung, Whisper (STT) und Piper (TTS) laufen auf dem Server.
 */
export function useVoice(onBusyChange?: (busy: boolean) => void) {
  const [state, setState] = useState<VoiceState>({
    supported: typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!window.AudioContext,
    active: false, connecting: false, muted: false, awake: false, speaking: false, status: '', heard: '', lines: [], error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const outAnalyser = useRef<AnalyserNode | null>(null);

  const wantActive = useRef(false);   // Nutzer will zuhören (steuert Auto-Reconnect)
  const openedOnce = useRef(false);
  const mutedRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // VAD
  const collecting = useRef(false);
  const silence = useRef(0);
  const buffers = useRef<Float32Array[]>([]);
  const speakingRef = useRef(false);

  // Playback
  const playCtx = useRef<AudioContext | null>(null);
  const queue = useRef<ArrayBuffer[]>([]);
  const playing = useRef(false);

  const patch = (p: Partial<VoiceState>) => setState((s) => ({ ...s, ...p }));

  const setSpeaking = useCallback((v: boolean) => {
    speakingRef.current = v; patch({ speaking: v }); onBusyChange?.(v);
  }, [onBusyChange]);

  const playNext = useCallback(async () => {
    if (playing.current) return;
    const buf = queue.current.shift();
    if (!buf) { if (queue.current.length === 0) setSpeaking(false); return; }
    playing.current = true; setSpeaking(true);
    try {
      if (!playCtx.current) playCtx.current = new AudioContext();
      const pc = playCtx.current;
      if (!outAnalyser.current) { const an = pc.createAnalyser(); an.fftSize = 256; an.connect(pc.destination); outAnalyser.current = an; }
      const audio = await pc.decodeAudioData(buf.slice(0));
      const src = pc.createBufferSource();
      src.buffer = audio;
      src.connect(outAnalyser.current);
      src.onended = () => { playing.current = false; void playNext(); };
      src.start();
    } catch {
      playing.current = false; void playNext();
    }
  }, [setSpeaking]);

  const enqueueAudio = useCallback((b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    queue.current.push(bytes.buffer);
    void playNext();
  }, [playNext]);

  const addLine = (line: VoiceLine) => setState((s) => ({ ...s, lines: [...s.lines.slice(-20), line] }));
  const appendAi = (t: string) => setState((s) => {
    const lines = [...s.lines];
    const last = lines[lines.length - 1];
    if (last && last.role === 'ai') lines[lines.length - 1] = { role: 'ai', text: last.text + t };
    else lines.push({ role: 'ai', text: t });
    return { ...s, lines: lines.slice(-20) };
  });

  const connectWs = useCallback(() => {
    if (!wantActive.current) return;
    patch({ connecting: true });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/voice/ws`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => { openedOnce.current = true; patch({ active: true, connecting: false, error: null, status: 'Bereit – sag dein Weckwort' }); };
    ws.onclose = () => {
      patch({ active: false });
      if (wantActive.current) {
        // Automatisch neu verbinden
        patch({ status: 'Verbindung getrennt – neuer Versuch …' });
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => connectWs(), 3000);
      }
    };
    ws.onerror = () => {
      // Nur beim allerersten, nie zustande gekommenen Verbindungsaufbau als Fehler zeigen
      if (!openedOnce.current) patch({ error: 'WebSocket-Verbindung fehlgeschlagen – Seite neu laden; der Reverse-Proxy muss WebSockets erlauben (wie beim Terminal).', connecting: false });
    };
    ws.onmessage = (ev) => {
      let m: { type: string; [k: string]: unknown };
      try { m = JSON.parse(ev.data as string); } catch { return; }
      switch (m.type) {
        case 'ready': patch({ status: `Bereit – Weckwort: „${m.wakeword as string}"` }); break;
        case 'heard': patch({ heard: m.text as string }); break;
        case 'wake': patch({ awake: true, status: 'Ja? Ich höre …' }); break;
        case 'sleep': patch({ awake: false, status: 'Bereit – sag dein Weckwort' }); break;
        case 'ack': patch({ awake: false, status: 'Verstanden – denke nach …' }); addLine({ role: 'you', text: m.text as string }); break;
        case 'token': appendAi(m.text as string); break;
        case 'answer': patch({ status: 'Antwort fertig' }); break;
        case 'audio': enqueueAudio(m.b64 as string); break;
        case 'idle': patch({ status: 'Bereit – sag dein Weckwort' }); break;
        case 'error': addLine({ role: 'sys', text: m.message as string }); patch({ status: m.message as string }); break;
      }
    };
  }, [appendAi, enqueueAudio]);

  const stop = useCallback(() => {
    wantActive.current = false;
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    try { nodeRef.current?.disconnect(); } catch { /* */ }
    try { srcRef.current?.disconnect(); } catch { /* */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { acRef.current?.close(); } catch { /* */ }
    try { wsRef.current?.close(); } catch { /* */ }
    nodeRef.current = null; srcRef.current = null; streamRef.current = null; acRef.current = null; wsRef.current = null;
    micAnalyser.current = null;
    collecting.current = false; silence.current = 0; buffers.current = [];
    patch({ active: false, connecting: false, awake: false, status: '' });
    setSpeaking(false);
  }, [setSpeaking]);

  const start = useCallback(async () => {
    if (wantActive.current) return;
    patch({ error: null });
    wantActive.current = true;
    openedOnce.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const ac = new AudioContext();
      acRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      srcRef.current = src;
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);
      micAnalyser.current = analyser;
      const node = ac.createScriptProcessor(4096, 1, 1);
      nodeRef.current = node;
      const inRate = ac.sampleRate;

      node.onaudioprocess = (e) => {
        const ws = wsRef.current;
        if (mutedRef.current || speakingRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        const speech = rms > 0.008;
        if (speech) {
          collecting.current = true; silence.current = 0;
          buffers.current.push(new Float32Array(input));
        } else if (collecting.current) {
          silence.current += input.length / inRate;
          buffers.current.push(new Float32Array(input));
          if (silence.current > 0.7) {
            const total = buffers.current.reduce((n, b) => n + b.length, 0);
            const merged = new Float32Array(total);
            let off = 0; for (const b of buffers.current) { merged.set(b, off); off += b.length; }
            buffers.current = []; collecting.current = false; silence.current = 0;
            if (total / inRate > 0.35) { try { ws.send(floatTo16kInt16(merged, inRate).buffer); } catch { /* */ } }
          }
        }
      };
      src.connect(node);
      node.connect(ac.destination);
      connectWs();
    } catch (err) {
      wantActive.current = false;
      patch({ error: err instanceof Error ? err.message : 'Mikrofon-Zugriff verweigert', active: false });
      stop();
    }
  }, [connectWs, stop]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    patch({ muted: mutedRef.current, status: mutedRef.current ? 'Pausiert' : 'Bereit – sag dein Weckwort' });
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { state, start, stop, toggleMute, micAnalyser, outAnalyser };
}
