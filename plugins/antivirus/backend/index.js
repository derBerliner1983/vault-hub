'use strict';
// Virenschutz-Plugin-Backend (CommonJS), portiert von Core-Hubs antivirus.ts.
// ClamAV: Status, Installation, Signatur-Update, Daemon/Auto-Update, Hintergrund-Scan.
// Nutzt den Plugin-Kontext (ctx.isRoot/privExec/safeExec/audit) — dependency-frei.

const { spawn } = require('child_process');

let scan = { running: false, path: '', scanned: 0, infected: [] };

module.exports.register = function register(fastify, ctx) {
  const hasBinary = (bin) => ctx.safeExec(`command -v ${bin} 2>/dev/null`, 3000).trim() !== '';
  const spawnPriv = (bin, args) => (ctx.isRoot ? spawn(bin, args) : spawn('sudo', ['-n', bin, ...args]));

  const auth = async (req, reply, admin) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (admin && req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };

  function defsAgeDays() {
    const ts = ctx.safeExec("stat -c %Y /var/lib/clamav/daily.cvd /var/lib/clamav/daily.cld 2>/dev/null | sort -n | tail -1", 3000).trim();
    if (!ts) return null;
    return Math.floor((Date.now() / 1000 - parseInt(ts)) / 86400);
  }
  function avStatus() {
    const installed = hasBinary('clamscan') || hasBinary('clamdscan');
    return {
      installed,
      daemonActive: ctx.safeExec('systemctl is-active clamav-daemon 2>/dev/null', 3000).trim() === 'active',
      freshclamActive: ctx.safeExec('systemctl is-active clamav-freshclam 2>/dev/null', 3000).trim() === 'active',
      version: installed ? ctx.safeExec('clamscan --version 2>/dev/null', 3000).trim() : '',
      defsAgeDays: defsAgeDays(),
    };
  }

  fastify.get('/app/antivirus/api/status', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const status = avStatus();
    reply.send({
      ...status,
      message: status.installed ? undefined : 'ClamAV nicht installiert',
      scan: {
        running: scan.running, path: scan.path, startedAt: scan.startedAt, finishedAt: scan.finishedAt,
        scanned: scan.scanned, infectedCount: scan.infected.length, infected: scan.infected.slice(0, 200), error: scan.error,
      },
    });
  });

  fastify.post('/app/antivirus/api/install', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    try {
      if (hasBinary('apt-get')) ctx.privExec('apt-get install -y clamav clamav-daemon', { timeout: 300000 });
      else if (hasBinary('dnf')) ctx.privExec('dnf install -y clamav clamav-update clamd', { timeout: 300000 });
      else if (hasBinary('pacman')) ctx.privExec('pacman -S --noconfirm clamav', { timeout: 300000 });
      else return reply.status(400).send({ error: 'Kein unterstützter Paketmanager' });
      ctx.audit(req.user.id, 'antivirus.install', null);
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Installation fehlgeschlagen' });
    }
  });

  fastify.post('/app/antivirus/api/update', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    if (!hasBinary('freshclam')) return reply.status(503).send({ error: 'freshclam nicht installiert' });
    try {
      try { ctx.privExec('systemctl stop clamav-freshclam', { timeout: 8000 }); } catch (_) { /* evtl. inaktiv */ }
      try { ctx.privExec('freshclam', { timeout: 180000 }); }
      finally { try { ctx.privExec('systemctl start clamav-freshclam', { timeout: 8000 }); } catch (_) { /* */ } }
      ctx.audit(req.user.id, 'antivirus.update', null);
      reply.send({ ok: true, defsAgeDays: defsAgeDays() });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Update fehlgeschlagen' });
    }
  });

  fastify.post('/app/antivirus/api/daemon', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const service = req.body && req.body.service;
    if (service !== 'daemon' && service !== 'freshclam') return reply.status(400).send({ error: 'Ungültiger Dienst' });
    const unit = service === 'freshclam' ? 'clamav-freshclam' : 'clamav-daemon';
    try {
      if (req.body.enable) {
        if (service === 'daemon' && defsAgeDays() === null && hasBinary('freshclam')) {
          try { ctx.privExec('freshclam', { timeout: 180000 }); } catch (_) { /* */ }
        }
        ctx.privExec(`systemctl enable --now ${unit}`, { timeout: 30000 });
      } else {
        ctx.privExec(`systemctl disable --now ${unit}`, { timeout: 15000 });
      }
      ctx.audit(req.user.id, `antivirus.${service}`, req.body.enable ? 'on' : 'off');
      const active = ctx.safeExec(`systemctl is-active ${unit} 2>/dev/null`, 3000).trim() === 'active';
      reply.send({ ok: true, active });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Aktion fehlgeschlagen' });
    }
  });

  fastify.post('/app/antivirus/api/scan', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    if (!hasBinary('clamscan') && !hasBinary('clamdscan')) return reply.status(503).send({ error: 'ClamAV nicht installiert' });
    if (scan.running) return reply.status(409).send({ error: 'Es läuft bereits ein Scan' });
    const path = ((req.body && req.body.path) || '').trim();
    if (!path.startsWith('/')) return reply.status(400).send({ error: 'Absoluter Pfad erforderlich' });
    const excludeDirs = ((req.body && req.body.exclude) || '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('/'));

    scan = { running: true, path, startedAt: new Date().toISOString(), scanned: 0, infected: [] };
    const useDaemon = hasBinary('clamdscan') && avStatus().daemonActive && excludeDirs.length === 0;
    const bin = useDaemon ? 'clamdscan' : 'clamscan';
    const excludeArgs = excludeDirs.map((d) => `--exclude-dir=^${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const args = useDaemon ? ['-m', '--fdpass', '-i', path] : ['-r', ...excludeArgs, '-i', path];

    const child = spawnPriv(bin, args);
    let buf = '';
    child.stdout && child.stdout.on('data', (data) => {
      buf += data.toString();
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        const m = line.match(/^(.*):\s+(.+)\s+FOUND$/);
        if (m) scan.infected.push({ file: m[1], virus: m[2] });
        const sc = line.match(/^Scanned files:\s+(\d+)/);
        if (sc) scan.scanned = parseInt(sc[1]);
      }
    });
    child.on('error', (e) => { scan.running = false; scan.error = e.message; scan.finishedAt = new Date().toISOString(); });
    child.on('close', () => {
      scan.running = false; scan.finishedAt = new Date().toISOString();
      ctx.audit(req.user.id, 'antivirus.scan', `${path} (${scan.infected.length} Funde)`);
    });
    reply.send({ ok: true, started: true });
  });
};
