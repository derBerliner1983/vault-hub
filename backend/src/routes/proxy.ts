import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import fs from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { proxyQueries, auditQueries, type ProxyRow } from '../db/index';
import { privExec, safeExec, hasBinary } from '../lib/privilege';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
const CADDYFILE = process.env.CADDYFILE || '/etc/caddy/Caddyfile';
const MANAGED_BEGIN = '# >>> vault-hub managed (do not edit) >>>';
const MANAGED_END = '# <<< vault-hub managed <<<';

// Possible locations of Caddy's internal root CA certificate.
const CA_PATHS = [
  '/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt',
  '/var/lib/caddy/.config/caddy/pki/authorities/local/root.crt',
  `${process.env.HOME || '/root'}/.local/share/caddy/pki/authorities/local/root.crt`,
];

function caddyInstalled(): boolean {
  return hasBinary('caddy');
}

function findCaCert(): string | null {
  for (const p of CA_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  // Try to locate it anywhere under /var/lib/caddy
  const found = safeExec('find /var/lib/caddy -name root.crt 2>/dev/null | head -1').trim();
  return found || null;
}

/** Render the managed Caddy block from DB entries. */
function renderCaddyBlock(hosts: ProxyRow[]): string {
  const blocks = hosts
    .filter((h) => h.enabled)
    .map((h) => {
      const upstream = `${h.target_host}:${h.target_port}`;
      if (h.https) {
        return `${h.hostname} {\n\ttls internal\n\treverse_proxy ${upstream}\n}`;
      }
      return `http://${h.hostname} {\n\treverse_proxy ${upstream}\n}`;
    });
  return `${MANAGED_BEGIN}\n${blocks.join('\n\n')}\n${MANAGED_END}\n`;
}

/** Write the managed block into the Caddyfile and reload Caddy. */
export function applyCaddy(hosts: ProxyRow[]): void {
  let existing = '';
  if (fs.existsSync(CADDYFILE)) existing = safeExec(`cat ${CADDYFILE}`, 4000);
  else existing = safeExec(`cat ${CADDYFILE} 2>/dev/null`, 4000);

  const block = renderCaddyBlock(hosts);
  const start = existing.indexOf(MANAGED_BEGIN);
  const end = existing.indexOf(MANAGED_END);
  let newConf: string;
  if (start !== -1 && end !== -1) {
    newConf = existing.slice(0, start) + block + existing.slice(end + MANAGED_END.length + 1);
  } else {
    newConf = (existing ? existing.replace(/\n*$/, '\n\n') : '') + block;
  }

  const tmp = `/tmp/corehub-caddy-${Date.now()}`;
  fs.writeFileSync(tmp, newConf);
  privExec(`mkdir -p /etc/caddy`);
  privExec(`cp ${tmp} ${CADDYFILE}`);
  fs.unlinkSync(tmp);
  // Reload (graceful); fall back to restart
  privExec(`systemctl reload caddy 2>/dev/null || systemctl restart caddy`, { timeout: 15000 });
}

function rowToDto(h: ProxyRow) {
  return {
    id: h.id,
    containerId: h.container_id,
    name: h.name,
    hostname: h.hostname,
    targetHost: h.target_host,
    targetPort: h.target_port,
    https: !!h.https,
    enabled: !!h.enabled,
    url: `${h.https ? 'https' : 'http'}://${h.hostname}`,
  };
}

export async function proxyRoutes(fastify: FastifyInstance) {
  fastify.get('/api/proxy', { preHandler: requireAuth }, async (_req, reply) => {
    const installed = caddyInstalled();
    const running = installed && safeExec('systemctl is-active caddy 2>/dev/null').trim() === 'active';
    const hosts = proxyQueries.getAll.all().map(rowToDto);
    reply.send({
      available: installed,
      running,
      caReady: !!findCaCert(),
      hosts,
      message: installed ? undefined : 'Caddy nicht installiert (apt install caddy)',
    });
  });

  // Containers as proxy candidates – inkl. erreichbarer Bridge-IP (vom Host nutzbar)
  // und eigener Macvlan-/ipvlan-IPs (vom Host NICHT erreichbar → für Warnungen).
  fastify.get('/api/proxy/candidates', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      // Treiber je Netzwerk ermitteln (bridge = host-erreichbar, macvlan/ipvlan = nicht)
      const netDriver = new Map<string, string>();
      try {
        for (const n of await docker.listNetworks()) netDriver.set(n.Name, n.Driver);
      } catch { /* */ }

      const containers = await docker.listContainers({ all: false });
      const existing = new Set(proxyQueries.getAll.all().map((h) => h.container_id));
      // Alle eigenen (macvlan/ipvlan) Container-IPs sammeln – für die Hostname-Warnung
      const macvlanIps: string[] = [];

      const candidates = containers.map((c) => {
        const name = (c.Names[0] ?? '').replace(/^\//, '');
        const nets = c.NetworkSettings?.Networks ?? {};
        let reachableHost: string | undefined;          // bridge-IP (host-erreichbar)
        const ownIps: string[] = [];                    // macvlan/ipvlan-IPs
        for (const [netName, info] of Object.entries(nets)) {
          const ip = (info as { IPAddress?: string }).IPAddress;
          if (!ip) continue;
          const drv = netDriver.get(netName) ?? (netName === 'bridge' ? 'bridge' : '');
          if (drv === 'macvlan' || drv === 'ipvlan') { ownIps.push(ip); macvlanIps.push(ip); }
          else if (!reachableHost) reachableHost = ip;  // bridge / custom bridge
        }
        // Interner Container-Port (bevorzugt veröffentlichter, sonst privater)
        const pub = (c.Ports ?? []).find((p) => p.PublicPort)?.PublicPort;
        const priv = (c.Ports ?? []).find((p) => p.PrivatePort && (p.Type ?? 'tcp') === 'tcp')?.PrivatePort;
        const port = pub ?? priv ?? 0;
        return { id: c.Id, name, port, alreadyProxied: existing.has(c.Id), reachableHost, ownIps };
      });

      reply.send({ candidates, macvlanIps });
    } catch {
      reply.send({ candidates: [], macvlanIps: [] });
    }
  });

  fastify.post<{
    Body: { containerId?: string; name: string; hostname: string; targetHost?: string; targetPort: number; https?: boolean };
  }>('/api/proxy', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body;
    const hostname = (b?.hostname ?? '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
    if (!hostname || !b?.targetPort) return reply.status(400).send({ error: 'Hostname und Ziel-Port erforderlich' });
    try {
      proxyQueries.upsert.run(
        b.containerId ?? null,
        b.name || hostname,
        hostname,
        b.targetHost || 'localhost',
        b.targetPort,
        b.https === false ? 0 : 1,
        1
      );
      if (caddyInstalled()) applyCaddy(proxyQueries.getAll.all());
      auditQueries.log.run(req.user.id, 'proxy.create', hostname);
      reply.status(201).send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Proxy-Fehler' });
    }
  });

  // Bestehenden Proxy-Host bearbeiten (Hostname/Ziel/Port/HTTPS)
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; hostname: string; targetHost?: string; targetPort: number; https?: boolean };
  }>('/api/proxy/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const row = proxyQueries.getById.get(id);
    if (!row) return reply.status(404).send({ error: 'Nicht gefunden' });
    const b = req.body;
    const hostname = (b?.hostname ?? '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
    if (!hostname || !b?.targetPort) return reply.status(400).send({ error: 'Hostname und Ziel-Port erforderlich' });
    try {
      proxyQueries.update.run(
        b.name || hostname,
        hostname,
        b.targetHost || 'localhost',
        b.targetPort,
        b.https === false ? 0 : 1,
        id
      );
      if (caddyInstalled()) applyCaddy(proxyQueries.getAll.all());
      auditQueries.log.run(req.user.id, 'proxy.update', hostname);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Proxy-Fehler' });
    }
  });

  // Toggle HTTPS for a single host
  fastify.post<{ Params: { id: string }; Body: { https: boolean } }>(
    '/api/proxy/:id/https',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const row = proxyQueries.getById.get(id);
      if (!row) return reply.status(404).send({ error: 'Nicht gefunden' });
      try {
        proxyQueries.setHttps.run(req.body?.https ? 1 : 0, id);
        if (caddyInstalled()) applyCaddy(proxyQueries.getAll.all());
        auditQueries.log.run(req.user.id, 'proxy.https', `${row.hostname}=${req.body?.https}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Proxy-Fehler' });
      }
    }
  );

  // Toggle HTTPS for ALL hosts at once
  fastify.post<{ Body: { https: boolean } }>(
    '/api/proxy/https-all',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        proxyQueries.setHttpsAll.run(req.body?.https ? 1 : 0);
        if (caddyInstalled()) applyCaddy(proxyQueries.getAll.all());
        auditQueries.log.run(req.user.id, 'proxy.https-all', String(req.body?.https));
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Proxy-Fehler' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>('/api/proxy/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const row = proxyQueries.getById.get(id);
    if (!row) return reply.status(404).send({ error: 'Nicht gefunden' });
    try {
      proxyQueries.delete.run(id);
      if (caddyInstalled()) applyCaddy(proxyQueries.getAll.all());
      auditQueries.log.run(req.user.id, 'proxy.delete', row.hostname);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Proxy-Fehler' });
    }
  });

  // Re-apply config (regenerate Caddyfile + reload)
  fastify.post('/api/proxy/apply', { preHandler: requireAdmin }, async (req, reply) => {
    if (!caddyInstalled()) return reply.status(503).send({ error: 'Caddy nicht installiert' });
    try {
      applyCaddy(proxyQueries.getAll.all());
      auditQueries.log.run(req.user.id, 'proxy.apply', null);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Caddy-Reload fehlgeschlagen' });
    }
  });

  // Download the internal root CA certificate (install on client devices)
  fastify.get('/api/proxy/ca', { preHandler: requireAuth }, async (_req, reply) => {
    const ca = findCaCert();
    if (!ca) return reply.status(404).send({ error: 'Root-CA noch nicht erzeugt (erst HTTPS-Host anlegen)' });
    const content = safeExec(`cat ${ca}`, 4000);
    if (!content) return reply.status(500).send({ error: 'CA nicht lesbar' });
    reply.header('Content-Disposition', 'attachment; filename="vault-hub-root-ca.crt"');
    reply.type('application/x-x509-ca-cert');
    return reply.send(content);
  });
}
