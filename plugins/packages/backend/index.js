'use strict';
// Paketverwaltung-Plugin-Backend (CommonJS), portiert von Core-Hubs packages.ts.
// Installierte Pakete auflisten, suchen, installieren/entfernen (apt/dnf/pacman).

module.exports.register = function register(fastify, ctx) {
  const auth = async (req, reply, admin) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (admin && req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };
  const has = (bin) => ctx.safeExec(`command -v ${bin} 2>/dev/null`, 3000).trim() !== '';
  const detectPM = () => has('apt-get') ? 'apt' : has('dnf') ? 'dnf' : has('pacman') ? 'pacman' : null;
  const sanitize = (list) => (list || []).map((p) => String(p).replace(/[^a-zA-Z0-9._+:-]/g, '')).filter(Boolean);

  function listApt() {
    const out = ctx.safeExec("dpkg-query -W -f='${db:Status-Abbrev}\\t${Package}\\t${Version}\\t${Installed-Size}\\t${binary:Summary}\\n' 2>/dev/null", 15000);
    const autoSet = new Set(ctx.safeExec('apt-mark showauto 2>/dev/null', 10000).split('\n').map((l) => l.trim()).filter(Boolean));
    const pkgs = [];
    for (const line of out.split('\n')) {
      const p = line.split('\t');
      if (p.length < 4 || !p[0].trim().startsWith('ii')) continue;
      const name = p[1].trim(); if (!name) continue;
      pkgs.push({ name, version: p[2].trim(), size: (parseInt(p[3], 10) || 0) * 1024, summary: (p[4] || '').trim().slice(0, 160), auto: autoSet.has(name) });
    }
    return pkgs;
  }
  function listRpm() {
    const out = ctx.safeExec("rpm -qa --qf '%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{SIZE}\\t%{SUMMARY}\\n' 2>/dev/null", 15000);
    const userSet = new Set(ctx.safeExec('dnf -q repoquery --userinstalled 2>/dev/null', 12000).split('\n').map((l) => l.trim().replace(/-\d.*$/, '')).filter(Boolean));
    const pkgs = [];
    for (const line of out.split('\n')) {
      const p = line.split('\t'); if (p.length < 3) continue;
      const name = p[0].trim(); if (!name) continue;
      pkgs.push({ name, version: p[1].trim(), size: parseInt(p[2], 10) || 0, summary: (p[3] || '').trim().slice(0, 160), auto: userSet.size ? !userSet.has(name) : false });
    }
    return pkgs;
  }
  function listPacman() {
    const explicitSet = new Set(ctx.safeExec('pacman -Qeq 2>/dev/null', 10000).split('\n').map((l) => l.trim()).filter(Boolean));
    const pkgs = [];
    for (const line of ctx.safeExec('pacman -Q 2>/dev/null', 12000).split('\n')) {
      const [name, version] = line.trim().split(/\s+/); if (!name) continue;
      pkgs.push({ name, version: version || '', size: 0, summary: '', auto: explicitSet.size ? !explicitSet.has(name) : false });
    }
    return pkgs;
  }

  const P = '/app/packages/api';

  fastify.get(P + '/installed', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const pm = detectPM();
    if (!pm) return reply.send({ available: false, manager: null, packages: [], count: 0 });
    let packages = [];
    try { packages = pm === 'apt' ? listApt() : pm === 'dnf' ? listRpm() : listPacman(); } catch (_) {}
    packages.sort((a, b) => a.name.localeCompare(b.name));
    reply.send({ available: true, manager: pm, packages, count: packages.length });
  });

  fastify.get(P + '/search', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const pm = detectPM();
    if (!pm) return reply.send({ results: [] });
    const q = String((req.query && req.query.q) || '').replace(/[^a-zA-Z0-9._+-]/g, '').slice(0, 60);
    if (q.length < 2) return reply.send({ results: [] });
    const results = [];
    try {
      if (pm === 'apt') {
        for (const line of ctx.safeExec(`apt-cache search ${q} 2>/dev/null | head -50`, 12000).split('\n')) {
          const m = line.match(/^(\S+)\s+-\s+(.*)$/);
          if (m) { const installed = ctx.safeExec(`dpkg-query -W -f='\${db:Status-Abbrev}' ${m[1]} 2>/dev/null`, 4000).trim().startsWith('ii'); results.push({ name: m[1], summary: m[2].slice(0, 160), installed }); }
        }
      } else if (pm === 'dnf') {
        for (const line of ctx.safeExec(`dnf -q search ${q} 2>/dev/null | head -50`, 15000).split('\n')) {
          const m = line.match(/^(\S+?)\.\S+\s+:\s+(.*)$/); if (m) results.push({ name: m[1], summary: m[2].slice(0, 160), installed: false });
        }
      } else {
        const lines = ctx.safeExec(`pacman -Ss ${q} 2>/dev/null | head -100`, 12000).split('\n');
        for (let i = 0; i < lines.length; i++) {
          const head = lines[i].match(/^\S+\/(\S+)\s+\S+(\s+\[installiert\]|\s+\[installed\])?/);
          if (head) results.push({ name: head[1], summary: (lines[i + 1] || '').trim().slice(0, 160), installed: !!head[2] });
        }
      }
    } catch (_) {}
    reply.send({ results: results.slice(0, 50) });
  });

  function apply(action, pkgs, purge) {
    const pm = detectPM();
    let cmd;
    if (pm === 'apt') {
      const opts = '-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold';
      const act = action === 'install' ? 'install' : (purge ? 'purge' : 'remove');
      cmd = `/bin/bash -c "DEBIAN_FRONTEND=noninteractive apt-get ${act} -y ${opts} ${pkgs.join(' ')}"`;
    } else if (pm === 'dnf') {
      cmd = action === 'install' ? `dnf -y install ${pkgs.join(' ')}` : `dnf -y remove ${pkgs.join(' ')}`;
    } else {
      cmd = action === 'install' ? `pacman -S --noconfirm ${pkgs.join(' ')}` : `pacman -R --noconfirm ${pkgs.join(' ')}`;
    }
    return String(ctx.privExec(cmd, { timeout: 600000 })).slice(-4000);
  }

  fastify.post(P + '/install', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    if (!detectPM()) return reply.status(400).send({ error: 'Kein Paketmanager' });
    const pkgs = sanitize(req.body && req.body.packages);
    if (!pkgs.length) return reply.status(400).send({ error: 'Keine Pakete angegeben' });
    try { const output = apply('install', pkgs, false); ctx.audit(req.user.id, 'package.install', pkgs.join(',')); reply.send({ ok: true, output }); }
    catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Installation fehlgeschlagen' }); }
  });

  fastify.post(P + '/remove', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    if (!detectPM()) return reply.status(400).send({ error: 'Kein Paketmanager' });
    const pkgs = sanitize(req.body && req.body.packages);
    if (!pkgs.length) return reply.status(400).send({ error: 'Keine Pakete angegeben' });
    try { const output = apply('remove', pkgs, req.body && req.body.purge === true); ctx.audit(req.user.id, 'package.remove', pkgs.join(',')); reply.send({ ok: true, output }); }
    catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Entfernen fehlgeschlagen' }); }
  });
};
