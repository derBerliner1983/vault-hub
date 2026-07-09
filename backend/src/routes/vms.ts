import type { FastifyInstance } from 'fastify';
import { execSync, execFileSync } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries } from '../db/index';

function virshAvailable(): boolean {
  try {
    execSync('command -v virsh', { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function virsh(args: string[], timeout = 8000): string {
  return execFileSync('virsh', args, { timeout, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '');
}

interface VM {
  id: string;
  name: string;
  state: string;
  vcpus: number;
  memory: number; // KiB
  autostart: boolean;
}

function parseVMs(): VM[] {
  const out = virsh(['list', '--all', '--name']);
  const names = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const vms: VM[] = [];
  for (const name of names) {
    try {
      const info = virsh(['dominfo', name]);
      const get = (key: string) => {
        const m = info.match(new RegExp(`${key}:\\s*(.+)`));
        return m ? m[1].trim() : '';
      };
      vms.push({
        id: name,
        name,
        state: get('State') || 'unknown',
        vcpus: parseInt(get('CPU\\(s\\)')) || 0,
        memory: parseInt(get('Used memory').replace(/\D/g, '')) || parseInt(get('Max memory').replace(/\D/g, '')) || 0,
        autostart: get('Autostart') === 'enable',
      });
    } catch {
      vms.push({ id: name, name, state: 'unknown', vcpus: 0, memory: 0, autostart: false });
    }
  }
  return vms;
}

export async function vmRoutes(fastify: FastifyInstance) {
  fastify.get('/api/vms', { preHandler: requireAuth }, async (_req, reply) => {
    if (!virshAvailable()) {
      return reply.send({ available: false, vms: [], message: 'libvirt/virsh nicht installiert' });
    }
    try {
      reply.send({ available: true, vms: parseVMs() });
    } catch (err: unknown) {
      reply.send({ available: true, vms: [], error: err instanceof Error ? err.message : 'virsh Fehler' });
    }
  });

  const lifecycle = (action: string, virshCmd: string[]) => {
    fastify.post<{ Params: { name: string } }>(
      `/api/vms/:name/${action}`,
      { preHandler: requireAdmin },
      async (req, reply) => {
        if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
        const name = sanitizeName(req.params.name);
        try {
          virsh([...virshCmd, name]);
          auditQueries.log.run(req.user.id, `vm.${action}`, name);
          reply.send({ ok: true });
        } catch (err: unknown) {
          reply.status(500).send({ error: err instanceof Error ? err.message : 'virsh Fehler' });
        }
      }
    );
  };

  lifecycle('start', ['start']);
  lifecycle('shutdown', ['shutdown']);
  lifecycle('stop', ['destroy']);
  lifecycle('reboot', ['reboot']);

  fastify.post<{ Params: { name: string } }>(
    '/api/vms/:name/autostart',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
      const name = sanitizeName(req.params.name);
      try {
        const vm = parseVMs().find((v) => v.name === name);
        virsh(['autostart', ...(vm?.autostart ? ['--disable'] : []), name]);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'virsh Fehler' });
      }
    }
  );

  fastify.post<{ Params: { name: string } }>(
    '/api/vms/:name/snapshot',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
      const name = sanitizeName(req.params.name);
      try {
        virsh(['snapshot-create-as', name, `snap-${Date.now()}`, '--atomic']);
        auditQueries.log.run(req.user.id, 'vm.snapshot', name);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Snapshot Fehler' });
      }
    }
  );

  // Create VM via virt-install (simplified wizard)
  fastify.post<{
    Body: { name: string; memory: number; vcpus: number; diskSize: number; iso?: string; osVariant?: string };
  }>('/api/vms/create', { preHandler: requireAdmin }, async (req, reply) => {
    if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
    const { name, memory, vcpus, diskSize, iso, osVariant } = req.body ?? {};
    const safeName = sanitizeName(name ?? '');
    if (!safeName) return reply.status(400).send({ error: 'Name erforderlich' });

    try {
      execSync('command -v virt-install', { timeout: 2000 });
    } catch {
      return reply.status(503).send({ error: 'virt-install nicht installiert (Paket: virtinst)' });
    }

    try {
      const diskPath = `/var/lib/libvirt/images/${safeName}.qcow2`;
      const args = [
        '--name', safeName,
        '--memory', String(memory || 2048),
        '--vcpus', String(vcpus || 2),
        '--disk', `path=${diskPath},size=${diskSize || 20},format=qcow2`,
        '--os-variant', osVariant || 'generic',
        '--graphics', 'vnc,listen=0.0.0.0',
        '--noautoconsole',
      ];
      if (iso) {
        args.push('--cdrom', iso.replace(/[^a-zA-Z0-9./_-]/g, ''));
      } else {
        args.push('--import');
      }
      execFileSync('virt-install', args, { timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
      auditQueries.log.run(req.user.id, 'vm.create', safeName);
      reply.status(201).send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'VM-Erstellung fehlgeschlagen' });
    }
  });

  fastify.delete<{ Params: { name: string } }>(
    '/api/vms/:name',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
      const name = sanitizeName(req.params.name);
      try {
        try { virsh(['destroy', name]); } catch { /* may already be off */ }
        virsh(['undefine', name, '--remove-all-storage', '--nvram']);
        auditQueries.log.run(req.user.id, 'vm.delete', name);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'virsh Fehler' });
      }
    }
  );
}
