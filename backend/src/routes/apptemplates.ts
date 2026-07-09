import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries, categoryQueries } from '../db/index';
import { notify } from '../lib/notify';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
const execFileP = promisify(execFile);

// ─── Shared types ────────────────────────────────────────────────────────────

interface StorePort { container: number; host: number; proto: 'tcp' | 'udp' }
interface StoreVol  { name: string; path: string }
interface StoreEnv  { key: string; label: string; default: string; required: boolean; secret: boolean }

export interface StoreItem {
  id: string;
  name: string;
  image: string;
  icon: string;
  description: string;
  category: string;
  ports: StorePort[];
  volumes: StoreVol[];
  env: StoreEnv[];
  restart: string;
  source: 'unraid' | 'dockerhub';
  stars?: number;
  installed?: boolean;
}

// ─── Unraid CA feed cache ─────────────────────────────────────────────────────

let unraidApps: StoreItem[] = [];
let unraidFetchedAt = 0;
let unraidWarming = false;
const UNRAID_FEED = 'https://assets.ca.unraid.net/feed/applicationFeed.json';
const CACHE_TTL  = 30 * 60 * 1000; // 30 min

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\r?\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function primaryCategory(catString: string, catMap: Record<string, string>): string {
  // Category field looks like "GameServers: MediaApp:Other" – space-separated tokens
  // where each "Word:" is a category key and "Word:Sub" a sub-category.
  if (!catString) return 'Sonstige';
  const first = catString.trim().split(/\s+/)[0];
  const key = first.replace(/:.*$/, ''); // strip ":Sub" or trailing ":"
  return catMap[key] || key || 'Sonstige';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseConfig(raw: any): { ports: StorePort[]; volumes: StoreVol[]; env: StoreEnv[] } {
  const items: unknown[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const ports: StorePort[] = [];
  const volumes: StoreVol[] = [];
  const env: StoreEnv[] = [];

  for (const c of items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = c as any;
    const attr: Record<string, string> = item['@attributes'] ?? {};
    const type = attr.Type ?? '';
    const target = attr.Target ?? '';
    const def = (attr.Default ?? String(item.value ?? '')).trim();
    const label = attr.Name ?? target ?? 'config';
    const required = attr.Required === 'true';
    const mask = attr.Mask === 'true';

    if (type === 'Port') {
      const cn = parseInt(target, 10);
      if (cn > 0) {
        const hn = parseInt(def, 10) || cn;
        const proto: 'tcp' | 'udp' = attr.Mode?.toLowerCase() === 'udp' ? 'udp' : 'tcp';
        ports.push({ container: cn, host: hn, proto });
      }
    } else if (type === 'Path') {
      if (target) volumes.push({ name: label, path: target });
    } else if (type === 'Variable') {
      if (target) env.push({ key: target, label, default: def, required, secret: mask });
    }
  }
  return { ports, volumes, env };
}

async function warmUnraidCache(): Promise<void> {
  if (unraidWarming) return;
  unraidWarming = true;
  try {
    const res = await fetch(UNRAID_FEED, {
      headers: { 'User-Agent': 'vault-hub/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;

    // Build human-readable category map from d.categories
    const catMap: Record<string, string> = {};
    for (const c of data.categories ?? []) {
      const key = String(c.Cat ?? '').replace(/:$/, '');
      if (key) catMap[key] = c.Des;
      for (const sub of c.Sub ?? []) {
        const sk = String(sub.Cat ?? '').replace(/:$/, '');
        if (sk) catMap[sk] = sub.Des;
      }
    }

    const seen = new Set<string>();
    const apps: StoreItem[] = [];
    for (const app of data.applist ?? []) {
      if (!app.Name || !app.Repository) continue;
      let id = slugify(String(app.Name));
      if (seen.has(id)) id = `${id}-${seen.size}`;
      seen.add(id);
      const { ports, volumes, env } = parseConfig(app.Config);
      apps.push({
        id,
        name: String(app.Name),
        image: String(app.Repository),
        icon: String(app.Icon ?? '').replace(/^http:\/\//i, 'https://'),
        description: stripHtml(String(app.Overview ?? '')).slice(0, 500),
        category: primaryCategory(String(app.Category ?? ''), catMap),
        ports,
        volumes,
        env,
        restart: 'unless-stopped',
        source: 'unraid',
      });
    }
    unraidApps = apps;
    unraidFetchedAt = Date.now();
  } finally {
    unraidWarming = false;
  }
}

// ─── Docker Hub proxy ─────────────────────────────────────────────────────────

async function searchDockerHub(q: string, page: number): Promise<{ results: StoreItem[]; total: number }> {
  const url = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&page_size=24&page=${page}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'vault-hub/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const results: StoreItem[] = (data.results ?? []).map((r: any) => ({
    id: slugify(r.repo_name),
    name: r.repo_name,
    image: `${r.repo_name}:latest`,
    icon: '',
    description: r.short_description ?? '',
    category: r.is_official ? 'Official' : 'Community',
    ports: [],
    volumes: [],
    env: [],
    restart: 'unless-stopped',
    source: 'dockerhub' as const,
    stars: r.star_count ?? 0,
  }));
  return { results, total: data.count ?? results.length };
}

// ─── Container install (shared) ───────────────────────────────────────────────

async function pullImage(image: string): Promise<void> {
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
}

/** Auf dem Host lauschende Ports (auch von Nicht-Docker-Diensten wie systemd-resolved auf 53). */
async function hostListeningPorts(): Promise<Map<string, string>> {
  const used = new Map<string, string>();
  try {
    // -H ohne Header, -t TCP, -u UDP, -l listening, -n numerisch, -p Prozess
    const { stdout } = await execFileP('ss', ['-Htulnp'], { timeout: 6000 });
    for (const line of stdout.split('\n')) {
      // Spalten: Netid State Recv-Q Send-Q Local:Port Peer:Port Process
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const proto = cols[0].toLowerCase().startsWith('udp') ? 'udp' : 'tcp';
      const local = cols[4];
      const m = local.match(/:(\d+)$/);
      if (!m) continue;
      const port = m[1];
      // Prozessname aus dem letzten Feld extrahieren: users:(("systemd-resolve",pid=…))
      const procField = line.match(/users:\(\("([^"]+)"/);
      const proc = procField ? procField[1] : 'Host-Dienst';
      const key = `${port}/${proto}`;
      if (!used.has(key)) used.set(key, proc);
    }
  } catch { /* ss nicht verfügbar oder keine Rechte */ }
  return used;
}

/** Belegte Host-Ports aller (auch gestoppter) Container + Host-Dienste → Map port/proto → Name. */
async function usedHostPorts(): Promise<Map<string, string>> {
  const used = new Map<string, string>();
  // Zuerst Host-Dienste (z. B. systemd-resolved auf 53), Container überschreiben ggf. den Eigentümer
  for (const [key, proc] of await hostListeningPorts()) used.set(key, proc);
  try {
    const cs = await docker.listContainers({ all: true });
    for (const c of cs) {
      const cname = (c.Names?.[0] ?? c.Id.slice(0, 12)).replace(/^\//, '');
      for (const p of c.Ports ?? []) {
        if (p.PublicPort) used.set(`${p.PublicPort}/${(p.Type || 'tcp').toLowerCase()}`, cname);
      }
    }
  } catch { /* docker nicht erreichbar */ }
  return used;
}

/** Nächsten freien Host-Port ab `from` finden (nicht von Containern belegt, nicht in `also` reserviert). */
function suggestFreePort(from: number, proto: string, used: Map<string, string>, also: Set<string>): number {
  // Bei privilegierten Ports (z.B. 53) lieber in den hohen Bereich ausweichen
  let candidate = from < 1024 ? from + 10000 : from + 1;
  for (let i = 0; i < 5000; i++) {
    const key = `${candidate}/${proto}`;
    if (candidate <= 65535 && !used.has(key) && !also.has(key)) return candidate;
    candidate = candidate >= 65535 ? 1024 : candidate + 1;
  }
  return from; // Fallback (sollte praktisch nie passieren)
}

interface InstallBody {
  name?: string;
  image: string;
  ports?: { container: number; host: number; proto?: string }[];
  volumes?: { name: string; path: string }[];
  env?: Record<string, string>;
  restart?: string;
  templateId?: string;
  category?: string;
  icon?: string;
  networkMode?: string;   // e.g. 'bridge', 'host', or a named macvlan network name
  staticIp?: string;      // only used when networkMode is a named network
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function appTemplateRoutes(fastify: FastifyInstance) {
  // Legacy endpoint (curated list replaced by store – kept for compat)
  fastify.get('/api/app-templates', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({ templates: [] });
  });

  // ── Store: cache status ──
  fastify.get('/api/app-templates/store/status', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({
      cached: unraidFetchedAt > 0,
      warming: unraidWarming,
      appCount: unraidApps.length,
      fetchedAt: unraidFetchedAt > 0 ? new Date(unraidFetchedAt).toISOString() : null,
    });
  });

  // ── Store: trigger cache warm (admin) ──
  fastify.post('/api/app-templates/store/warm', { preHandler: requireAdmin }, async (_req, reply) => {
    if (!unraidWarming) void warmUnraidCache();
    reply.send({ ok: true, warming: true });
  });

  // ── Store: search ──
  fastify.get<{ Querystring: { q?: string; source?: string; page?: string; category?: string } }>(
    '/api/app-templates/store/search',
    { preHandler: requireAuth },
    async (req, reply) => {
      const q      = (req.query.q ?? '').trim().toLowerCase();
      const source = req.query.source === 'dockerhub' ? 'dockerhub' : 'unraid';
      const page   = Math.max(1, parseInt(req.query.page ?? '1', 10));
      const cat    = (req.query.category ?? '').trim();
      const limit  = 24;

      // ── Docker Hub ──
      if (source === 'dockerhub') {
        if (q.length < 2) return reply.send({ results: [], total: 0, source, cached: true });
        try {
          const { results, total } = await searchDockerHub(q, page);
          return reply.send({ results, total, source, cached: true, page, limit });
        } catch (err) {
          const detail = err instanceof Error ? err.message : '';
          return reply.status(502).send({ error: `Docker Hub nicht erreichbar: ${detail}`, errorKey: 'err.dockerhub_unreachable', errorVars: { detail } });
        }
      }

      // ── Unraid ──
      const stale = Date.now() - unraidFetchedAt > CACHE_TTL;
      if ((stale || unraidApps.length === 0) && !unraidWarming) void warmUnraidCache();
      if (unraidApps.length === 0) {
        return reply.send({ results: [], total: 0, source, cached: false, warming: unraidWarming });
      }

      // Determine installed images
      let installedImages = new Set<string>();
      try {
        const cs = await docker.listContainers({ all: true });
        installedImages = new Set(cs.map((c) => c.Image));
      } catch { /* docker unavailable */ }

      let filtered = unraidApps;
      if (cat) filtered = filtered.filter((a) => a.category.toLowerCase() === cat.toLowerCase());
      if (q.length >= 2) {
        filtered = filtered.filter((a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.image.toLowerCase().includes(q),
        );
      }

      const total = filtered.length;
      const results = filtered.slice((page - 1) * limit, page * limit)
        .map((a) => ({ ...a, installed: installedImages.has(a.image) }));

      // Distinct categories from current (unfiltered) list for sidebar
      const categories = [...new Set(unraidApps.map((a) => a.category))].sort();

      return reply.send({ results, total, source, cached: true, page, limit, categories });
    },
  );

  // ── Store: install ──
  fastify.post<{ Body: InstallBody }>(
    '/api/app-templates/store/install',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const body = req.body ?? {} as InstallBody;
      if (!body.image) return reply.status(400).send({ error: 'Image erforderlich' });

      const name = (body.name || body.image.split('/').pop()?.replace(/:.*$/, '') || 'container')
        .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);

      // Bei eigener IP (named network) werden keine Host-Ports gebunden → keine Konfliktprüfung nötig
      const usesOwnIp = !!(body.networkMode && !['bridge', 'host', 'none', ''].includes(body.networkMode));

      // ── Vorab-Prüfung: schon belegte Host-Ports erkennen (bevor wir das Image ziehen) ──
      if (!usesOwnIp && body.networkMode !== 'host') {
        const used = await usedHostPorts();
        const reserved = new Set<string>();   // bereits vorgeschlagene Ersatzports nicht doppelt vergeben
        const conflicts: string[] = [];
        // Pro Konflikt einen freien Ersatz-Host-Port vorschlagen (Container-Port bleibt gleich)
        const suggestions: { container: number; host: number; proto: string; suggestedHost: number; owner: string }[] = [];
        for (const p of body.ports ?? []) {
          const proto = (p.proto === 'udp' ? 'udp' : 'tcp');
          const owner = used.get(`${p.host}/${proto}`);
          if (owner) {
            const free = suggestFreePort(p.host, proto, used, reserved);
            reserved.add(`${free}/${proto}`);
            conflicts.push(`Port ${p.host}/${proto} (belegt von „${owner}") → frei: ${free}`);
            suggestions.push({ container: p.container, host: p.host, proto, suggestedHost: free, owner });
          }
        }
        if (conflicts.length) {
          return reply.status(409).send({
            error: `Host-Port bereits belegt: ${conflicts.join(', ')}. ` +
              `Übernimm die vorgeschlagenen freien Ports – oder gib dem Container über ein Macvlan-Netzwerk eine eigene IP (dann entfällt der Port-Konflikt, z. B. für AdGuard/Pi-hole auf Port 53).`,
            errorKey: 'err.hostport_in_use', errorVars: { list: conflicts.join(', ') },
            conflicts: suggestions,
          });
        }
      }

      // Existiert bereits ein Container mit diesem Namen? (sonst „name already in use")
      try {
        const existing = await docker.listContainers({ all: true, filters: { name: [`^/${name}$`] } });
        if (existing.length) {
          return reply.status(409).send({ error: `Ein Container namens „${name}" existiert bereits. Bitte einen anderen Namen wählen.`, errorKey: 'err.container_name_exists', errorVars: { name } });
        }
      } catch { /* weiter */ }

      let createdId: string | null = null;
      try {
        await pullImage(body.image);

        const exposedPorts: Record<string, object> = {};
        const portBindings: Record<string, { HostPort: string }[]> = {};
        for (const p of body.ports ?? []) {
          const proto = (p.proto === 'udp' ? 'udp' : 'tcp') as string;
          const key = `${p.container}/${proto}`;
          exposedPorts[key] = {};
          portBindings[key] = [{ HostPort: String(p.host) }];
        }

        const env = Object.entries(body.env ?? {}).map(([k, v]) => `${k}=${v}`);
        const binds = (body.volumes ?? []).map((v) => {
          const safe = v.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'vol';
          return `${name}_${safe}:${v.path}`;
        });

        // Network config: if a named macvlan/ipvlan network is chosen we connect
        // the container to it after creation so we can supply a static IP.
        // If networkMode is 'host' we skip port bindings (not needed with host net).
        const namedNetwork = body.networkMode && !['bridge', 'host', 'none', ''].includes(body.networkMode)
          ? body.networkMode : null;

        const createOpts: Parameters<typeof docker.createContainer>[0] = {
          Image: body.image,
          name,
          Env: env,
          ExposedPorts: exposedPorts,
          HostConfig: {
            PortBindings: namedNetwork ? {} : portBindings,
            Binds: binds,
            RestartPolicy: { Name: body.restart ?? 'unless-stopped' },
            NetworkMode: namedNetwork ? namedNetwork : (body.networkMode || 'bridge'),
          },
          Labels: {
            'vault-hub.template': body.templateId ?? name,
            'vault-hub.source': body.templateId ? 'unraid' : 'dockerhub',
          },
        };

        // For named networks with a static IP we use NetworkingConfig at create time
        if (namedNetwork) {
          const endpointCfg: Record<string, unknown> = {};
          if (body.staticIp) endpointCfg.IPAMConfig = { IPv4Address: body.staticIp };
          createOpts.NetworkingConfig = { EndpointsConfig: { [namedNetwork]: endpointCfg } };
        }

        const container = await docker.createContainer(createOpts);
        createdId = container.id;
        await container.start();
        if (body.category) {
          try { categoryQueries.set.run(container.id, body.category); } catch { /* */ }
        }
        if (body.icon) {
          try { categoryQueries.setIcon.run(container.id, body.icon); } catch { /* */ }
        }
        auditQueries.log.run(req.user.id, 'store.install', body.image);
        void notify('success', `App „${name}" installiert`, `Container „${name}" wurde aus dem Store gestartet.`, 'container');
        reply.status(201).send({ ok: true, id: container.id, name });
      } catch (err: unknown) {
        // Aufräumen: ein bereits erstellter (aber nicht gestarteter) Container darf
        // nicht als „Erstellt"-Leiche zurückbleiben.
        if (createdId) {
          try { await docker.getContainer(createdId).remove({ force: true }); } catch { /* schon weg */ }
        }
        const raw = err instanceof Error ? err.message : 'Installation fehlgeschlagen';
        // Häufigsten Docker-Fehler in Klartext übersetzen
        if (/address already in use|port is already allocated/i.test(raw)) {
          reply.status(500).send({
            error: 'Ein benötigter Host-Port ist bereits belegt (z. B. Port 53 durch systemd-resolved). ' +
              'Wähle einen anderen Host-Port oder gib dem Container über ein Macvlan-Netzwerk eine eigene IP.',
            errorKey: 'err.hostport_allocated',
          });
        } else {
          reply.status(500).send({ error: raw });
        }
      }
    },
  );

  // Legacy per-id install (no-op – curated list removed)
  fastify.post<{ Params: { id: string } }>(
    '/api/app-templates/:id/install',
    { preHandler: requireAdmin },
    async (_req, reply) => {
      reply.status(404).send({ error: 'Kuratierte Vorlagen wurden durch den App-Store ersetzt. Bitte nutze /api/app-templates/store/install.' });
    },
  );
}
