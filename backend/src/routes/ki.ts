import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { hasBinary, privExec, safeExec } from '../lib/privilege';
import { proxyQueries } from '../db/index';
import { applyCaddy } from './proxy';

const OLLAMA = 'http://127.0.0.1:11434';

async function ollamaReq(path: string, init?: RequestInit) {
  return fetch(`${OLLAMA}${path}`, { signal: AbortSignal.timeout(10000), ...init });
}

export async function kiRoutes(fastify: FastifyInstance) {

  fastify.get('/api/ki/status', { preHandler: requireAuth }, async (_req, reply) => {
    const installed = hasBinary('ollama');
    if (!installed) return reply.send({ installed: false, running: false, version: null, port: 11434 });

    let running = false;
    try { const r = await ollamaReq('/'); running = r.status < 500; } catch { /* not running */ }

    const version = (await import('../lib/privilege')).safeExec('ollama --version 2>/dev/null')
      .trim().replace(/^ollama\s+version\s*/i, '') || null;

    reply.send({ installed, running, version, port: 11434 });
  });

  fastify.get('/api/ki/models', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('ollama')) return reply.send({ models: [] });
    try {
      const r = await ollamaReq('/api/tags');
      if (!r.ok) return reply.send({ models: [] });
      reply.send(await r.json());
    } catch { reply.send({ models: [] }); }
  });

  fastify.post<{ Body: { model: string } }>('/api/ki/pull', { preHandler: requireAdmin }, async (req, reply) => {
    const model = (req.body?.model ?? '').trim();
    if (!model || !/^[a-zA-Z0-9._:/@-]+$/.test(model)) return reply.status(400).send({ error: 'Ungültiger Modellname' });
    const proc = spawn('ollama', ['pull', model], { detached: true, stdio: 'ignore' });
    proc.unref();
    reply.send({ ok: true, queued: true });
  });

  fastify.delete<{ Params: { name: string } }>('/api/ki/models/:name', { preHandler: requireAdmin }, async (req, reply) => {
    const name = decodeURIComponent(req.params.name);
    if (!name || !/^[a-zA-Z0-9._:/@-]+$/.test(name)) return reply.status(400).send({ error: 'Ungültiger Modellname' });
    try {
      const r = await ollamaReq('/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({})) as { error?: string };
        return reply.status(500).send({ error: b.error ?? 'Löschen fehlgeschlagen' });
      }
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Löschen fehlgeschlagen' });
    }
  });

  fastify.post<{ Body: { action: 'start' | 'stop' } }>('/api/ki/control', { preHandler: requireAdmin }, async (req, reply) => {
    const action = req.body?.action;
    if (!['start', 'stop'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
    try {
      privExec(`systemctl ${action} ollama`, { timeout: 15000 });
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Steuerung fehlgeschlagen' });
    }
  });

  // ── Ollama model details (/api/show) ──
  fastify.post<{ Body: { name: string } }>('/api/ki/show', { preHandler: requireAuth }, async (req, reply) => {
    const name = (req.body?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'Kein Modellname' });
    try {
      const r = await ollamaReq('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, verbose: false }),
      });
      if (!r.ok) return reply.status(404).send({ error: 'Modell nicht gefunden' });
      reply.send(await r.json());
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Fehler' });
    }
  });

  // ── Running models (currently loaded in RAM / VRAM) ──
  fastify.get('/api/ki/ps', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('ollama')) return reply.send({ models: [] });
    try {
      const r = await ollamaReq('/api/ps');
      if (!r.ok) return reply.send({ models: [] });
      reply.send(await r.json());
    } catch { reply.send({ models: [] }); }
  });

  // ── Load a model into memory (RAM/GPU) with optional context length ──
  fastify.post<{ Body: { model: string; numCtx?: number; keepAlive?: number } }>(
    '/api/ki/load', { preHandler: requireAdmin }, async (req, reply) => {
    const model = (req.body?.model ?? '').trim();
    if (!model || !/^[a-zA-Z0-9._:/@-]+$/.test(model)) return reply.status(400).send({ error: 'Ungültiger Modellname' });
    const numCtx = Number(req.body?.numCtx);
    // keep_alive in Sekunden: -1 = unbegrenzt, 0 = sofort entladen, sonst Sekunden (Default 30 Min)
    const keepAlive = req.body?.keepAlive === undefined ? 1800 : Number(req.body.keepAlive);
    const body: Record<string, unknown> = { model, keep_alive: Number.isFinite(keepAlive) ? keepAlive : 1800 };
    if (Number.isFinite(numCtx) && numCtx > 0) body.options = { num_ctx: Math.round(numCtx) };
    try {
      // Ein leerer /api/generate-Request mit keep_alive lädt das Modell in den Speicher,
      // ohne Text zu erzeugen. Das kann je nach Modellgröße einige Sekunden dauern.
      const r = await ollamaReq('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({})) as { error?: string };
        return reply.status(500).send({ error: b.error ?? 'Laden fehlgeschlagen' });
      }
      await r.json().catch(() => ({}));
      reply.send({ ok: true });
    } catch (err) {
      const msg = err instanceof Error && err.name === 'TimeoutError'
        ? 'Zeitüberschreitung beim Laden (Modell evtl. sehr groß)'
        : err instanceof Error ? err.message : 'Laden fehlgeschlagen';
      reply.status(500).send({ error: msg });
    }
  });

  // ── Unload a model from memory ──
  fastify.post<{ Body: { model: string } }>('/api/ki/unload', { preHandler: requireAdmin }, async (req, reply) => {
    const model = (req.body?.model ?? '').trim();
    if (!model || !/^[a-zA-Z0-9._:/@-]+$/.test(model)) return reply.status(400).send({ error: 'Ungültiger Modellname' });
    try {
      const r = await ollamaReq('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({})) as { error?: string };
        return reply.status(500).send({ error: b.error ?? 'Entladen fehlgeschlagen' });
      }
      await r.json().catch(() => ({}));
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Entladen fehlgeschlagen' });
    }
  });

  // ── HuggingFace GGUF search proxy ──
  fastify.get<{ Querystring: { q: string } }>('/api/ki/hf-search', { preHandler: requireAuth }, async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return reply.send({ models: [] });
    try {
      // full=true liefert u. a. lastModified/createdAt (sonst fehlt das Datum → „Invalid Date")
      const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&direction=-1&limit=24&full=true`;
      const r = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Vault-Hub/1.0', 'Accept': 'application/json' },
      });
      if (!r.ok) return reply.send({ models: [] });
      const data = await r.json() as Array<{
        id: string; author: string; downloads: number; likes: number;
        lastModified?: string; createdAt?: string; pipeline_tag?: string; tags?: string[];
      }>;
      reply.send({
        models: data.map((m) => ({
          id: m.id, author: m.author, downloads: m.downloads, likes: m.likes,
          lastModified: m.lastModified ?? m.createdAt ?? null, pipeline_tag: m.pipeline_tag, tags: m.tags ?? [],
        })),
      });
    } catch {
      reply.send({ models: [] });
    }
  });

  // ── Hardware info + AI recommendations ──
  fastify.get('/api/ki/hardware', { preHandler: requireAuth }, async (_req, reply) => {
    const memInfo = safeExec('cat /proc/meminfo 2>/dev/null');
    const totalKb = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? '0');
    const totalGb = Math.round(totalKb / 1024 / 1024 * 10) / 10;

    const gpus: Array<{ name: string; vramMb: number; unified: boolean }> = [];

    // NVIDIA
    const nv = safeExec('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null');
    if (nv.trim()) {
      for (const line of nv.trim().split('\n')) {
        const p = line.split(',').map((s) => s.trim());
        if (p[0]) gpus.push({ name: p[0], vramMb: parseInt(p[1] ?? '0') || 0, unified: false });
      }
    }

    // AMD via amdgpu sysfs
    if (gpus.length === 0) {
      const cards = safeExec('ls /sys/class/drm/ 2>/dev/null').split(/\s+/).filter((d) => /^card\d+$/.test(d.trim()));
      for (const card of cards.slice(0, 2)) {
        const base = `/sys/class/drm/${card.trim()}/device`;
        if (!safeExec(`cat ${base}/gpu_busy_percent 2>/dev/null`).trim()) continue;
        const vramTotal = parseInt(safeExec(`cat ${base}/mem_info_vram_total 2>/dev/null`).trim()) || 0;
        const lspciLine = safeExec('lspci 2>/dev/null | grep -iE "VGA compatible|3D controller|Display controller" | head -1');
        const name = lspciLine.replace(/^[^\s]+\s+[^:]+:\s*/, '').trim() || 'AMD GPU';
        const vramMb = vramTotal > 0 ? Math.round(vramTotal / 1024 / 1024) : 0;
        const unified = vramTotal < 256 * 1024 * 1024;
        gpus.push({ name, vramMb, unified });
        break;
      }
    }

    // Max model size formula:
    // Use effective VRAM if dedicated GPU present, otherwise RAM.
    // Reserve 4 GB for OS. Use 70% of remaining for model (leaves headroom for KV-cache).
    const dedicatedVramGb = gpus.filter(g => !g.unified).reduce((s, g) => s + g.vramMb / 1024, 0);
    const unifiedVramGb   = gpus.filter(g =>  g.unified).reduce((s, g) => s + g.vramMb / 1024, 0);

    let basis = 0;
    let basisLabel = '';
    let explanation = '';

    if (dedicatedVramGb >= 4) {
      basis = dedicatedVramGb;
      basisLabel = `${dedicatedVramGb.toFixed(0)} GB dediziertem VRAM`;
      explanation = `Du hast eine dedizierte GPU mit ${dedicatedVramGb.toFixed(0)} GB VRAM. Ollama lädt das Modell vollständig in den GPU-Speicher, was deutlich schneller ist als CPU-Inferenz. Empfehlung: Modellgröße (quantisiert) ≤ ${dedicatedVramGb.toFixed(0)} × 0,85 = ${(dedicatedVramGb * 0.85).toFixed(0)} GB.`;
    } else if (unifiedVramGb >= 4) {
      // APU / unified memory: GPU + CPU share same RAM pool
      basis = totalGb; // use full system RAM since it's all one pool
      basisLabel = `${totalGb} GB Unified Memory (GPU+CPU teilen RAM)`;
      explanation = `Dein System verwendet Unified Memory Architecture (UMA): GPU und CPU teilen sich den gleichen ${totalGb} GB RAM-Pool. Die GPU-Seite belegt ca. ${unifiedVramGb.toFixed(0)} GB davon. Ollama kann den vollen RAM nutzen (nach Abzug ~4 GB für OS). Empfehlung: ≤ ${(Math.max(0, totalGb - 4) * 0.7).toFixed(0)} GB Modellgröße.`;
    } else {
      basis = totalGb;
      basisLabel = `${totalGb} GB RAM (CPU-Inferenz)`;
      explanation = `Keine dedizierte GPU erkannt – Ollama läuft auf der CPU. Faustformel: Modellgröße ≤ (RAM − 4 GB Betriebssystem) × 0,7 = ${(Math.max(0, totalGb - 4) * 0.7).toFixed(0)} GB. Die quantisierten Modelle (Q4_K_M) brauchen ca. 0,6 Byte pro Parameter, also passt ein 7B-Modell (~4,2 GB) locker in 16 GB RAM.`;
    }

    const maxModelGb = Math.max(1, Math.floor(Math.max(0, basis - 4) * 0.7));

    let recommendation = '';
    if (maxModelGb >= 35) recommendation = `${basisLabel} – 70B-Modelle möglich (quantisiert)`;
    else if (maxModelGb >= 18) recommendation = `${basisLabel} – bis 30B-Modelle empfohlen`;
    else if (maxModelGb >= 8)  recommendation = `${basisLabel} – bis 13B-Modelle empfohlen`;
    else if (maxModelGb >= 4)  recommendation = `${basisLabel} – 7B-Modelle ideal`;
    else if (maxModelGb >= 2)  recommendation = `${basisLabel} – 3B-Modelle empfohlen`;
    else                        recommendation = `${basisLabel} – nur 1–3B-Modelle`;

    reply.send({ totalRamGb: totalGb, gpus, recommendation, explanation, maxModelGb });
  });

  // ── HuggingFace: list GGUF files for a model ──
  fastify.get<{ Querystring: { id: string } }>('/api/ki/hf-files', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.query.id ?? '').trim();
    if (!id || !/^[a-zA-Z0-9_./-]+$/.test(id)) return reply.status(400).send({ error: 'Ungültige ID' });
    try {
      const r = await fetch(`https://huggingface.co/api/models/${id}`, {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'Vault-Hub/1.0' },
      });
      if (!r.ok) return reply.send({ files: [] });
      const data = await r.json() as { siblings?: Array<{ rfilename: string; size?: number }> };
      const PREF = ['Q4_K_M','Q5_K_M','Q4_K_S','Q8_0','Q6_K','Q5_K_S','Q4_0','Q3_K_M','Q3_K_L','Q2_K','IQ4_XS','IQ3_M','F16','BF16'];
      const files = (data.siblings ?? [])
        .filter((f) => f.rfilename.toLowerCase().endsWith('.gguf') && !f.rfilename.toLowerCase().includes('-split-'))
        .map((f) => {
          const stem = f.rfilename.replace(/\.gguf$/i, '');
          const q = stem.match(/[_-]([IQ][QF]?[0-9][A-Z0-9_]*[KLMSXB]?)$/i)?.[1]?.toUpperCase() ?? stem.split(/[_-]/).pop()?.toUpperCase() ?? 'DEFAULT';
          return { filename: f.rfilename, quant: q, size: f.size ?? 0, ollamaTag: q, pref: PREF.indexOf(q) };
        })
        .sort((a, b) => (a.pref < 0 ? 999 : a.pref) - (b.pref < 0 ? 999 : b.pref));
      reply.send({ files: files.map(({ filename, quant, size, ollamaTag }) => ({ filename, quant, size, ollamaTag })) });
    } catch {
      reply.send({ files: [] });
    }
  });

  // ── Ollama network access ──
  fastify.get('/api/ki/access', { preHandler: requireAuth }, async (_req, reply) => {
    const env = safeExec('systemctl show ollama --property=Environment --value 2>/dev/null').trim();
    const hostMatch = env.match(/OLLAMA_HOST=["']?([^\s"']+)/);
    const host = hostMatch?.[1] ?? '127.0.0.1:11434';
    const port = host.split(':')[1] ?? '11434';
    const hostname = safeExec('hostname 2>/dev/null').trim() || 'server';
    const lanIps = safeExec(
      "ip -4 addr show 2>/dev/null | grep 'inet ' | grep -vE '127\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.' | awk '{print $2}' | cut -d'/' -f1"
    ).split('\n').map((s) => s.trim()).filter((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s));
    // Check if Caddy has an HTTPS proxy entry pointing at Ollama's port
    const ollamaProxy = proxyQueries.getAll.all().find((h) => h.target_port === 11434 && h.enabled);
    const httpsUrls: string[] = [];
    if (ollamaProxy?.https) {
      // hostname field may be space-separated ("ai-server 192.168.1.x") — split and build one URL per entry
      for (const h of (ollamaProxy.hostname ?? '').split(/\s+/).filter(Boolean)) {
        httpsUrls.push(`https://${h}`);
      }
    }
    const httpsProxyId = ollamaProxy?.id ?? null;
    const caddyAvailable = hasBinary('caddy');
    reply.send({ mode: host.startsWith('0.0.0.0') ? 'lan' : 'local', host, port, hostname, lanIps, httpsUrls, httpsProxyId, caddyAvailable });
  });

  // ── Ollama HTTPS proxy (enable / disable via Caddy) ──
  fastify.post('/api/ki/https', { preHandler: requireAdmin }, async (_req, reply) => {
    if (!hasBinary('caddy')) return reply.status(503).send({ error: 'Caddy nicht installiert (apt install caddy)' });
    const hostname = safeExec('hostname 2>/dev/null').trim() || 'server';
    const lanIps = safeExec(
      "ip -4 addr show 2>/dev/null | grep 'inet ' | grep -vE '127\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.' | awk '{print $2}' | cut -d'/' -f1"
    ).split('\n').map((s) => s.trim()).filter((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s));
    // Space-separated: Caddy accepts multiple hosts in one block ("host1 192.168.x.x { ... }")
    const caddySiteAddr = [hostname, ...lanIps].join(' ');
    try {
      proxyQueries.upsert.run(null, 'Ollama', caddySiteAddr, 'localhost', 11434, 1, 1);
      applyCaddy(proxyQueries.getAll.all());
      // Switch Ollama to local-only so HTTP port 11434 is unreachable from LAN
      const tmp = `/tmp/ollama-override-${process.pid}-https.conf`;
      writeFileSync(tmp, '[Service]\nEnvironment="OLLAMA_HOST=127.0.0.1:11434"\n');
      try { mkdirSync('/etc/systemd/system/ollama.service.d/', { recursive: true }); } catch {
        privExec(`bash -c 'mkdir -p /etc/systemd/system/ollama.service.d/'`, { timeout: 5000 });
      }
      privExec(`cp ${tmp} /etc/systemd/system/ollama.service.d/override.conf`, { timeout: 5000 });
      try { unlinkSync(tmp); } catch { /* */ }
      privExec('systemctl daemon-reload', { timeout: 10000 });
      privExec('systemctl restart ollama', { timeout: 20000 });
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'HTTPS konnte nicht aktiviert werden' });
    }
  });

  fastify.delete('/api/ki/https', { preHandler: requireAdmin }, async (_req, reply) => {
    const existing = proxyQueries.getAll.all().find((h) => h.target_port === 11434);
    try {
      if (existing) {
        proxyQueries.delete.run(existing.id);
        if (hasBinary('caddy')) applyCaddy(proxyQueries.getAll.all());
      }
      // Switch Ollama back to LAN so HTTP on port 11434 is reachable again
      const tmp = `/tmp/ollama-override-${process.pid}-http.conf`;
      writeFileSync(tmp, '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\n');
      try { mkdirSync('/etc/systemd/system/ollama.service.d/', { recursive: true }); } catch {
        privExec(`bash -c 'mkdir -p /etc/systemd/system/ollama.service.d/'`, { timeout: 5000 });
      }
      privExec(`cp ${tmp} /etc/systemd/system/ollama.service.d/override.conf`, { timeout: 5000 });
      try { unlinkSync(tmp); } catch { /* */ }
      privExec('systemctl daemon-reload', { timeout: 10000 });
      privExec('systemctl restart ollama', { timeout: 20000 });
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'HTTPS konnte nicht deaktiviert werden' });
    }
  });

  fastify.post<{ Body: { mode: 'local' | 'lan' } }>('/api/ki/access', { preHandler: requireAdmin }, async (req, reply) => {
    const mode = req.body?.mode;
    if (!['local', 'lan'].includes(mode)) return reply.status(400).send({ error: 'Ungültiger Modus' });
    const newHost = mode === 'lan' ? '0.0.0.0:11434' : '127.0.0.1:11434';
    const tmpPath = `/tmp/ollama-override-${process.pid}.conf`;
    writeFileSync(tmpPath, `[Service]\nEnvironment="OLLAMA_HOST=${newHost}"\n`);
    try {
      try { mkdirSync('/etc/systemd/system/ollama.service.d/', { recursive: true }); } catch {
        privExec(`bash -c 'mkdir -p /etc/systemd/system/ollama.service.d/'`, { timeout: 5000 });
      }
      privExec(`cp ${tmpPath} /etc/systemd/system/ollama.service.d/override.conf`, { timeout: 5000 });
      privExec(`systemctl daemon-reload`, { timeout: 10000 });
      privExec(`systemctl restart ollama`, { timeout: 20000 });
      reply.send({ ok: true, mode, host: newHost });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Zugriff konnte nicht geändert werden' });
    } finally {
      try { unlinkSync(tmpPath); } catch { /* */ }
    }
  });
}
