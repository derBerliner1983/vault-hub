import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries } from '../db/index';
import { isRoot, privExec, safeExec } from '../lib/privilege';

const execFileP = promisify(execFile);
const requireCJS = createRequire(__filename);

const DATA_DIR = process.env.DATA_DIR || '/var/lib/vault-hub';
const PLUGINS_DIR = path.join(DATA_DIR, 'plugins');

export interface ServiceToggleSpec {
  label?: string;
  service: string;
  enableCmd?: string;
  disableCmd?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  icon?: string;
  description?: string | Record<string, string>;
  type?: 'app' | 'extension';
  source?: string;
  permissions?: string[];
  i18n?: Record<string, Record<string, string>>;
  // Optionales Plugin-Backend (fertiges CommonJS-Modul mit register(fastify, ctx)).
  backend?: { type?: string; entry: string };
  contributes?: {
    nav?: { section?: string; label: string; route: string; icon?: string };
    settingsPanel?: { label: string; ui?: string };
    serviceToggle?: ServiceToggleSpec;
    dashboardWidget?: { label: string; ui?: string };
    [k: string]: unknown;
  };
}

/** Kontext, den der Kern jedem Plugin-Backend übergibt. */
export interface PluginContext {
  pluginId: string;
  pluginDir: string;
  isRoot: boolean;
  privExec: typeof privExec;
  safeExec: typeof safeExec;
  audit: (userId: number | null, action: string, target?: string | null) => void;
}

async function readManifest(id: string): Promise<PluginManifest | null> {
  try {
    const raw = await fsp.readFile(path.join(PLUGINS_DIR, id, 'plugin.json'), 'utf8');
    return JSON.parse(raw) as PluginManifest;
  } catch { return null; }
}

/** id auf sichere Zeichen begrenzen (verhindert Pfad-Traversal). */
function safeId(id: string): string {
  return String(id).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 64);
}

export async function readManifestsSafe(): Promise<PluginManifest[]> {
  return readManifests();
}

async function readManifests(): Promise<PluginManifest[]> {
  const out: PluginManifest[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(PLUGINS_DIR, { withFileTypes: true });
  } catch {
    return out; // Verzeichnis existiert noch nicht → keine Plugins
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const manifestPath = path.join(PLUGINS_DIR, e.name, 'plugin.json');
    try {
      const raw = await fsp.readFile(manifestPath, 'utf8');
      const m = JSON.parse(raw) as PluginManifest;
      if (m && m.id && m.name && m.version) out.push(m);
    } catch { /* ungültiges/fehlendes Manifest überspringen */ }
  }
  return out;
}

/** Quelle in eine klonbare Git-URL + optionalen Unterordner auflösen. */
function resolveSource(source: string): { url: string; subpath?: string } {
  const s = source.trim();
  if (s.startsWith('github:')) {
    const parts = s.slice('github:'.length).split('/').filter(Boolean);
    const [owner, repo, ...rest] = parts;
    return { url: `https://github.com/${owner}/${repo}.git`, subpath: rest.length ? rest.join('/') : undefined };
  }
  return { url: s };
}

export async function pluginRoutes(fastify: FastifyInstance) {
  // Installierte Plugins auflisten
  fastify.get('/api/plugins', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({ plugins: await readManifests() });
  });

  // Plugin installieren (git clone → PLUGINS_DIR/<id>, optional install.sh)
  fastify.post<{ Body: { id?: string; source?: string } }>(
    '/api/plugins/install',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const source = (req.body?.source || '').trim();
      if (!source) return reply.status(400).send({ error: 'Keine Quelle angegeben' });

      const { url, subpath } = resolveSource(source);
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vh-plugin-'));
      try {
        await execFileP('git', ['clone', '--depth', '1', url, tmp], { timeout: 120000 });
        const srcDir = subpath ? path.join(tmp, subpath) : tmp;
        const manifestPath = path.join(srcDir, 'plugin.json');
        const raw = await fsp.readFile(manifestPath, 'utf8').catch(() => null);
        if (!raw) return reply.status(400).send({ error: 'plugin.json nicht gefunden' });
        const manifest = JSON.parse(raw) as PluginManifest;
        const id = safeId(manifest.id || req.body?.id || '');
        if (!id) return reply.status(400).send({ error: 'Ungültige Plugin-ID' });
        manifest.source = source;

        await fsp.mkdir(PLUGINS_DIR, { recursive: true });
        const dest = path.join(PLUGINS_DIR, id);
        await fsp.rm(dest, { recursive: true, force: true });
        await fsp.cp(srcDir, dest, { recursive: true });
        // Quelle im Manifest festhalten (für spätere Updates)
        await fsp.writeFile(path.join(dest, 'plugin.json'), JSON.stringify(manifest, null, 2));

        // Optionales Setup-Skript des Plugins ausführen (apt-Pakete, Dienste …)
        const installScript = path.join(dest, 'install.sh');
        if (fs.existsSync(installScript)) {
          try { await execFileP('bash', [installScript], { cwd: dest, timeout: 300000 }); }
          catch (e) { req.log.warn(`Plugin install.sh fehlgeschlagen: ${e instanceof Error ? e.message : e}`); }
        }

        auditQueries.log.run(req.user.id, 'plugin.install', id);
        reply.send({ ok: true, id, version: manifest.version });
      } catch (err) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Installation fehlgeschlagen' });
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    }
  );

  // Plugin deinstallieren
  fastify.post<{ Body: { id?: string } }>(
    '/api/plugins/uninstall',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = safeId(req.body?.id || '');
      if (!id) return reply.status(400).send({ error: 'Ungültige Plugin-ID' });
      const dest = path.join(PLUGINS_DIR, id);
      if (!fs.existsSync(dest)) return reply.status(404).send({ error: 'Plugin nicht installiert' });
      // Optionales Deinstallations-Skript des Plugins
      const uninstallScript = path.join(dest, 'uninstall.sh');
      if (fs.existsSync(uninstallScript)) {
        try { await execFileP('bash', [uninstallScript], { cwd: dest, timeout: 120000 }); } catch { /* nicht fatal */ }
      }
      await fsp.rm(dest, { recursive: true, force: true });
      auditQueries.log.run(req.user.id, 'plugin.uninstall', id);
      reply.send({ ok: true });
    }
  );

  // Dienst-Status einer System-Erweiterung (serviceToggle) abfragen
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id/service', { preHandler: requireAdmin }, async (req, reply) => {
    const id = safeId(req.params.id);
    const svc = (await readManifest(id))?.contributes?.serviceToggle;
    if (!svc) return reply.status(404).send({ error: 'Plugin hat keinen Dienst-Schalter' });
    let active = false;
    try { active = safeExec(`systemctl is-active ${svc.service}`).trim() === 'active'; } catch { /* inaktiv/unbekannt */ }
    reply.send({ active, service: svc.service });
  });

  // System-Erweiterung ein-/ausschalten (serviceToggle)
  fastify.post<{ Params: { id: string }; Body: { enabled?: boolean } }>('/api/plugins/:id/service', { preHandler: requireAdmin }, async (req, reply) => {
    const id = safeId(req.params.id);
    const svc = (await readManifest(id))?.contributes?.serviceToggle;
    if (!svc) return reply.status(404).send({ error: 'Plugin hat keinen Dienst-Schalter' });
    const enabled = !!req.body?.enabled;
    const cmd = enabled
      ? (svc.enableCmd || `systemctl enable --now ${svc.service}`)
      : (svc.disableCmd || `systemctl disable --now ${svc.service}`);
    try {
      privExec(cmd, { timeout: 20000 });
      auditQueries.log.run(req.user.id, enabled ? 'plugin.service.enable' : 'plugin.service.disable', id);
      reply.send({ ok: true, active: enabled });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Dienst-Aktion fehlgeschlagen' });
    }
  });

  // Plugin-UI ausliefern (iframe-Host): /app/<id>/… → PLUGINS_DIR/<id>/ui/…
  fastify.get('/app/:id/*', async (req, reply) => {
    const id = safeId((req.params as { id: string }).id);
    const rest = (req.params as Record<string, string>)['*'] || 'index.html';
    const uiRoot = path.join(PLUGINS_DIR, id, 'ui');
    const target = path.normalize(path.join(uiRoot, rest || 'index.html'));
    // Pfad-Traversal verhindern
    if (!target.startsWith(uiRoot)) return reply.status(403).send({ error: 'Zugriff verweigert' });
    const finalPath = fs.existsSync(target) && fs.statSync(target).isDirectory()
      ? path.join(target, 'index.html') : target;
    if (!fs.existsSync(finalPath)) return reply.status(404).send({ error: 'Nicht gefunden' });
    const ext = path.extname(finalPath).toLowerCase();
    const types: Record<string, string> = {
      '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
    };
    reply.type(types[ext] || 'application/octet-stream');
    return reply.send(fs.createReadStream(finalPath));
  });
}

/**
 * Plugin-Backends laden: für jedes installierte Plugin mit `backend.entry` das
 * (fertig gebaute) CommonJS-Modul laden und dessen register(fastify, ctx)
 * aufrufen. Muss vor fastify.listen() geschehen. Neu installierte Backend-Plugins
 * werden nach einem Neustart aktiv (die Frontend-Navigation erscheint sofort).
 */
export async function loadPluginBackends(fastify: FastifyInstance): Promise<void> {
  const manifests = await readManifestsSafe();
  for (const m of manifests) {
    if (!m.backend?.entry) continue;
    const id = safeId(m.id);
    const pluginDir = path.join(PLUGINS_DIR, id);
    const entryPath = path.normalize(path.join(pluginDir, m.backend.entry));
    if (!entryPath.startsWith(pluginDir) || !fs.existsSync(entryPath)) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = requireCJS(entryPath);
      const register = mod.register || mod.default || mod;
      if (typeof register !== 'function') continue;
      const ctx: PluginContext = {
        pluginId: id,
        pluginDir,
        isRoot,
        privExec,
        safeExec,
        audit: (userId, action, target) => { try { auditQueries.log.run(userId, action, target ?? null); } catch { /* */ } },
      };
      await register(fastify, ctx);
      fastify.log.info(`Plugin-Backend geladen: ${id}`);
    } catch (err) {
      fastify.log.warn(`Plugin-Backend ${id} konnte nicht geladen werden: ${err instanceof Error ? err.message : err}`);
    }
  }
}
