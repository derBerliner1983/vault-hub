#!/usr/bin/env node
// Vault-Hub Web-MCP-Server (stdio)
// Stellt zwei Werkzeuge bereit, mit denen ein LLM aufs Internet zugreifen kann:
//   • web_search(query, max)  – DuckDuckGo-Suche (kein API-Key nötig)
//   • web_fetch(url, maxChars) – Seiteninhalt als Klartext
// Nutzbar in jedem MCP-Client (Claude Desktop, Claude Code, …). Keine externen
// Abhängigkeiten außer @modelcontextprotocol/sdk – siehe README.md.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const UA = 'Mozilla/5.0 (compatible; Vault-Hub-MCP/1.0)';

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
}
function stripHtml(html) {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

async function webSearch(query, max = 5) {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Suche HTTP ${res.status}`);
  const html = await res.text();
  const out = []; const seen = new Set();
  const re = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < max) {
    let href = decodeEntities(m[1]);
    const dd = href.match(/uddg=([^&]+)/);
    if (dd) { try { href = decodeURIComponent(dd[1]); } catch { /* */ } }
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
    seen.add(href);
    out.push({ title: stripHtml(m[2]).slice(0, 160), url: href });
  }
  return out;
}

async function webFetch(url, maxChars = 4000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Abruf HTTP ${res.status}`);
  return stripHtml(await res.text()).slice(0, maxChars);
}

const server = new Server({ name: 'vault-hub-web', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'web_search',
      description: 'Search the web (DuckDuckGo) and return the top result titles and URLs.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, max: { type: 'number', description: 'max results (default 5)' } },
        required: ['query'],
      },
    },
    {
      name: 'web_fetch',
      description: 'Fetch a web page and return its readable text content.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, maxChars: { type: 'number', description: 'max characters (default 4000)' } },
        required: ['url'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === 'web_search') {
      const results = await webSearch(String(args.query), Math.min(10, Number(args.max) || 5));
      const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join('\n') || 'Keine Treffer.';
      return { content: [{ type: 'text', text }] };
    }
    if (name === 'web_fetch') {
      const text = await webFetch(String(args.url), Math.min(20000, Number(args.maxChars) || 4000));
      return { content: [{ type: 'text', text: text || '(kein Textinhalt)' }] };
    }
    return { content: [{ type: 'text', text: `Unbekanntes Werkzeug: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: 'text', text: `Fehler: ${e?.message || e}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
