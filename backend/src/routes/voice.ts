import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { isRoot, privExec } from '../lib/privilege';
import { appSettingsQueries } from '../db/index';
import { obsidianContext } from './obsidian';
import { webContext } from './websearch';

// ── lokaler Voice-Daemon (Whisper STT + Piper TTS) ───────────────────────────────
const VOICE_PORT = process.env.VOICE_PORT || '11435';
const DAEMON = `http://127.0.0.1:${VOICE_PORT}`;
const OLLAMA = 'http://127.0.0.1:11434';

type Lang = 'de' | 'en' | 'th';
const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v3'];

interface VoiceConfig {
  enabled: boolean;
  wakeword: string;
  lang: Lang;
  tts: boolean;
  whisperModel: string;
  voices: { de?: string; en?: string; th?: string };
}

interface VoiceOpt { id: string; label: string; installed: boolean }
type Catalog = Record<string, VoiceOpt[]>;

function readConfig(): VoiceConfig {
  const g = (k: string) => appSettingsQueries.get.get(k)?.value;
  const lang = (g('voice_lang') as Lang) || 'de';
  const model = g('voice_whisper_model') || 'base';
  return {
    enabled: g('voice_enabled') === '1',
    wakeword: (g('voice_wakeword') || 'computer').trim(),
    lang: (['de', 'en', 'th'].includes(lang) ? lang : 'de') as Lang,
    tts: g('voice_tts') !== '0',
    whisperModel: WHISPER_MODELS.includes(model) ? model : 'base',
    voices: { de: g('voice_voice_de') || undefined, en: g('voice_voice_en') || undefined, th: g('voice_voice_th') || undefined },
  };
}

/** Für die aktuelle Sprache gewählte TTS-Stimme (oder leer = Daemon-Default). */
function voiceFor(cfg: VoiceConfig): string {
  return cfg.voices[cfg.lang] || '';
}

type Health = { ok: boolean; stt: boolean; tts: boolean; model?: string; loaded?: string[]; catalog?: Catalog; kokoro?: boolean; qwen?: boolean; qwen_loading?: boolean; qwen_ready?: boolean; qwen_bytes?: number; qwen_total?: number; qwen_error?: string };

async function daemonHealth(): Promise<Health> {
  try {
    const r = await fetch(`${DAEMON}/health`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, stt: false, tts: false };
    return await r.json() as Health;
  } catch {
    return { ok: false, stt: false, tts: false };
  }
}

async function transcribe(pcm: Buffer, lang: string, model = 'base'): Promise<string> {
  const r = await fetch(`${DAEMON}/transcribe?lang=${encodeURIComponent(lang)}&model=${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: pcm,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`STT ${r.status}`);
  const j = await r.json() as { text?: string };
  return (j.text || '').trim();
}

async function tts(text: string, lang: string, voice = ''): Promise<Buffer | null> {
  try {
    // Qwen lädt sein Modell (~3–4 GB) beim ersten Nutzen → viel längeres Timeout,
    // damit die erste Ausgabe nicht abbricht. Piper/Kokoro sind schnell.
    const timeout = voice.startsWith('qwen:') || voice.startsWith('clone:') ? 300000 : 30000;
    const r = await fetch(`${DAEMON}/tts?lang=${encodeURIComponent(lang)}&voice=${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from(text, 'utf-8'),
      signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) return null; // z.B. keine Stimme für die Sprache → nur Text
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** Aktuell in den Speicher geladenes Ollama-Modell (oder null). */
async function loadedModel(): Promise<string | null> {
  try {
    const r = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = await r.json() as { models?: { name: string }[] };
    return j.models?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

// Kurze Bestätigungsfloskel je Sprache (wird für sofortiges Feedback gecacht)
const ACK_PHRASE: Record<string, string> = {
  de: 'Einen Moment.',
  en: 'One moment.',
  th: 'สักครู่นะคะ',
};
const ackCache = new Map<string, Buffer | null>();
async function ackAudio(lang: string, voice: string): Promise<Buffer | null> {
  const key = `${lang}|${voice}`;
  if (ackCache.has(key)) return ackCache.get(key) ?? null;
  const buf = await tts(ACK_PHRASE[lang] || ACK_PHRASE.de, lang, voice);
  ackCache.set(key, buf);
  return buf;
}

/**
 * Ollama /api/chat streamen und satzweise zurückgeben. Nach jedem abgeschlossenen
 * Satz wird onSentence() aufgerufen – so kann sofort mit dem Vorlesen begonnen
 * werden, ohne auf die komplette Antwort zu warten.
 */
const SYS_BASE: Record<string, string> = {
  de: 'Du bist ein hilfreicher Sprachassistent. Antworte sehr kurz, in ein bis zwei Sätzen, klar gesprochen und ohne Aufzählungen oder Sonderzeichen. Denke nicht laut nach, gib direkt die Antwort.',
  en: 'You are a helpful voice assistant. Answer very briefly, in one or two spoken sentences, no lists or special characters. Do not think out loud, give the answer directly.',
  th: 'คุณเป็นผู้ช่วยด้วยเสียงที่เป็นประโยชน์ ตอบสั้นๆ หนึ่งถึงสองประโยค',
};
// System-Prompt inkl. aktuellem Datum/Uhrzeit (damit Datums-/Zeitfragen stimmen).
function sysPrompt(lang: string): string {
  const now = new Date();
  const de = now.toLocaleString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dateLine = lang === 'en'
    ? ` Current date and time: ${now.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Use it for date/time questions.`
    : ` Aktuelles Datum und Uhrzeit: ${de}. Nutze das für Datums- und Zeitfragen.`;
  return (SYS_BASE[lang] || SYS_BASE.de) + dateLine;
}

// „Thinking"-Modelle (gpt-oss/harmony, deepseek-r1 …) geben Denk-Tokens aus.
// Diese hier herausfiltern und nur die eigentliche Antwort behalten.
function cleanReply(raw: string): string {
  let s = raw || '';
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, ' ');           // <think>…</think>
  if (/<\|[^>]*\|?>/.test(s)) {                                // harmony/gpt-oss Kanäle
    const parts = s.split(/<\|message\|?>/);                   // nur nach letztem message-Marker
    if (parts.length > 1) s = parts[parts.length - 1];
    s = s.replace(/<\|[^>]*\|?>/g, ' ');                       // Rest-Steuertokens
  }
  s = s.replace(/^\s*(analysis|thought|assistant\s*final|final|assistantfinal)\b[:\s]*/i, '');
  return s.replace(/\s+/g, ' ').trim();
}

type ChatMsg = { role: 'user' | 'assistant'; text: string };

// Wissensbasis (Obsidian) als Kontextblock an den System-Prompt hängen.
function knowledgeBlock(knowledge: string, lang: string): string {
  if (!knowledge) return '';
  return lang === 'en'
    ? `\n\nRelevant knowledge (notes and/or live web results — use if helpful, cite sources, do not invent):\n${knowledge}`
    : `\n\nRelevantes Wissen (Notizen und/oder aktuelle Web-Ergebnisse – nutze es, wenn hilfreich, nenne Quellen, erfinde nichts dazu):\n${knowledge}`;
}

// Fallback über /api/generate – funktioniert auch bei GGUF-Modellen ohne
// Chat-Template (bei denen /api/chat leer bleibt). Gesprächsverlauf wird in den
// Prompt gefaltet, damit auch hier Kontext erhalten bleibt.
async function generateReply(model: string, userText: string, lang: string, history: ChatMsg[] = [], knowledge = ''): Promise<string> {
  const uLabel = lang === 'en' ? 'User' : 'Nutzer';
  const aLabel = lang === 'en' ? 'Assistant' : 'Assistent';
  const convo = history.map((m) => `${m.role === 'user' ? uLabel : aLabel}: ${m.text}`).join('\n');
  const prompt = (convo ? convo + '\n' : '') + `${uLabel}: ${userText}\n${aLabel}:`;
  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, system: sysPrompt(lang) + knowledgeBlock(knowledge, lang), prompt, stream: false, think: false, options: { num_predict: 260, temperature: 0.4 } }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return '';
    const j = await res.json() as { response?: string };
    return cleanReply(j.response || '');
  } catch { return ''; }
}

async function chatStream(
  model: string,
  userText: string,
  lang: string,
  onToken: (t: string) => void,
  onSentence: (s: string) => Promise<void>,
  history: ChatMsg[] = [],
  knowledge = '',
): Promise<string> {
  const sys = sysPrompt(lang) + knowledgeBlock(knowledge, lang);
  const prior = history.map((m) => ({ role: m.role, content: m.text }));

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: sys }, ...prior, { role: 'user', content: userText }],
      think: false,
      stream: true,
      options: { num_predict: 220, temperature: 0.4 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}`);

  const decoder = new TextDecoder();
  let buf = '';        // Zeilenpuffer (NDJSON)
  let sentence = '';   // aktueller Satzpuffer
  let full = '';

  const flush = async (force = false) => {
    const s = sentence.trim();
    if (s && (force || /[.!?…。！？\n]$/.test(sentence) ) && s.length >= 2) {
      sentence = '';
      await onSentence(s);
    }
  };

  for await (const chunk of res.body as AsyncIterable<Buffer>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj: { message?: { content?: string }; done?: boolean };
      try { obj = JSON.parse(line); } catch { continue; }
      const piece = obj.message?.content || '';
      if (piece) { full += piece; sentence += piece; onToken(piece); await flush(); }
      if (obj.done) { await flush(true); }
    }
  }
  await flush(true);
  return cleanReply(full);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:„"“”'’()\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Selbst-Installation des Sprachdienstes über install.sh (--voice) ──────────────
// Läuft im Hintergrund; /bin/bash ist in der sudoers-Allowlist, daher braucht das
// Verwaltungstool dafür keine Shell vom Benutzer.
const install = { running: false, log: '', error: '' as string | null, startedAt: 0 };

function installScriptPath(): string | null {
  for (const p of [
    path.resolve(process.cwd(), '..', 'install.sh'),
    '/opt/vault-hub/install.sh',
    path.resolve(__dirname, '../../../install.sh'),
  ]) {
    try { if (fs.existsSync(p)) return p; } catch { /* */ }
  }
  return null;
}

function startVoiceInstall(flags: string | string[] = '--voice'): { started: boolean; error?: string } {
  if (install.running) return { started: true };
  const script = installScriptPath();
  if (!script) return { started: false, error: 'install.sh nicht gefunden' };
  install.running = true; install.log = ''; install.error = null; install.startedAt = Date.now();
  const flagArr = Array.isArray(flags) ? flags : [flags];
  const bin = isRoot ? '/bin/bash' : 'sudo';
  const args = isRoot ? [script, ...flagArr] : ['-n', '/bin/bash', script, ...flagArr];
  let child;
  try {
    child = spawn(bin, args, { cwd: path.dirname(script) });
  } catch (e) {
    install.running = false; install.error = e instanceof Error ? e.message : 'Start fehlgeschlagen';
    return { started: false, error: install.error };
  }
  const append = (d: Buffer) => { install.log = (install.log + d.toString()).slice(-6000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('close', (code) => {
    install.running = false;
    install.error = code === 0 ? null : `Installation fehlgeschlagen (Code ${code}). Details siehe Log.`;
  });
  child.on('error', (e) => { install.running = false; install.error = e.message; });
  return { started: true };
}

export async function voiceRoutes(fastify: FastifyInstance) {

  // Roh-Audio (int16 PCM) für /api/voice/stt-once als Buffer entgegennehmen
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // ── Konfiguration + Verfügbarkeit ──
  fastify.get('/api/voice/config', { preHandler: requireAuth }, async (_req, reply) => {
    const cfg = readConfig();
    const health = await daemonHealth();
    const model = await loadedModel();
    reply.send({
      ...cfg,
      whisperModels: WHISPER_MODELS,
      available: { daemon: health.ok, stt: health.stt, tts: health.tts, model: health.model, loaded: health.loaded ?? [], catalog: health.catalog ?? {}, kokoro: !!health.kokoro, qwen: !!health.qwen, qwenLoading: !!health.qwen_loading, qwenReady: !!health.qwen_ready, qwenBytes: health.qwen_bytes ?? 0, qwenTotal: health.qwen_total ?? 0, qwenError: health.qwen_error ?? '' },
      model,
      install: { running: install.running, error: install.error, log: install.log.slice(-1200) },
    });
  });

  // Sprachdienst über das Verwaltungstool installieren (Hintergrund)
  fastify.post('/api/voice/install', { preHandler: requireAdmin }, async (_req, reply) => {
    const r = startVoiceInstall('--voice');
    if (!r.started) return reply.status(500).send({ error: r.error || 'Start fehlgeschlagen' });
    reply.send({ ok: true, running: install.running });
  });

  // Qwen3-TTS (Deutsch in Studioqualität) nachinstallieren – schwer (PyTorch)
  fastify.post('/api/voice/install-qwen', { preHandler: requireAdmin }, async (_req, reply) => {
    const r = startVoiceInstall('--voice-qwen');
    if (!r.started) return reply.status(500).send({ error: r.error || 'Start fehlgeschlagen' });
    reply.send({ ok: true, running: install.running });
  });

  // Voice-venv mit einer bestimmten Python-Version neu aufsetzen (z.B. 3.12),
  // falls die System-Python-Version zu neu für PyTorch/torchaudio ist.
  fastify.post<{ Body: { version?: string } }>('/api/voice/rebuild-python', { preHandler: requireAdmin }, async (req, reply) => {
    const version = (req.body?.version || '3.12').replace(/[^0-9.]/g, '') || '3.12';
    const r = startVoiceInstall(['--voice-py', version]);
    if (!r.started) return reply.status(500).send({ error: r.error || 'Start fehlgeschlagen' });
    reply.send({ ok: true, running: install.running });
  });

  // Sprachdienst neu starten (lädt die aktuelle voiced.py in den laufenden Dienst).
  // Nötig, wenn nach einem Update noch der alte Daemon-Prozess läuft.
  fastify.post('/api/voice/restart', { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      privExec('systemctl restart vault-hub-voice', { timeout: 15000 });
      // kurz warten, bis der Dienst wieder da ist
      await new Promise((r) => setTimeout(r, 1500));
      const health = await daemonHealth();
      reply.send({ ok: true, daemon: health.ok });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Neustart fehlgeschlagen. Alternativ: „sudo systemctl restart vault-hub-voice".' });
    }
  });

  // Live-Log des Sprachdienstes (Download-/Ladefortschritt, Fehler) für die GUI
  fastify.get('/api/voice/logs', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const r = await fetch(`${DAEMON}/logs`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return reply.send({ lines: [] });
      reply.send(await r.json());
    } catch {
      reply.send({ lines: [] });
    }
  });

  // Qwen3-TTS-Modell (~3–4 GB) im Hintergrund vorladen – der Daemon lädt/holt
  // es und meldet den Fortschritt über /api/voice/config (qwenBytes/qwenTotal).
  fastify.post('/api/voice/qwen-load', { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      const r = await fetch(`${DAEMON}/qwen/load`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (r.ok) return reply.send(await r.json());
      if (r.status !== 404) return reply.status(502).send({ error: `Daemon ${r.status}` });
      // Älterer Daemon ohne /qwen/load: Modell durch eine erste TTS-Anfrage mit
      // einer Qwen-Stimme warmladen (funktioniert bei jeder Daemon-Version).
      const health = await daemonHealth();
      const qwenVoice = Object.values(health.catalog ?? {}).flat().find((v) => v.id?.startsWith('qwen:'))?.id;
      if (!qwenVoice) return reply.status(502).send({ error: 'Keine Qwen-Stimme verfügbar. Bitte „sudo bash install.sh --voice-qwen" ausführen.' });
      void tts('Hallo.', 'de', qwenVoice).catch(() => {}); // Fire-and-forget: stößt den Download an
      reply.send({ ok: true, loading: true, ready: false, warm: true });
    } catch {
      reply.status(502).send({ error: 'Sprachdienst nicht erreichbar' });
    }
  });

  // Push-to-Talk: Text → Antwort des geladenen Modells (+ optional TTS-Audio).
  // Reines HTTP (kein WebSocket) – robust auch hinter Reverse-Proxy/Tunnel.
  fastify.post<{ Body: { text?: string; lang?: string; history?: ChatMsg[] } }>('/api/voice/ask', { preHandler: requireAuth }, async (req, reply) => {
    const text = (req.body?.text || '').trim();
    const lang = (['de', 'en', 'th'].includes(req.body?.lang || '') ? req.body!.lang! : 'de');
    if (!text) return reply.status(400).send({ error: 'Kein Text' });
    // Gesprächsverlauf (nur user/assistant, letzte ~8 Turns) → Kontext-Gedächtnis
    const history: ChatMsg[] = (Array.isArray(req.body?.history) ? req.body!.history! : [])
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.text === 'string' && m.text.trim())
      .slice(-8)
      .map((m) => ({ role: m.role, text: String(m.text).slice(0, 1200) }));
    const model = await loadedModel();
    if (!model) return reply.status(400).send({ error: 'Keine KI im Speicher geladen.' });
    try {
      // Wissensquellen: Obsidian (lokal) + Live-Websuche (falls jeweils aktiv)
      const [web, notes] = await Promise.all([webContext(text).catch(() => ''), Promise.resolve(obsidianContext(text))]);
      const knowledge = [notes && `Obsidian-Notizen:\n${notes}`, web && `Web-Ergebnisse:\n${web}`].filter(Boolean).join('\n\n');
      let answer = await chatStream(model, text, lang, () => {}, async () => {}, history, knowledge).catch(() => '');
      if (!answer) answer = await generateReply(model, text, lang, history, knowledge); // Fallback für GGUF ohne Chat-Template
      const cfg = readConfig();
      let audio: string | undefined;
      if (cfg.tts && answer) { const wav = await tts(answer, lang, voiceFor(cfg)); if (wav) audio = wav.toString('base64'); }
      const shown = answer || (lang === 'en' ? 'The AI model returned no answer (check the model in the AI hub).' : 'Das KI-Modell hat keine Antwort geliefert (Modell in der KI-Zentrale prüfen).');
      reply.send({ answer: shown, audio });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Hörprobe einer Stimme (kurzer Beispielsatz → WAV)
  fastify.get<{ Querystring: { voice?: string; lang?: string } }>('/api/voice/preview', { preHandler: requireAuth }, async (req, reply) => {
    const q = req.query || {};
    const lang = (['de', 'en', 'th'].includes(q.lang || '') ? q.lang : 'de') as string;
    const sample: Record<string, string> = {
      de: 'Hallo, so klingt diese Stimme in der Sprachsteuerung.',
      en: 'Hello, this is how this voice sounds.',
      th: 'สวัสดีค่ะ นี่คือเสียงของระบบสั่งงานด้วยเสียง',
    };
    const voice = q.voice || '';
    const wav = await tts(sample[lang] || sample.de, lang, voice);
    if (!wav) {
      const qwenHint = voice.startsWith('qwen:')
        ? 'Qwen lädt beim ersten Mal sein Modell (~3–4 GB) – bitte 1–2 Minuten warten und erneut versuchen. Voraussetzung: „sudo bash install.sh --voice-qwen" (installiert PyTorch + sox).'
        : 'Für diese Stimme ist keine Ausgabe möglich.';
      return reply.status(500).send({ error: qwenHint });
    }
    reply.header('Content-Type', 'audio/wav').send(wav);
  });

  // Einmalige Transkription (z.B. um das Weckwort einzusprechen)
  fastify.post('/api/voice/stt-once', { preHandler: requireAuth, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const lang = (typeof (req.query as { lang?: string })?.lang === 'string' ? (req.query as { lang?: string }).lang : 'de') as string;
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 200) return reply.status(400).send({ error: 'Kein Audio empfangen' });
    try {
      const text = await transcribe(body, lang, readConfig().whisperModel);
      reply.send({ text });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'STT fehlgeschlagen' });
    }
  });

  // Stimme klonen (Qwen zero-shot): Referenz-PCM (base64) + Transkript
  fastify.post<{ Body: { name?: string; text?: string; pcmB64?: string } }>('/api/voice/clone', { preHandler: requireAdmin, bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body || {};
    if (!b.name?.trim() || !b.pcmB64) return reply.status(400).send({ error: 'Name und Aufnahme nötig' });
    try {
      const r = await fetch(`${DAEMON}/clone`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: b.name.trim().slice(0, 40), text: (b.text || '').slice(0, 400), pcm_b64: b.pcmB64 }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({})) as { error?: string; id?: string };
      if (!r.ok) return reply.status(500).send({ error: j.error || 'Klonen fehlgeschlagen (läuft Qwen? → „Qwen-Stimme installieren")' });
      reply.send(j);
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/voice/clone/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      await fetch(`${DAEMON}/clone/${encodeURIComponent(req.params.id)}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
      reply.send({ ok: true });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Cache-Verwaltung: heruntergeladene Modelle/Stimmen anzeigen & löschen
  fastify.get('/api/voice/cache', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const r = await fetch(`${DAEMON}/cache`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return reply.send({ items: [] });
      reply.send(await r.json());
    } catch { reply.send({ items: [] }); }
  });

  fastify.delete<{ Querystring: { id?: string } }>('/api/voice/cache', { preHandler: requireAdmin }, async (req, reply) => {
    const id = (req.query?.id || '').trim();
    if (!id) return reply.status(400).send({ error: 'id fehlt' });
    try {
      const r = await fetch(`${DAEMON}/cache?id=${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) return reply.status(500).send({ error: j.error || 'Löschen fehlgeschlagen' });
      reply.send({ ok: true });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  fastify.get('/api/voice/install/status', { preHandler: requireAuth }, async (_req, reply) => {
    const health = await daemonHealth();
    reply.send({ running: install.running, error: install.error, log: install.log.slice(-4000), daemon: health.ok });
  });

  fastify.post<{ Body: Partial<VoiceConfig> }>('/api/voice/config', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') appSettingsQueries.set.run('voice_enabled', b.enabled ? '1' : '0');
    if (typeof b.tts === 'boolean') appSettingsQueries.set.run('voice_tts', b.tts ? '1' : '0');
    if (typeof b.wakeword === 'string') {
      const w = b.wakeword.trim().slice(0, 40);
      if (w) appSettingsQueries.set.run('voice_wakeword', w);
    }
    if (b.lang && ['de', 'en', 'th'].includes(b.lang)) appSettingsQueries.set.run('voice_lang', b.lang);
    if (typeof b.whisperModel === 'string' && WHISPER_MODELS.includes(b.whisperModel)) appSettingsQueries.set.run('voice_whisper_model', b.whisperModel);
    if (b.voices && typeof b.voices === 'object') {
      for (const l of ['de', 'en', 'th'] as const) {
        const v = b.voices[l];
        if (typeof v === 'string') appSettingsQueries.set.run(`voice_voice_${l}`, v.slice(0, 80));
      }
    }
    ackCache.clear(); // Sprache/Stimme evtl. geändert → Bestätigungs-Audio neu erzeugen
    reply.send(readConfig());
  });

  // ── Live-Pipeline (WebSocket): Audio rein, Text/Audio raus ──
  fastify.get('/api/voice/ws', { websocket: true }, (ws, req) => {
    void (async () => {
      try { await req.jwtVerify(); } catch { ws.close(1008, 'Unauthorized'); return; }

      const send = (obj: unknown) => { try { ws.send(JSON.stringify(obj)); } catch { /* */ } };
      let awake = false;
      let awakeTimer: ReturnType<typeof setTimeout> | null = null;
      let processing = false;

      const cfg = readConfig();
      send({ type: 'ready', wakeword: cfg.wakeword, lang: cfg.lang, tts: cfg.tts });

      const setAwake = (on: boolean) => {
        awake = on;
        if (awakeTimer) { clearTimeout(awakeTimer); awakeTimer = null; }
        if (on) awakeTimer = setTimeout(() => { awake = false; send({ type: 'sleep' }); }, 8000);
      };

      const voice = voiceFor(cfg);
      const speak = async (seq: number, text: string, lang: string) => {
        if (!cfg.tts) return;
        const wav = seq === 0 ? await ackAudio(lang, voice) : await tts(text, lang, voice);
        if (wav) send({ type: 'audio', seq, b64: wav.toString('base64') });
      };

      const runCommand = async (text: string) => {
        if (processing) return;
        processing = true;
        setAwake(false);
        try {
          send({ type: 'ack', text });
          const model = await loadedModel();
          if (!model) { send({ type: 'error', message: 'Keine KI im Speicher geladen.' }); return; }
          // Sofortiges gesprochenes Feedback (gecacht → praktisch ohne Verzögerung)
          void speak(0, ACK_PHRASE[cfg.lang] || '', cfg.lang);
          let seq = 1;
          let answer = await chatStream(
            model, text, cfg.lang,
            (tok) => send({ type: 'token', text: tok }),
            async (s) => { const my = seq++; send({ type: 'sentence', seq: my, text: s }); await speak(my, s, cfg.lang); },
          ).catch(() => '');
          // Fallback für GGUF-Modelle ohne Chat-Template
          if (!answer) { answer = await generateReply(model, text, cfg.lang); if (answer) { send({ type: 'sentence', seq: seq++, text: answer }); await speak(0, answer, cfg.lang); } }
          send({ type: 'answer', text: answer });
        } catch (e) {
          send({ type: 'error', message: e instanceof Error ? e.message : 'Fehler' });
        } finally {
          processing = false;
          send({ type: 'idle' });
        }
      };

      const handleTranscript = (raw: string) => {
        const text = raw.trim();
        if (!text) return;
        send({ type: 'heard', text });
        if (processing) return;

        if (awake) { void runCommand(text); return; }

        // Weckwort im Text suchen; alles danach ist bereits der Befehl
        const norm = normalize(text);
        const wake = normalize(cfg.wakeword);
        const idx = wake ? norm.indexOf(wake) : -1;
        if (idx < 0) return; // kein Weckwort → ignorieren
        send({ type: 'wake' });
        const after = norm.slice(idx + wake.length).trim();
        if (after) void runCommand(after);
        else setAwake(true); // auf den Befehl im nächsten Satz warten
      };

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          if (processing) return; // während Verarbeitung/Ausgabe kein neues Audio
          transcribe(data, cfg.lang, cfg.whisperModel).then(handleTranscript).catch(() => { /* */ });
        }
        // Textframes derzeit nicht benötigt
      });
      ws.on('close', () => { if (awakeTimer) clearTimeout(awakeTimer); });
      ws.on('error', () => { if (awakeTimer) clearTimeout(awakeTimer); });
    })();
  });
}
