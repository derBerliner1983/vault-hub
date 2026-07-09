import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireAdmin } from '../middleware/auth';

// ── Internetzugriff für die KI (Live-Websuche als Kontext) ───────────────────────
// Wenn aktiviert, sucht Vault-Hub bei KI-Fragen im Web (DuckDuckGo, ohne API-Key),
// holt die Trefferseiten und stellt kurze Textausschnitte als Kontext bereit –
// analog zur Obsidian-Wissensbasis. So kann das lokale Modell aktuelle Infos nutzen.

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CFG_PATH = path.join(DATA_DIR, 'websearch.json');

type WebCfg = { enabled: boolean; maxResults: number };
function readCfg(): WebCfg {
  try { return { enabled: false, maxResults: 3, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf-8')) }; }
  catch { return { enabled: false, maxResults: 3 }; }
}
function writeCfg(c: WebCfg): void {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CFG_PATH, JSON.stringify(c, null, 2)); } catch { /* */ }
}

export function webSearchEnabled(): boolean { return readCfg().enabled; }

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
}
function stripHtml(html: string): string {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

type Result = { title: string; url: string; snippet: string };

/** DuckDuckGo-Lite-HTML durchsuchen (kein API-Key nötig). */
export async function webSearch(query: string, max = 3): Promise<Result[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Vault-Hub/1.0)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Suche ${res.status}`);
  const html = await res.text();
  const out: Result[] = [];
  const seen = new Set<string>();
  // Lite-Layout: Ergebnis-Links als <a class="result-link" href="…">Titel</a>
  const re = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    let href = decodeEntities(m[1]);
    const dd = href.match(/uddg=([^&]+)/); // DDG-Redirect entpacken
    if (dd) { try { href = decodeURIComponent(dd[1]); } catch { /* */ } }
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
    seen.add(href);
    out.push({ title: stripHtml(m[2]).slice(0, 160), url: href, snippet: '' });
  }
  return out;
}

/** Seiteninhalt als Klartext holen (gekürzt). */
async function fetchText(url: string, maxChars = 1500): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Vault-Hub/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(ct)) return '';
    return stripHtml(await res.text()).slice(0, maxChars);
  } catch { return ''; }
}

/** Fertiger Web-Kontextblock für den System-Prompt (oder ''). */
export async function webContext(query: string): Promise<string> {
  const cfg = readCfg();
  if (!cfg.enabled) return '';
  try {
    const results = await webSearch(query, cfg.maxResults);
    if (!results.length) return '';
    const bodies = await Promise.all(results.map(async (r) => {
      const text = await fetchText(r.url);
      return `Quelle: ${r.title} (${r.url})\n${text || r.snippet}`.trim();
    }));
    return bodies.filter(Boolean).join('\n\n---\n\n').slice(0, 4000);
  } catch { return ''; }
}

export async function webSearchRoutes(fastify: FastifyInstance) {
  fastify.get('/api/websearch/status', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send(readCfg());
  });

  fastify.post<{ Body: { enabled?: boolean; maxResults?: number } }>('/api/websearch/config', { preHandler: requireAdmin }, async (req, reply) => {
    const cfg = readCfg();
    if (typeof req.body?.enabled === 'boolean') cfg.enabled = req.body.enabled;
    if (typeof req.body?.maxResults === 'number') cfg.maxResults = Math.max(1, Math.min(6, Math.round(req.body.maxResults)));
    writeCfg(cfg);
    reply.send(cfg);
  });

  // Testsuche (zeigt, dass der Internetzugriff funktioniert)
  fastify.get<{ Querystring: { q?: string } }>('/api/websearch/test', { preHandler: requireAuth }, async (req, reply) => {
    const q = (req.query?.q || '').trim();
    if (!q) return reply.send({ results: [] });
    try { reply.send({ results: await webSearch(q, 4) }); }
    catch (e) { reply.status(502).send({ error: e instanceof Error ? e.message : 'Suche fehlgeschlagen' }); }
  });
}
