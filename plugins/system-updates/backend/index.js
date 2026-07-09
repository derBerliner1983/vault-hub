'use strict';
// System-Updates-Plugin-Backend (CommonJS), portiert von Core-Hubs updates.ts.
// Listet OS-Paket-Updates (apt/dnf/pacman), aktualisiert den Index und spielt
// Updates ein — dependency-frei über den Plugin-Kontext (ctx.privExec/safeExec).

module.exports.register = function register(fastify, ctx) {
  const auth = async (req, reply, admin) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (admin && req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };
  const has = (bin) => ctx.safeExec(`command -v ${bin} 2>/dev/null`, 3000).trim() !== '';
  const detectPM = () => has('apt-get') ? 'apt' : has('dnf') ? 'dnf' : has('pacman') ? 'pacman' : null;

  function parseAptUpgradable(out) {
    const updates = [];
    for (const line of out.split('\n')) {
      const m = line.match(/^([^/]+)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from:\s+([^\]]+)\]/);
      if (m) updates.push({ name: m[1], repo: m[2], newVersion: m[3], currentVersion: m[4] });
    }
    return updates;
  }

  // Verfügbare Updates auflisten
  fastify.get('/app/system-updates/api/list', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const pm = detectPM();
    if (!pm) return reply.send({ available: false, manager: null, updates: [], count: 0, message: 'Kein unterstützter Paketmanager' });
    if (pm === 'apt') {
      const updates = parseAptUpgradable(ctx.safeExec('apt list --upgradable 2>/dev/null', 10000));
      const reboot = ctx.safeExec('test -f /var/run/reboot-required && echo yes', 3000).trim() === 'yes';
      return reply.send({ available: true, manager: 'apt', updates, count: updates.length, rebootRequired: reboot });
    }
    if (pm === 'dnf') {
      const out = ctx.safeExec('dnf -q check-update 2>/dev/null', 15000);
      const updates = out.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3 && p[0].includes('.'))
        .map((p) => ({ name: p[0], currentVersion: '', newVersion: p[1], repo: p[2] }));
      return reply.send({ available: true, manager: 'dnf', updates, count: updates.length, rebootRequired: false });
    }
    const out = ctx.safeExec('pacman -Qu 2>/dev/null', 10000);
    const updates = out.split('\n').filter(Boolean).map((l) => { const p = l.split(/\s+/); return { name: p[0], currentVersion: p[1] || '', newVersion: p[3] || '', repo: '' }; });
    return reply.send({ available: true, manager: 'pacman', updates, count: updates.length, rebootRequired: false });
  });

  // Paket-Index aktualisieren
  fastify.post('/app/system-updates/api/check', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const pm = detectPM();
    if (!pm) return reply.status(400).send({ error: 'Kein Paketmanager' });
    try {
      if (pm === 'apt') ctx.privExec('apt-get update', { timeout: 120000 });
      else if (pm === 'dnf') ctx.privExec('dnf -q makecache', { timeout: 120000 });
      else ctx.privExec('pacman -Sy', { timeout: 120000 });
      ctx.audit(req.user.id, 'system.update.check', pm);
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Update-Check fehlgeschlagen' });
    }
  });

  // Updates einspielen (alle oder bestimmte Pakete)
  fastify.post('/app/system-updates/api/apply', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const pm = detectPM();
    if (!pm) return reply.status(400).send({ error: 'Kein Paketmanager' });
    const pkgs = ((req.body && req.body.packages) || []).map((p) => String(p).replace(/[^a-zA-Z0-9._+-]/g, '')).filter(Boolean);
    try {
      let cmd;
      if (pm === 'apt') {
        const dpkgOpts = '-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold';
        const inner = pkgs.length
          ? `DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${dpkgOpts} ${pkgs.join(' ')}`
          : `DEBIAN_FRONTEND=noninteractive apt-get upgrade -y ${dpkgOpts}`;
        cmd = `/bin/bash -c "${inner}"`;
      } else if (pm === 'dnf') {
        cmd = pkgs.length ? `dnf -y upgrade ${pkgs.join(' ')}` : 'dnf -y upgrade';
      } else {
        cmd = pkgs.length ? `pacman -S --noconfirm ${pkgs.join(' ')}` : 'pacman -Su --noconfirm';
      }
      const output = ctx.privExec(cmd, { timeout: 600000 });
      ctx.audit(req.user.id, 'system.update.apply', pkgs.join(',') || 'all');
      reply.send({ ok: true, output: String(output).slice(-4000) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update fehlgeschlagen';
      reply.status(500).send({ error: msg.includes('sudo') ? 'Keine Root-Rechte – bitte einmal „sudo bash install.sh --fix-perms" ausführen.' : msg });
    }
  });
};
