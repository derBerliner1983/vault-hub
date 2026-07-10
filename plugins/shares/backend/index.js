'use strict';
// SMB-Freigaben-Plugin-Backend (CommonJS), portiert von Core-Hubs shares.ts.
// Verwaltet einen eigenen Block in /etc/samba/smb.conf, Dienst + UFW-Regeln.

const fs = require('fs');

const SMB_CONF = '/etc/samba/smb.conf';
const MANAGED_BEGIN = '# >>> vault-hub managed shares >>>';
const MANAGED_END = '# <<< vault-hub managed shares <<<';
const FW_COMMENT = 'vault-hub-samba';

module.exports.register = function register(fastify, ctx) {
  const auth = async (req, reply, admin) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (admin && req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };
  const has = (bin) => ctx.safeExec(`command -v ${bin} 2>/dev/null`, 3000).trim() !== '';
  const readConf = () => ctx.safeExec(`cat ${SMB_CONF} 2>/dev/null`, 4000);

  function parseShares(conf) {
    const start = conf.indexOf(MANAGED_BEGIN), end = conf.indexOf(MANAGED_END);
    if (start === -1 || end === -1) return [];
    const block = conf.slice(start, end);
    const shares = []; let cur = null;
    for (const line of block.split('\n')) {
      const t = line.trim();
      const sec = t.match(/^\[([^\]]+)\]$/);
      if (sec) { if (cur) shares.push(cur); cur = { name: sec[1], path: '', readOnly: true, guestOk: false, browseable: true }; }
      else if (cur) {
        const kv = t.match(/^([^=]+)=(.+)$/); if (!kv) continue;
        const key = kv[1].trim().toLowerCase().replace(/\s+/g, ' '), val = kv[2].trim();
        if (key === 'path') cur.path = val;
        if (key === 'read only') cur.readOnly = /yes/i.test(val);
        if (key === 'guest ok') cur.guestOk = /yes/i.test(val);
        if (key === 'browseable') cur.browseable = /yes/i.test(val);
      }
    }
    if (cur) shares.push(cur);
    return shares;
  }
  const renderShare = (s) => `[${s.name}]\n   path = ${s.path}\n   read only = ${s.readOnly ? 'yes' : 'no'}\n   guest ok = ${s.guestOk ? 'yes' : 'no'}\n   browseable = ${s.browseable ? 'yes' : 'no'}\n`;

  const ufwActive = () => has('ufw') && ctx.safeExec('ufw status 2>/dev/null', 4000).includes('Status: active');
  function getLanSubnets() {
    const out = ctx.safeExec("ip -4 route show 2>/dev/null | grep -v default | grep -vE 'docker|cni|veth|virbr|flannel|weave|tun|wg' | awk '{print $1}' | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+/[0-9]+$'", 4000);
    const subnets = out.split('\n').map((s) => s.trim()).filter(Boolean);
    return subnets.length ? subnets : ['192.168.0.0/16', '10.0.0.0/8'];
  }
  function firewallBlock() {
    if (!ufwActive()) return;
    for (let i = 0; i < 40; i++) {
      const line = ctx.safeExec('ufw status numbered 2>/dev/null', 4000).split('\n').find((l) => l.includes(FW_COMMENT));
      if (!line) break;
      const m = line.match(/^\[\s*(\d+)\]/); if (!m) break;
      try { ctx.privExec(`ufw --force delete ${m[1]} 2>/dev/null`, { timeout: 5000 }); } catch (_) { break; }
    }
  }
  function firewallAllow() {
    if (!ufwActive()) return;
    firewallBlock();
    for (const s of getLanSubnets()) {
      for (const p of ['139', '445']) { try { ctx.privExec(`ufw allow from ${s} to any port ${p} proto tcp comment '${FW_COMMENT}'`, { timeout: 5000 }); } catch (_) {} }
      for (const p of ['137', '138']) { try { ctx.privExec(`ufw allow from ${s} to any port ${p} proto udp comment '${FW_COMMENT}'`, { timeout: 5000 }); } catch (_) {} }
    }
  }
  const firewallOpen = () => { if (!has('ufw')) return true; const st = ctx.safeExec('ufw status 2>/dev/null', 4000); if (!st.includes('Status: active')) return true; return ctx.safeExec('ufw status numbered 2>/dev/null', 4000).includes(FW_COMMENT); };

  function writeShares(shares) {
    const conf = readConf();
    const start = conf.indexOf(MANAGED_BEGIN), end = conf.indexOf(MANAGED_END);
    const block = `${MANAGED_BEGIN}\n${shares.map(renderShare).join('\n')}${MANAGED_END}\n`;
    const newConf = (start !== -1 && end !== -1)
      ? conf.slice(0, start) + block + conf.slice(end + MANAGED_END.length + 1)
      : conf.replace(/\n*$/, '\n\n') + block;
    const tmp = `/tmp/vh-smb-${Date.now()}.conf`;
    fs.writeFileSync(tmp, newConf);
    ctx.privExec(`cp ${tmp} ${SMB_CONF}`);
    try { fs.unlinkSync(tmp); } catch (_) {}
    const wasRunning = ctx.safeExec('systemctl is-active smbd 2>/dev/null', 3000).trim() === 'active';
    if (shares.length === 0) {
      if (wasRunning) { try { ctx.privExec('systemctl stop smbd nmbd 2>/dev/null || systemctl stop smbd', { timeout: 12000 }); } catch (_) {} }
      firewallBlock();
    } else if (!wasRunning) {
      try { ctx.privExec('systemctl start smbd nmbd 2>/dev/null || systemctl start smbd', { timeout: 12000 }); } catch (_) {}
      firewallAllow();
    } else {
      try { ctx.privExec('systemctl reload smbd 2>/dev/null || systemctl restart smbd', { timeout: 12000 }); } catch (_) {}
      firewallAllow();
    }
  }

  const P = '/app/shares/api';

  fastify.get(P + '/status', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    if (!has('smbd')) return reply.send({ available: false, shares: [], message: 'Samba nicht installiert (apt install samba)' });
    reply.send({
      available: true,
      running: ctx.safeExec('systemctl is-active smbd 2>/dev/null', 3000).trim() === 'active',
      shares: parseShares(readConf()), firewallOpen: firewallOpen(),
    });
  });

  fastify.post(P, async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    if (!has('smbd')) return reply.status(503).send({ error: 'Samba nicht installiert' });
    const b = req.body || {};
    const name = String(b.name || '').replace(/[^a-zA-Z0-9 _-]/g, '');
    if (!name || !String(b.path || '').startsWith('/')) return reply.status(400).send({ error: 'Name und absoluter Pfad erforderlich' });
    try {
      ctx.privExec(`mkdir -p ${String(b.path).replace(/[^a-zA-Z0-9 ._/-]/g, '')}`);
      const shares = parseShares(readConf()).filter((s) => s.name !== name);
      shares.push({ name, path: b.path, readOnly: !!b.readOnly, guestOk: !!b.guestOk, browseable: b.browseable !== false });
      writeShares(shares);
      ctx.audit(req.user.id, 'share.create', name);
      reply.status(201).send({ ok: true });
    } catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' }); }
  });

  fastify.delete(P + '/:name', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    try { writeShares(parseShares(readConf()).filter((s) => s.name !== req.params.name)); ctx.audit(req.user.id, 'share.delete', req.params.name); reply.send({ ok: true }); }
    catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' }); }
  });

  fastify.post(P + '/service', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const action = req.body && req.body.action;
    if (!['start', 'stop', 'restart'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
    try {
      ctx.privExec(`systemctl ${action} smbd nmbd 2>/dev/null || systemctl ${action} smbd`, { timeout: 12000 });
      if (action !== 'stop' && parseShares(readConf()).length > 0) firewallAllow();
      reply.send({ ok: true });
    } catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' }); }
  });

  fastify.post(P + '/user', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const username = String((req.body && req.body.username) || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const password = (req.body && req.body.password) || '';
    if (!username || !password) return reply.status(400).send({ error: 'Benutzer und Passwort erforderlich' });
    try {
      ctx.privExec(`bash -c "(echo '${password}'; echo '${password}') | smbpasswd -s -a ${username}"`, { timeout: 8000 });
      ctx.audit(req.user.id, 'share.adduser', username);
      reply.send({ ok: true });
    } catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'smbpasswd-Fehler' }); }
  });
};
