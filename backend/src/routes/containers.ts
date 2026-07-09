import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { requireAuth } from '../middleware/auth';
import { categoryQueries, auditQueries } from '../db/index';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

function parsePorts(ports: Dockerode.Port[]): string[] {
  if (!ports) return [];
  return ports
    .filter((p) => p.PublicPort)
    .map((p) => `${p.PublicPort}:${p.PrivatePort}`);
}

interface PortSpec { host: number; container: number; proto?: string }

/** Baut die Docker-Create-Optionen aus einer normalisierten Konfiguration. */
function buildCreateOptions(cfg: {
  image: string;
  name?: string;
  ports?: PortSpec[];
  env?: string[];
  volumes?: string[];
  category?: string;
  restart?: string;
}): Dockerode.ContainerCreateOptions {
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};
  const exposedPorts: Record<string, Record<string, never>> = {};
  for (const p of cfg.ports ?? []) {
    if (!p.container || !p.host) continue;
    const proto = p.proto === 'udp' ? 'udp' : 'tcp';
    const key = `${p.container}/${proto}`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: String(p.host) }];
  }
  const labels: Record<string, string> = {};
  if (cfg.category) labels['docker-gui.category'] = cfg.category;

  return {
    Image: cfg.image,
    name: cfg.name,
    Env: cfg.env,
    ExposedPorts: exposedPorts,
    Labels: labels,
    HostConfig: {
      PortBindings: portBindings,
      Binds: cfg.volumes,
      RestartPolicy: cfg.restart ? { Name: cfg.restart } : undefined,
    },
  };
}

/** Verbindet einen Container nach dem Starten mit zusätzlichen Netzwerken (optionale feste IP). */
async function connectExtraNetworks(containerId: string, networks: { id: string; ip?: string }[]) {
  for (const net of networks) {
    const id = net.id.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!id) continue;
    await docker.getNetwork(id).connect({
      Container: containerId,
      EndpointConfig: net.ip
        ? { IPAMConfig: { IPv4Address: net.ip.replace(/[^0-9.]/g, '') } }
        : undefined,
    });
  }
}

export async function containerRoutes(fastify: FastifyInstance) {
  fastify.get('/api/containers', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const [containers, categoryRows] = await Promise.all([
        docker.listContainers({ all: true }),
        Promise.resolve(categoryQueries.getAll.all()),
      ]);

      const categoryMap = Object.fromEntries(categoryRows.map((r) => [r.container_id, r.category]));
      const iconMap = Object.fromEntries(categoryRows.map((r) => [r.container_id, r.icon]));

      const result = containers.map((c) => ({
        id: c.Id,
        shortId: c.Id.substring(0, 12),
        name: (c.Names[0] ?? c.Id.substring(0, 12)).replace(/^\//, ''),
        image: c.Image,
        imageId: c.ImageID,
        status: c.Status,
        state: c.State,
        ports: parsePorts(c.Ports),
        created: c.Created,
        labels: c.Labels ?? {},
        category: categoryMap[c.Id] ?? c.Labels?.['docker-gui.category'] ?? null,
        icon: iconMap[c.Id] || null,
      }));

      reply.send({ containers: result });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/containers/:id', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const info = await docker.getContainer(req.params.id).inspect();
      reply.send({ container: info });
    } catch {
      reply.status(404).send({ error: 'Container not found' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/containers/:id/start', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await docker.getContainer(req.params.id).start();
      auditQueries.log.run(req.user.id, 'container.start', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/containers/:id/stop', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await docker.getContainer(req.params.id).stop();
      auditQueries.log.run(req.user.id, 'container.stop', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/containers/:id/restart', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await docker.getContainer(req.params.id).restart();
      auditQueries.log.run(req.user.id, 'container.restart', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/containers/:id', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await docker.getContainer(req.params.id).remove({ force: true });
      categoryQueries.delete.run(req.params.id);
      auditQueries.log.run(req.user.id, 'container.remove', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.get<{ Params: { id: string }; Querystring: { tail?: string; since?: string } }>(
    '/api/containers/:id/logs',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const tail = parseInt(req.query.tail ?? '200');
        const since = req.query.since ? parseInt(req.query.since) : undefined;
        const container = docker.getContainer(req.params.id);
        const logOpts: Dockerode.ContainerLogsOptions & { follow: false } = { stdout: true, stderr: true, tail, timestamps: true, follow: false };
        if (since) logOpts.since = since;
        const raw = (await container.logs(logOpts)).toString('utf8');
        const lines = raw
          .split('\n')
          .map((line) => (line.length > 8 ? line.slice(8) : line))
          .filter((l) => l.trim());
        reply.send({ logs: lines });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/containers/:id/logs/stream',
    { preHandler: requireAuth },
    async (req, reply) => {
      const res = reply.raw;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Connection', 'keep-alive');
      reply.hijack();

      const qs = req.query as { since?: string; tail?: string };
      const sinceParam = qs.since ? parseInt(qs.since) : undefined;
      const tailParam = sinceParam ? 0 : 200;

      try {
        const container = docker.getContainer(req.params.id);
        const logOpts = {
          follow: true as const, stdout: true, stderr: true, tail: tailParam, timestamps: true,
          ...(sinceParam ? { since: sinceParam } : {}),
        };
        const stream = await container.logs(logOpts);

        (stream as unknown as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
          for (const line of chunk.toString('utf8').split('\n')) {
            const clean = line.length > 8 ? line.slice(8) : line;
            if (clean.trim()) res.write(`data: ${clean}\n\n`);
          }
        });

        (stream as unknown as NodeJS.ReadableStream).on('end', () => {
          res.write('event: end\ndata: {}\n\n');
          res.end();
        });

        (stream as unknown as NodeJS.ReadableStream).on('error', () => res.end());

        req.raw.on('close', () => {
          (stream as unknown as { destroy?: () => void }).destroy?.();
        });
      } catch {
        res.write('event: error\ndata: {}\n\n');
        res.end();
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/containers/:id/stats',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const stats = (await docker.getContainer(req.params.id).stats({ stream: false })) as Dockerode.ContainerStats;
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const sysDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage ?? 0);
        const numCpus = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
        const cpuPercent = sysDelta > 0 ? (cpuDelta / sysDelta) * numCpus * 100 : 0;

        const memUsed = stats.memory_stats.usage - ((stats.memory_stats.stats as Record<string, number>)?.cache ?? 0);
        const memLimit = stats.memory_stats.limit;

        reply.send({
          cpu: Math.round(cpuPercent * 10) / 10,
          memory: {
            used: memUsed,
            limit: memLimit,
            percent: memLimit > 0 ? Math.round((memUsed / memLimit) * 1000) / 10 : 0,
          },
        });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );

  fastify.get('/api/images', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const images = await docker.listImages({ all: false });
      reply.send({
        images: images.map((i) => ({
          id: i.Id,
          tags: i.RepoTags ?? [],
          size: i.Size,
          created: i.Created,
        })),
      });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  // Alle Container mit ihren IPs in allen Docker-Netzwerken (für Virtuelle-IPs-Tab)
  fastify.get('/api/containers/virtual-ips', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const nets = await docker.listNetworks();
      const entries: {
        containerId: string; containerName: string;
        networkId: string; networkName: string; driver: string;
        ipv4: string; mac: string;
      }[] = [];
      for (const n of nets) {
        const info = await docker.getNetwork(n.Id).inspect().catch(() => null);
        if (!info?.Containers) continue;
        for (const [cid, c] of Object.entries(info.Containers)) {
          const cc = c as { Name: string; IPv4Address: string; MacAddress: string };
          entries.push({
            containerId: cid, containerName: cc.Name,
            networkId: n.Id, networkName: n.Name, driver: n.Driver,
            ipv4: cc.IPv4Address, mac: cc.MacAddress,
          });
        }
      }
      // VM-Leases (best-effort via virsh)
      const vmEntries: { vmName: string; ipv4: string; mac: string; networkName: string }[] = [];
      try {
        const { execFileSync } = await import('child_process');
        const leaseOut = execFileSync('virsh', ['net-dhcp-leases', '--all'], { timeout: 4000 }).toString();
        for (const line of leaseOut.split('\n')) {
          const m = line.match(/^\s*\S+\s+(\S+)\s+ipv4\s+([\d.]+)\/\d+\s+(\S+)/);
          if (m) vmEntries.push({ mac: m[1], ipv4: m[2], vmName: m[3], networkName: 'libvirt' });
        }
      } catch { /* virsh nicht verfügbar */ }
      reply.send({ entries, vmEntries });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker-Fehler' });
    }
  });

  fastify.post<{ Body: { image: string; name?: string; ports?: Record<string, string>; env?: string[]; volumes?: string[]; category?: string; restart?: string; icon?: string; networks?: { id: string; ip?: string }[] } }>(
    '/api/containers/create',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { image, name, ports, env, volumes, category, restart, icon, networks } = req.body ?? {};
        if (!image) return reply.status(400).send({ error: 'Image erforderlich' });

        // Ports kommen als Record<containerPort, hostPort> (tcp) vom Standard-Formular
        const portSpecs: PortSpec[] = Object.entries(ports ?? {}).map(([c, h]) => ({
          container: parseInt(c, 10), host: parseInt(h, 10), proto: 'tcp',
        }));

        const container = await docker.createContainer(
          buildCreateOptions({ image, name, ports: portSpecs, env, volumes, category, restart }),
        );

        await container.start();
        if (networks?.length) await connectExtraNetworks(container.id, networks);
        if (category) categoryQueries.set.run(container.id, category);
        if (icon) categoryQueries.setIcon.run(container.id, icon);
        auditQueries.log.run(req.user.id, 'container.create', name ?? image);

        reply.status(201).send({ id: container.id });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );

  // Container neu erstellen (Docker erlaubt kein Ändern von Ports/Env/Volumes
  // im laufenden Betrieb – daher: alten Container entfernen und mit neuer
  // Konfiguration unter gleichem Namen neu anlegen). Named-Volumes bleiben
  // erhalten, daher gehen keine Daten verloren.
  fastify.post<{
    Params: { id: string };
    Body: {
      name?: string; image: string;
      ports?: PortSpec[]; env?: string[]; volumes?: string[];
      restart?: string; category?: string;
      networks?: { id: string; ip?: string }[];
    };
  }>(
    '/api/containers/:id/recreate',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const body = req.body ?? { image: '' };
        if (!body.image) return reply.status(400).send({ error: 'Image erforderlich' });

        // Alte Meta (Icon) sichern, um sie auf den neuen Container zu übertragen
        const oldMeta = categoryQueries.get.get(req.params.id);
        const icon = oldMeta?.icon ?? null;
        const category = body.category ?? oldMeta?.category ?? undefined;

        const opts = buildCreateOptions({
          image: body.image, name: body.name, ports: body.ports,
          env: body.env, volumes: body.volumes, restart: body.restart, category,
        });

        // Alten Container stoppen & entfernen (force), dann neu anlegen
        const old = docker.getContainer(req.params.id);
        try { await old.remove({ force: true }); } catch { /* evtl. schon weg */ }
        categoryQueries.delete.run(req.params.id);

        const container = await docker.createContainer(opts);
        await container.start();
        if (body.networks?.length) await connectExtraNetworks(container.id, body.networks);

        if (category) categoryQueries.set.run(container.id, category);
        if (icon) categoryQueries.setIcon.run(container.id, icon);
        auditQueries.log.run(req.user.id, 'container.recreate', body.name ?? body.image);

        reply.status(201).send({ ok: true, id: container.id });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );

  // Interaktive Shell IN einem Container (docker exec) über WebSocket
  fastify.get<{ Params: { id: string } }>('/api/containers/:id/exec', { websocket: true }, (ws, req) => {
    // @fastify/websocket v11 (Fastify 5): der Handler bekommt den WebSocket direkt.
    void (async () => {
      try { await req.jwtVerify(); } catch { ws.close(1008, 'Unauthorized'); return; }
      if (req.user.role !== 'admin') { ws.close(1008, 'Admin erforderlich'); return; }

      const id = (req.params as { id: string }).id;
      auditQueries.log.run(req.user.id, 'container.exec', id);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let stream: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let exec: any = null;

      try {
        const container = docker.getContainer(id);
        exec = await container.exec({
          // bash bevorzugen, sonst sh
          Cmd: ['/bin/sh', '-c', 'if [ -x /bin/bash ]; then exec /bin/bash; else exec /bin/sh; fi'],
          AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true,
        });
        stream = await exec.start({ hijack: true, stdin: true, Tty: true });
        stream.on('data', (d: Buffer) => { try { ws.send(d.toString('utf8')); } catch { /* */ } });
        stream.on('end', () => { try { ws.close(); } catch { /* */ } });
        stream.on('error', () => { try { ws.close(); } catch { /* */ } });
      } catch (err) {
        try { ws.send(`\r\n\x1b[31mFehler: ${err instanceof Error ? err.message : 'exec fehlgeschlagen'}\x1b[0m\r\n`); } catch { /* */ }
        ws.close();
        return;
      }

      ws.on('message', (raw: Buffer) => {
        let msg: { type: string; data?: string; cols?: number; rows?: number };
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'data' && typeof msg.data === 'string') {
          try { stream.write(msg.data); } catch { /* */ }
        } else if (msg.type === 'resize') {
          try { void exec.resize({ h: msg.rows ?? 24, w: msg.cols ?? 80 }); } catch { /* */ }
        }
      });
      ws.on('close', () => { try { stream?.end(); } catch { /* */ } });
      ws.on('error', () => { try { stream?.end(); } catch { /* */ } });
    })();
  });

  fastify.post<{ Params: { id: string }; Body: { category: string } }>(
    '/api/containers/:id/category',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { category } = req.body ?? {};
      categoryQueries.set.run(req.params.id, category);
      reply.send({ ok: true });
    }
  );

  // Eigenes Icon (Bild-URL) je Container setzen oder entfernen (leerer String = zurücksetzen)
  fastify.post<{ Params: { id: string }; Body: { icon: string } }>(
    '/api/containers/:id/icon',
    { preHandler: requireAuth },
    async (req, reply) => {
      categoryQueries.setIcon.run(req.params.id, req.body?.icon ?? '');
      reply.send({ ok: true });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/containers/:id/pull',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const info = await docker.getContainer(req.params.id).inspect();
        const imageName = info.Config.Image;

        await new Promise<void>((resolve, reject) => {
          docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err) return reject(err);
            docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
          });
        });

        auditQueries.log.run(req.user.id, 'container.pull', imageName);
        reply.send({ ok: true, image: imageName });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );
}
