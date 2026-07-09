import type { FastifyInstance } from 'fastify';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Dockerode from 'dockerode';
import si from 'systeminformation';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries } from '../db/index';
import { sanitizePorts, scanScript, parseOpenPorts } from '../lib/scan';

// Nebenläufiger TCP-Scan vom Server aus – liefert die offenen Ports.
async function scanFromHost(host: string, ports: number[]): Promise<number[]> {
  const open: number[] = [];
  let idx = 0;
  const probeOne = (port: number) => new Promise<boolean>((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const fin = (ok: boolean) => { if (done) return; done = true; try { sock.destroy(); } catch { /* */ } resolve(ok); };
    sock.setTimeout(1000);
    sock.once('connect', () => fin(true));
    sock.once('timeout', () => fin(false));
    sock.once('error', () => fin(false));
    sock.connect(port, host);
  });
  const worker = async () => { while (idx < ports.length) { const p = ports[idx++]; if (await probeOne(p)) open.push(p); } };
  await Promise.all(Array.from({ length: Math.min(30, ports.length) }, () => worker()));
  return open.sort((a, b) => a - b);
}

const execFileP = promisify(execFile);
const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// Führt ein Kommando in einem Container aus und liefert stdout+stderr+ExitCode.
async function dockerExec(container: string, cmd: string[]): Promise<{ out: string; code: number | null }> {
  const c = docker.getContainer(container);
  const exec = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: true, stdin: false });
  const out = await new Promise<string>((resolve) => {
    let buf = '';
    const chunks: Buffer[] = [];
    stream.on('data', (d: Buffer) => chunks.push(d));
    stream.on('end', () => { buf = Buffer.concat(chunks).toString('utf-8'); resolve(buf); });
    stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
  const info = await exec.inspect().catch(() => null);
  // Docker-Multiplex-Header (8 Byte je Frame) grob entfernen
  const clean = out.replace(/[\x00-\x08\x0e-\x1f]/g, '').trim();
  return { out: clean, code: info?.ExitCode ?? null };
}

interface NetEndpoint {
  container: string;
  name: string;
  ipv4: string;
  mac: string;
}

export async function networkRoutes(fastify: FastifyInstance) {
  // List Docker networks with details
  fastify.get('/api/networks', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const nets = await docker.listNetworks();
      const detailed = await Promise.all(
        nets.map(async (n) => {
          const info = await docker.getNetwork(n.Id).inspect().catch(() => null);
          const ipam = info?.IPAM?.Config?.[0] ?? {};
          const containers: NetEndpoint[] = info?.Containers
            ? Object.entries(info.Containers).map(([cid, c]) => ({
                container: cid,
                name: (c as { Name: string }).Name,
                ipv4: (c as { IPv4Address: string }).IPv4Address,
                mac: (c as { MacAddress: string }).MacAddress,
              }))
            : [];
          return {
            id: n.Id,
            name: n.Name,
            driver: n.Driver,
            scope: n.Scope,
            internal: info?.Internal ?? false,
            subnet: (ipam as { Subnet?: string }).Subnet ?? '',
            gateway: (ipam as { Gateway?: string }).Gateway ?? '',
            parent: (info?.Options?.parent as string) ?? '',
            vlan: ((info?.Options?.parent as string) ?? '').includes('.')
              ? (info?.Options?.parent as string).split('.')[1]
              : '',
            containers,
            builtin: ['bridge', 'host', 'none'].includes(n.Name),
          };
        })
      );
      reply.send({ networks: detailed });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker-Fehler' });
    }
  });

  // Host network interfaces (for macvlan parent selection)
  fastify.get('/api/networks/interfaces', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const ifaces = await si.networkInterfaces();
      const list = (Array.isArray(ifaces) ? ifaces : [ifaces])
        .filter((i) => !i.internal && i.iface !== 'lo')
        .map((i) => ({ iface: i.iface, ip4: i.ip4, mac: i.mac, type: i.type, operstate: i.operstate }));
      reply.send({ interfaces: list });
    } catch {
      reply.send({ interfaces: [] });
    }
  });

  // Create a network (bridge / macvlan / ipvlan, optional VLAN, internal isolation)
  fastify.post<{
    Body: { name: string; driver?: string; subnet?: string; gateway?: string; parent?: string; vlan?: string; internal?: boolean };
  }>('/api/networks', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body;
    const name = (b?.name ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!name) return reply.status(400).send({ error: 'Name erforderlich' });
    const driver = ['bridge', 'macvlan', 'ipvlan'].includes(b?.driver ?? '') ? b!.driver! : 'bridge';

    try {
      const options: Record<string, string> = {};
      if ((driver === 'macvlan' || driver === 'ipvlan') && b?.parent) {
        const parent = b.parent.replace(/[^a-zA-Z0-9_.-]/g, '');
        options.parent = b.vlan ? `${parent}.${b.vlan.replace(/[^0-9]/g, '')}` : parent;
      }
      await docker.createNetwork({
        Name: name,
        Driver: driver,
        Internal: b?.internal ?? false,
        CheckDuplicate: true,
        IPAM: b?.subnet
          ? { Driver: 'default', Config: [{ Subnet: b.subnet, Gateway: b.gateway || undefined }] }
          : undefined,
        Options: Object.keys(options).length ? options : undefined,
      });
      auditQueries.log.run(req.user.id, 'network.create', `${name} (${driver}${options.parent ? ' ' + options.parent : ''})`);
      reply.status(201).send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Netzwerk-Erstellung fehlgeschlagen' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/networks/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      await docker.getNetwork(req.params.id).remove();
      auditQueries.log.run(req.user.id, 'network.delete', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker-Fehler' });
    }
  });

  // Connect a container with optional fixed IP + aliases (multiple names)
  fastify.post<{ Params: { id: string }; Body: { container: string; ip?: string; aliases?: string[] } }>(
    '/api/networks/:id/connect',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { container, ip, aliases } = req.body ?? {};
      if (!container) return reply.status(400).send({ error: 'Container erforderlich' });
      try {
        await docker.getNetwork(req.params.id).connect({
          Container: container,
          EndpointConfig: {
            IPAMConfig: ip ? { IPv4Address: ip } : undefined,
            Aliases: aliases?.filter(Boolean),
          },
        });
        auditQueries.log.run(req.user.id, 'network.connect', `${container}${ip ? '@' + ip : ''}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Verbinden fehlgeschlagen' });
      }
    }
  );

  // ── Studio: zwei Container über ein dediziertes Netz verbinden (additiv, sicher) ──
  // Legt – falls nötig – ein eigenes Bridge-Netz nur für dieses Paar an und hängt
  // beide hinein. Bestehende Netze bleiben unangetastet (nichts wird getrennt).
  const linkNetName = (a: string, b: string) => {
    const [x, y] = [a, b].map((s) => s.replace(/[^a-zA-Z0-9_.-]/g, '')).sort();
    return `cl-${x}-${y}`.slice(0, 60);
  };
  fastify.post<{ Body: { a: string; b: string } }>('/api/networks/link', { preHandler: requireAdmin }, async (req, reply) => {
    const { a, b } = req.body ?? {};
    if (!a || !b || a === b) return reply.status(400).send({ error: 'Zwei verschiedene Container erforderlich' });
    const name = linkNetName(a, b);
    try {
      // Netz sicherstellen
      let net = (await docker.listNetworks({ filters: { name: [name] } }))[0];
      if (!net) { await docker.createNetwork({ Name: name, Driver: 'bridge', CheckDuplicate: true, Labels: { 'vault-hub.link': 'true' } }); net = (await docker.listNetworks({ filters: { name: [name] } }))[0]; }
      const netId = net.Id;
      for (const c of [a, b]) {
        try { await docker.getNetwork(netId).connect({ Container: c }); }
        catch (e) { if (!/already exists|endpoint with name/i.test(e instanceof Error ? e.message : '')) throw e; }
      }
      auditQueries.log.run(req.user.id, 'network.link', `${a} <> ${b}`);
      reply.send({ ok: true, network: name });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Verbinden fehlgeschlagen' });
    }
  });
  fastify.post<{ Body: { a: string; b: string } }>('/api/networks/unlink', { preHandler: requireAdmin }, async (req, reply) => {
    const { a, b } = req.body ?? {};
    if (!a || !b) return reply.status(400).send({ error: 'Zwei Container erforderlich' });
    const name = linkNetName(a, b);
    try {
      const net = (await docker.listNetworks({ filters: { name: [name] } }))[0];
      if (net) {
        for (const c of [a, b]) { try { await docker.getNetwork(net.Id).disconnect({ Container: c, Force: true }); } catch { /* nicht verbunden */ } }
        try { await docker.getNetwork(net.Id).remove(); } catch { /* */ }
      }
      auditQueries.log.run(req.user.id, 'network.unlink', `${a} <> ${b}`);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Trennen fehlgeschlagen' });
    }
  });

  // ── Echter TCP-Test: ist host:port vom Server aus erreichbar? ──
  fastify.post<{ Body: { host: string; port: number; timeout?: number } }>('/api/networks/probe', { preHandler: requireAdmin }, async (req, reply) => {
    const host = (req.body?.host ?? '').trim();
    const port = Number(req.body?.port);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(host) || !port || port < 1 || port > 65535) {
      return reply.status(400).send({ error: 'Host und Port erforderlich' });
    }
    const timeout = Math.min(5000, Math.max(500, Number(req.body?.timeout) || 2000));
    const start = Date.now();
    const result = await new Promise<{ open: boolean; ms: number; error?: string }>((resolve) => {
      const sock = new net.Socket();
      let done = false;
      const fin = (open: boolean, error?: string) => { if (done) return; done = true; try { sock.destroy(); } catch { /* */ } resolve({ open, ms: Date.now() - start, error }); };
      sock.setTimeout(timeout);
      sock.once('connect', () => fin(true));
      sock.once('timeout', () => fin(false, 'timeout'));
      sock.once('error', (e: Error) => fin(false, e.message));
      sock.connect(port, host);
    });
    reply.send(result);
  });

  // ── Echter Test AUS einem Container heraus (Tunnel-Pfad: newt → Ziel) ──
  // Versucht nacheinander nc / bash-/dev/tcp / wget, je nachdem was im Image vorhanden ist.
  fastify.post<{ Body: { container: string; host: string; port: number } }>('/api/networks/probe-exec', { preHandler: requireAdmin }, async (req, reply) => {
    const container = (req.body?.container ?? '').trim();
    const host = (req.body?.host ?? '').trim();
    const port = Number(req.body?.port);
    if (!container || !/^[a-zA-Z0-9_.:-]+$/.test(host) || !port || port < 1 || port > 65535) {
      return reply.status(400).send({ error: 'Container, Host und Port erforderlich' });
    }
    const script =
      `h='${host}'; p='${port}';` +
      `if command -v nc >/dev/null 2>&1; then nc -w 3 -z "$h" "$p" >/dev/null 2>&1 && echo CH_OPEN || echo CH_CLOSED;` +
      `elif command -v bash >/dev/null 2>&1; then timeout 3 bash -c "exec 3<>/dev/tcp/$h/$p" >/dev/null 2>&1 && echo CH_OPEN || echo CH_CLOSED;` +
      `elif command -v wget >/dev/null 2>&1; then wget -q -T 3 -O /dev/null "http://$h:$p" >/dev/null 2>&1 && echo CH_OPEN || echo CH_CLOSED;` +
      `else echo CH_NOTOOL; fi`;
    try {
      const start = Date.now();
      const { out } = await dockerExec(container, ['sh', '-c', script]);
      const ms = Date.now() - start;
      if (out.includes('CH_OPEN')) return reply.send({ open: true, ms, method: 'exec' });
      if (out.includes('CH_NOTOOL')) return reply.send({ open: false, ms, error: 'no-tool', method: 'exec' });
      return reply.send({ open: false, ms, error: 'closed', method: 'exec' });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Exec fehlgeschlagen' });
    }
  });

  // ── Port-Scan vom Server aus: welche Ports von host sind offen? ──
  fastify.post<{ Body: { host: string; ports?: number[] } }>('/api/networks/scan', { preHandler: requireAdmin }, async (req, reply) => {
    const host = (req.body?.host ?? '').trim();
    if (!/^[a-zA-Z0-9_.:-]+$/.test(host)) return reply.status(400).send({ error: 'Host erforderlich' });
    const open = await scanFromHost(host, sanitizePorts(req.body?.ports));
    reply.send({ open });
  });

  // ── Port-Scan AUS einem Container heraus (Tunnel-Container → Ziel) ──
  fastify.post<{ Body: { container: string; host: string; ports?: number[] } }>('/api/networks/scan-exec', { preHandler: requireAdmin }, async (req, reply) => {
    const container = (req.body?.container ?? '').trim();
    const host = (req.body?.host ?? '').trim();
    if (!container || !/^[a-zA-Z0-9_.:-]+$/.test(host)) return reply.status(400).send({ error: 'Container und Host erforderlich' });
    try {
      const { out } = await dockerExec(container, ['sh', '-c', scanScript(host, sanitizePorts(req.body?.ports))]);
      reply.send({ open: parseOpenPorts(out) });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Exec fehlgeschlagen' });
    }
  });

  // ── Routing-Tabelle des Hosts (zur Diagnose, wo es hängt) ──
  fastify.get('/api/networks/routes', { preHandler: requireAuth }, async (_req, reply) => {
    const run = async (args: string[]) => {
      try { const { stdout } = await execFileP('ip', args, { timeout: 4000 }); return stdout.trim().split('\n').filter(Boolean); }
      catch { return [] as string[]; }
    };
    const [routes, addrs] = await Promise.all([run(['route']), run(['-br', 'addr'])]);
    reply.send({ routes, addrs });
  });

  fastify.post<{ Params: { id: string }; Body: { container: string } }>(
    '/api/networks/:id/disconnect',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        await docker.getNetwork(req.params.id).disconnect({ Container: req.body?.container, Force: true });
        auditQueries.log.run(req.user.id, 'network.disconnect', req.body?.container);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Trennen fehlgeschlagen' });
      }
    }
  );
}
