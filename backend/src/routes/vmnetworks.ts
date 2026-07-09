import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries } from '../db/index';
import { hasBinary, privExecFile } from '../lib/privilege';

function virshAvailable(): boolean {
  return hasBinary('virsh');
}

function virsh(args: string[], timeout = 8000): string {
  try {
    return execFileSync('virsh', args, { timeout, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  } catch {
    // libvirt system connection often needs root
    return privExecFile('virsh', args, { timeout });
  }
}

function sanitize(s: string): string {
  return (s ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
}

interface VmNetwork {
  name: string;
  active: boolean;
  autostart: boolean;
  persistent: boolean;
  bridge: string;
  forward: string;
}

function parseVmNetworks(): VmNetwork[] {
  const names = virsh(['net-list', '--all', '--name']).split('\n').map((l) => l.trim()).filter(Boolean);
  return names.map((name) => {
    let info = '';
    try { info = virsh(['net-info', name]); } catch { /* */ }
    let xml = '';
    try { xml = virsh(['net-dumpxml', name]); } catch { /* */ }
    const get = (k: string) => info.match(new RegExp(`${k}:\\s*(.+)`))?.[1]?.trim() ?? '';
    return {
      name,
      active: get('Active') === 'yes',
      autostart: get('Autostart') === 'yes',
      persistent: get('Persistent') === 'yes',
      bridge: get('Bridge') || xml.match(/<bridge name='([^']+)'/)?.[1] || '',
      forward: xml.match(/<forward mode='([^']+)'/)?.[1] || 'isolated',
    };
  });
}

export async function vmNetworkRoutes(fastify: FastifyInstance) {
  fastify.get('/api/vm-networks', { preHandler: requireAuth }, async (_req, reply) => {
    if (!virshAvailable()) return reply.send({ available: false, networks: [], message: 'libvirt/virsh nicht installiert' });
    try {
      reply.send({ available: true, networks: parseVmNetworks() });
    } catch (err: unknown) {
      reply.send({ available: true, networks: [], error: err instanceof Error ? err.message : 'virsh Fehler' });
    }
  });

  // Create a libvirt network (nat / isolated / bridge) with optional VLAN tag
  fastify.post<{
    Body: { name: string; mode?: 'nat' | 'isolated' | 'bridge'; subnet?: string; bridge?: string; vlan?: string };
  }>('/api/vm-networks', { preHandler: requireAdmin }, async (req, reply) => {
    if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
    const name = sanitize(req.body?.name ?? '');
    if (!name) return reply.status(400).send({ error: 'Name erforderlich' });
    const mode = ['nat', 'isolated', 'bridge'].includes(req.body?.mode ?? '') ? req.body!.mode! : 'nat';

    try {
      let xml = `<network>\n  <name>${name}</name>\n`;
      const vlanTag = req.body?.vlan ? req.body.vlan.replace(/[^0-9]/g, '') : '';

      if (mode === 'bridge') {
        const br = sanitize(req.body?.bridge ?? 'br0');
        xml += `  <forward mode='bridge'/>\n  <bridge name='${br}'/>\n`;
        if (vlanTag) xml += `  <vlan><tag id='${vlanTag}'/></vlan>\n`;
      } else {
        // nat or isolated: provide an IP subnet + DHCP
        const subnet = (req.body?.subnet || '192.168.123.0').replace(/[^0-9.]/g, '');
        const base = subnet.split('.').slice(0, 3).join('.');
        if (mode === 'nat') xml += `  <forward mode='nat'/>\n`;
        xml += `  <ip address='${base}.1' netmask='255.255.255.0'>\n    <dhcp>\n      <range start='${base}.2' end='${base}.254'/>\n    </dhcp>\n  </ip>\n`;
      }
      xml += `</network>\n`;

      const tmp = path.join(os.tmpdir(), `corehub-net-${Date.now()}.xml`);
      fs.writeFileSync(tmp, xml);
      virsh(['net-define', tmp]);
      virsh(['net-start', name]);
      virsh(['net-autostart', name]);
      fs.unlinkSync(tmp);

      auditQueries.log.run(req.user.id, 'vmnet.create', `${name} (${mode}${vlanTag ? ' vlan ' + vlanTag : ''})`);
      reply.status(201).send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Netzwerk-Erstellung fehlgeschlagen' });
    }
  });

  const lifecycle = (action: string, args: (n: string) => string[]) => {
    fastify.post<{ Params: { name: string } }>(`/api/vm-networks/:name/${action}`, { preHandler: requireAdmin }, async (req, reply) => {
      if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
      const name = sanitize(req.params.name);
      try {
        virsh(args(name));
        auditQueries.log.run(req.user.id, `vmnet.${action}`, name);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'virsh Fehler' });
      }
    });
  };

  lifecycle('start', (n) => ['net-start', n]);
  lifecycle('stop', (n) => ['net-destroy', n]);
  lifecycle('autostart', (n) => ['net-autostart', n]);

  fastify.delete<{ Params: { name: string } }>('/api/vm-networks/:name', { preHandler: requireAdmin }, async (req, reply) => {
    if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
    const name = sanitize(req.params.name);
    try {
      try { virsh(['net-destroy', name]); } catch { /* may be inactive */ }
      virsh(['net-undefine', name]);
      auditQueries.log.run(req.user.id, 'vmnet.delete', name);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'virsh Fehler' });
    }
  });

  // Attach a network to a VM (live + persistent)
  fastify.post<{ Params: { name: string }; Body: { vm: string } }>(
    '/api/vm-networks/:name/attach',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!virshAvailable()) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
      const name = sanitize(req.params.name);
      const vm = sanitize(req.body?.vm ?? '');
      if (!vm) return reply.status(400).send({ error: 'VM erforderlich' });
      try {
        virsh(['attach-interface', vm, '--type', 'network', '--source', name, '--model', 'virtio', '--config', '--live']);
        auditQueries.log.run(req.user.id, 'vmnet.attach', `${vm}→${name}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        // VM may be off: retry config-only
        try {
          virsh(['attach-interface', vm, '--type', 'network', '--source', name, '--model', 'virtio', '--config']);
          reply.send({ ok: true });
        } catch (e: unknown) {
          reply.status(500).send({ error: e instanceof Error ? e.message : 'Anhängen fehlgeschlagen' });
        }
      }
    }
  );
}
