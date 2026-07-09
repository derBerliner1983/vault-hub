import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

// ── Obsidian als „Gehirn" (lokale Wissensbasis / RAG) ────────────────────────────
// Vault-Hub liest einen Obsidian-Vault (Ordner mit .md-Dateien) ein, indexiert ihn
// als SQLite-Volltextindex (FTS5) und stellt bei KI-Fragen die passendsten
// Notiz-Ausschnitte als Kontext bereit. Rein lokal, keine Cloud, keine Embeddings.

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CFG_PATH = path.join(DATA_DIR, 'obsidian.json');

type ObsidianCfg = { vault: string; enabled: boolean; lastIndexed: string | null; files: number; chunks: number };

function defaultCfg(): ObsidianCfg {
  // Standard-Vault: data/brain (wird bei Bedarf angelegt), damit „Loslegen" ohne
  // Konfiguration möglich ist. Kann in den Einstellungen überschrieben werden.
  return { vault: path.join(DATA_DIR, 'brain'), enabled: false, lastIndexed: null, files: 0, chunks: 0 };
}

function readCfg(): ObsidianCfg {
  try { return { ...defaultCfg(), ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf-8')) }; }
  catch { return defaultCfg(); }
}
function writeCfg(c: ObsidianCfg): void {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CFG_PATH, JSON.stringify(c, null, 2)); } catch { /* */ }
}

// FTS5-Volltextindex. rowid = interne ID; wir speichern Pfad, Titel und Textblock.
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS obsidian_fts USING fts5(path, title, body, tokenize = 'unicode61 remove_diacritics 2');`);

// Alle .md-Dateien eines Vaults finden (rekursiv, ohne versteckte/.obsidian-Ordner).
function walkMd(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out, depth + 1);
    else if (e.isFile() && /\.(md|markdown|txt)$/i.test(e.name)) out.push(p);
  }
  return out;
}

// Text in überlappende Blöcke (~900 Zeichen) an Absatzgrenzen teilen.
function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const paras = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > 900 && cur) { chunks.push(cur.trim()); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/** Vault neu einlesen und den Volltextindex aufbauen. Gibt Datei-/Blockzahl zurück. */
export function reindex(): { files: number; chunks: number } {
  const cfg = readCfg();
  db.exec('DELETE FROM obsidian_fts;');
  let files = 0, chunks = 0;
  if (fs.existsSync(cfg.vault)) {
    const ins = db.prepare('INSERT INTO obsidian_fts (path, title, body) VALUES (?, ?, ?)');
    const tx = db.transaction((mdFiles: string[]) => {
      for (const f of mdFiles) {
        let raw: string;
        try { raw = fs.readFileSync(f, 'utf-8'); } catch { continue; }
        const rel = path.relative(cfg.vault, f);
        const title = path.basename(f).replace(/\.(md|markdown|txt)$/i, '');
        const parts = chunkText(raw);
        if (!parts.length) continue;
        files++;
        for (const c of parts) { ins.run(rel, title, c); chunks++; }
      }
    });
    tx(walkMd(cfg.vault));
  }
  writeCfg({ ...cfg, lastIndexed: new Date().toISOString(), files, chunks });
  return { files, chunks };
}

// Freitextfrage → FTS-MATCH-Ausdruck (Wörter mit OR, kurze/Stoppwörter raus).
function toMatch(q: string): string {
  const words = q.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 12)
    .map((w) => `"${w}"`);
  return words.join(' OR ');
}

/** Passende Notiz-Ausschnitte zur Frage (für RAG-Kontext). */
export function searchNotes(query: string, k = 4): { path: string; title: string; body: string }[] {
  const cfg = readCfg();
  if (!cfg.enabled) return [];
  const match = toMatch(query);
  if (!match) return [];
  try {
    return db.prepare(
      `SELECT path, title, body FROM obsidian_fts WHERE obsidian_fts MATCH ? ORDER BY rank LIMIT ?`,
    ).all(match, k) as { path: string; title: string; body: string }[];
  } catch { return []; }
}

/** Fertiger Kontextblock für den System-Prompt (oder ''). */
export function obsidianContext(query: string): string {
  const hits = searchNotes(query, 4);
  if (!hits.length) return '';
  const body = hits.map((h) => `# ${h.title}\n${h.body}`).join('\n\n---\n\n').slice(0, 3500);
  return body;
}

export function obsidianStatus() {
  const cfg = readCfg();
  const exists = !!cfg.vault && fs.existsSync(cfg.vault);
  return {
    enabled: cfg.enabled,
    vault: cfg.vault,
    exists,
    connected: cfg.enabled && exists && cfg.chunks > 0,
    files: cfg.files,
    chunks: cfg.chunks,
    lastIndexed: cfg.lastIndexed,
  };
}

export async function obsidianRoutes(fastify: FastifyInstance) {
  fastify.get('/api/obsidian/status', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send(obsidianStatus());
  });

  fastify.post<{ Body: { vault?: string; enabled?: boolean } }>('/api/obsidian/config', { preHandler: requireAdmin }, async (req, reply) => {
    const cfg = readCfg();
    if (typeof req.body?.vault === 'string' && req.body.vault.trim()) cfg.vault = req.body.vault.trim();
    if (typeof req.body?.enabled === 'boolean') cfg.enabled = req.body.enabled;
    // Standard-Vault bei Aktivierung anlegen, damit sofort Notizen abgelegt werden können.
    if (cfg.enabled && !fs.existsSync(cfg.vault)) {
      try { fs.mkdirSync(cfg.vault, { recursive: true }); } catch { /* */ }
    }
    writeCfg(cfg);
    let indexed = { files: cfg.files, chunks: cfg.chunks };
    if (cfg.enabled && fs.existsSync(cfg.vault)) indexed = reindex();
    reply.send({ ...obsidianStatus(), ...indexed });
  });

  fastify.post('/api/obsidian/reindex', { preHandler: requireAdmin }, async (_req, reply) => {
    const cfg = readCfg();
    if (!cfg.enabled) return reply.status(400).send({ error: 'Obsidian ist nicht aktiviert.' });
    if (!fs.existsSync(cfg.vault)) return reply.status(400).send({ error: `Vault nicht gefunden: ${cfg.vault}` });
    const r = reindex();
    reply.send({ ...obsidianStatus(), ...r });
  });

  fastify.get<{ Querystring: { q?: string } }>('/api/obsidian/search', { preHandler: requireAuth }, async (req, reply) => {
    const q = (req.query?.q || '').trim();
    if (!q) return reply.send({ hits: [] });
    reply.send({ hits: searchNotes(q, 6) });
  });
}
