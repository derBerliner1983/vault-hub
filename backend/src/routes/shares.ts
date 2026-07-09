import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries } from '../db/index';

const SMB_CONF = '/etc/samba/smb.conf';
const MANAGED_BEGIN = '# >>> vault-hub managed shares >>>';
const MANAGED_END = '# <<< vault-hub managed shares <<<';
const SAMBA_FW_COMMENT = 'vault-hub-samba';

interface Share {
  name: string;
  path: string;
  readOnly: boolean;
  guestOk: boolean;
  browseable: boolean;
}

function readConf(): string {
  return safeExec(`cat ${SMB_CONF} 2>/dev/null`, 4000);
}

/** Parse only the vault-hub managed block into share objects. */
function parseShares(conf: string): Share[] {
  const start = conf.indexOf(MANAGED_BEGIN);
  const end = conf.indexOf(MANAGED_END);
  if (start === -1 || end === -1) return [];
  const block = conf.slice(start, end);
  const shares: Share[] = [];
  let current: Share | null = null;
  for (const line of block.split('\n')) {
    const t = line.trim();
    const section = t.match(/^\[([^\]]+)\]$/);
    if (section) {
      if (current) shares.push(current);
      current = { name: section[1], path: '', readOnly: true, guestOk: false, browseable: true };
    } else if (current) {
      const kv = t.match(/^([^=]+)=(.+)$/);
      if (!kv) continue;
      const key = kv[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const val = kv[2].trim();
      if (key === 'path') current.path = val;
      if (key === 'read only') current.readOnly = /yes/i.test(val);
      if (key === 'guest ok') current.guestOk = /yes/i.test(val);
      if (key === 'browseable' || key === 'browsavle') current.browseable = /yes/i.test(val);
    }
  }
  if (current) shares.push(current);
  return shares;
}

function renderShare(s: Share): string {
  return `[${s.name}]
   path = ${s.path}
   read only = ${s.readOnly ? 'yes' : 'no'}
   guest ok = ${s.guestOk ? 'yes' : 'no'}
   browseable = ${s.browseable ? 'yes' : 'no'}
`;
}

// ── Firewall management ──────────────────────────────────────────────────────

function ufwActive(): boolean {
  if (!hasBinary('ufw')) return false;
  return safeExec('ufw status 2>/dev/null').includes('Status: active');
}

/** Get directly connected LAN subnets (excluding docker/container bridges). */
function getLanSubnets(): string[] {
  const out = safeExec(
    "ip -4 route show 2>/dev/null | grep -v default | grep -vE 'docker|cni|veth|virbr|flannel|weave|tun|wg' | awk '{print $1}' | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+/[0-9]+$'",
  );
  const subnets = out.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  // Fall back to common RFC-1918 ranges so Samba is at least reachable from LAN
  return subnets.length > 0 ? subnets : ['192.168.0.0/16', '10.0.0.0/8'];
}

/** Remove all UFW rules tagged with our comment (reverse-order loop). */
function sambaFirewallBlock(): void {
  if (!ufwActive()) return;
  for (let i = 0; i < 40; i++) {
    const out = safeExec('ufw status numbered 2>/dev/null');
    const line = out.split('\n').find((l) => l.includes(SAMBA_FW_COMMENT));
    if (!line) break;
    const m = line.match(/^\[\s*(\d+)\]/);
    if (!m) break;
    try {
      privExec(`ufw --force delete ${m[1]} 2>/dev/null`, { timeout: 5000 });
    } catch { break; }
  }
}

/** Open Samba ports (139, 445 TCP; 137, 138 UDP) for LAN subnets only. */
function sambaFirewallAllow(): void {
  if (!ufwActive()) return;
  sambaFirewallBlock(); // remove stale rules first
  const subnets = getLanSubnets();
  for (const s of subnets) {
    for (const p of ['139', '445']) {
      try { privExec(`ufw allow from ${s} to any port ${p} proto tcp comment '${SAMBA_FW_COMMENT}'`, { timeout: 5000 }); } catch { /* */ }
    }
    for (const p of ['137', '138']) {
      try { privExec(`ufw allow from ${s} to any port ${p} proto udp comment '${SAMBA_FW_COMMENT}'`, { timeout: 5000 }); } catch { /* */ }
    }
  }
}

/** Returns true if UFW has our Samba LAN rules (or UFW is inactive). */
function isSambaFirewallOpen(): boolean {
  if (!hasBinary('ufw')) return true;
  const status = safeExec('ufw status 2>/dev/null');
  if (!status.includes('Status: active')) return true;
  return safeExec('ufw status numbered 2>/dev/null').includes(SAMBA_FW_COMMENT);
}

// ── Config write + auto-lifecycle ─────────────────────────────────────────────

function writeShares(shares: Share[]): void {
  const conf = readConf();
  const start = conf.indexOf(MANAGED_BEGIN);
  const end = conf.indexOf(MANAGED_END);
  const block = `${MANAGED_BEGIN}\n${shares.map(renderShare).join('\n')}${MANAGED_END}\n`;

  let newConf: string;
  if (start !== -1 && end !== -1) {
    newConf = conf.slice(0, start) + block + conf.slice(end + MANAGED_END.length + 1);
  } else {
    newConf = conf.replace(/\n*$/, '\n\n') + block;
  }

  const tmp = `/tmp/corehub-smb-${Date.now()}.conf`;
  fs.writeFileSync(tmp, newConf);
  privExec(`cp ${tmp} ${SMB_CONF}`);
  fs.unlinkSync(tmp);
  safeExec('testparm -s 2>/dev/null >/dev/null');

  const wasRunning = safeExec('systemctl is-active smbd 2>/dev/null').trim() === 'active';

  if (shares.length === 0) {
    // Last share removed → stop Samba + block firewall
    if (wasRunning) {
      try { privExec('systemctl stop smbd nmbd 2>/dev/null || systemctl stop smbd', { timeout: 12000 }); } catch { /* */ }
    }
    sambaFirewallBlock();
  } else if (!wasRunning) {
    // First share added (Samba was stopped) → start + open LAN firewall
    try { privExec('systemctl start smbd nmbd 2>/dev/null || systemctl start smbd', { timeout: 12000 }); } catch { /* */ }
    sambaFirewallAllow();
  } else {
    // Shares modified, Samba already running → reload + ensure firewall is open
    try { privExec('systemctl reload smbd 2>/dev/null || systemctl restart smbd', { timeout: 12000 }); } catch { /* */ }
    sambaFirewallAllow();
  }
}

export async function shareRoutes(fastify: FastifyInstance) {
  fastify.get('/api/shares', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('smbd')) {
      return reply.send({ available: false, shares: [], message: 'Samba nicht installiert (apt install samba)' });
    }
    const running = safeExec('systemctl is-active smbd 2>/dev/null').trim() === 'active';
    const shares = parseShares(readConf());
    const firewallOpen = isSambaFirewallOpen();
    reply.send({ available: true, running, shares, firewallOpen });
  });

  fastify.post<{ Body: Share }>('/api/shares', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('smbd')) return reply.status(503).send({ error: 'Samba nicht installiert' });
    const body = req.body;
    const name = (body?.name ?? '').replace(/[^a-zA-Z0-9 _-]/g, '');
    if (!name || !body?.path?.startsWith('/')) return reply.status(400).send({ error: 'Name und absoluter Pfad erforderlich' });
    try {
      privExec(`mkdir -p ${body.path.replace(/[^a-zA-Z0-9 ._/-]/g, '')}`);
      const shares = parseShares(readConf()).filter((s) => s.name !== name);
      shares.push({
        name,
        path: body.path,
        readOnly: body.readOnly ?? false,
        guestOk: body.guestOk ?? false,
        browseable: body.browseable ?? true,
      });
      writeShares(shares);
      auditQueries.log.run(req.user.id, 'share.create', name);
      reply.status(201).send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' });
    }
  });

  fastify.delete<{ Params: { name: string } }>('/api/shares/:name', { preHandler: requireAdmin }, async (req, reply) => {
    const name = req.params.name;
    try {
      const shares = parseShares(readConf()).filter((s) => s.name !== name);
      writeShares(shares);
      auditQueries.log.run(req.user.id, 'share.delete', name);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' });
    }
  });

  fastify.post<{ Body: { action: 'start' | 'stop' | 'restart' } }>(
    '/api/shares/service',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const action = req.body?.action;
      if (!['start', 'stop', 'restart'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      try {
        privExec(`systemctl ${action} smbd nmbd 2>/dev/null || systemctl ${action} smbd`, { timeout: 12000 });
        // On manual start: also ensure firewall is open if shares exist
        if (action !== 'stop') {
          const shares = parseShares(readConf());
          if (shares.length > 0) sambaFirewallAllow();
        }
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' });
      }
    }
  );

  // Add an SMB user (must already exist as a Linux user)
  fastify.post<{ Body: { username: string; password: string } }>(
    '/api/shares/user',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const username = (req.body?.username ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
      const password = req.body?.password ?? '';
      if (!username || !password) return reply.status(400).send({ error: 'Benutzer und Passwort erforderlich' });
      try {
        privExec(`bash -c "(echo '${password}'; echo '${password}') | smbpasswd -s -a ${username}"`, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'share.adduser', username);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'smbpasswd-Fehler' });
      }
    }
  );
}
