'use strict';
// Taskmanager-Plugin-Backend (CommonJS). Prozesse via `ps`, Dienste via
// systemctl — dependency-frei über den Plugin-Kontext (ctx.safeExec/privExec).

module.exports.register = function register(fastify, ctx) {
  const auth = async (req, reply, admin) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (admin && req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };

  // ── Prozesse ──
  fastify.get('/app/taskmanager/api/processes', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const out = ctx.safeExec('ps -eo pid,user,pcpu,pmem,rss,stat,comm,args --sort=-pcpu --no-headers 2>/dev/null', 5000);
    const list = [];
    for (const line of out.split('\n')) {
      const t = line.trim(); if (!t) continue;
      const p = t.split(/\s+/);
      if (p.length < 8) continue;
      const cpu = parseFloat(p[2]) || 0, mem = parseFloat(p[3]) || 0, rss = parseInt(p[4]) || 0;
      if (cpu < 0.1 && rss < 5120) continue; // Rauschen ausblenden
      list.push({
        pid: parseInt(p[0]), user: p[1], cpu: Math.round(cpu * 10) / 10, mem: Math.round(mem * 10) / 10,
        memRss: rss * 1024, state: p[5], name: p[6], command: p.slice(7).join(' ').substring(0, 140),
      });
      if (list.length >= 80) break;
    }
    reply.send({ processes: list });
  });

  fastify.post('/app/taskmanager/api/processes/:pid/kill', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const pid = parseInt(req.params.pid);
    if (!pid || pid < 100) return reply.status(400).send({ error: 'Ungültige PID' });
    const sig = req.body && req.body.signal === 'KILL' ? 'KILL' : 'TERM';
    try {
      try { process.kill(pid, 'SIG' + sig); }
      catch (e) { if (e && e.code === 'EPERM') ctx.privExec(`kill -${sig} ${pid}`, { timeout: 5000 }); else throw e; }
      ctx.audit(req.user.id, 'taskmanager.kill', String(pid));
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Kill fehlgeschlagen' });
    }
  });

  // ── Dienste (systemd) ──
  fastify.get('/app/taskmanager/api/services', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const out = ctx.safeExec('systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null | head -200', 6000);
    // Autostart-Status gebündelt ermitteln
    const enabledSet = new Set(
      ctx.safeExec('systemctl list-unit-files --type=service --state=enabled --no-legend --plain 2>/dev/null', 6000)
        .split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean)
    );
    const services = out.split('\n').map((line) => {
      const p = line.trim().replace(/^●\s*/, '').split(/\s+/);
      const name = p[0] || '';
      return { name, load: p[1] || '', active: p[2] || '', sub: p[3] || '', description: p.slice(4).join(' '), enabled: enabledSet.has(name) };
    }).filter((s) => s.name.endsWith('.service'));
    reply.send({ services });
  });

  fastify.post('/app/taskmanager/api/services/control', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const { service, action } = req.body || {};
    if (!['start', 'stop', 'restart', 'enable', 'disable'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
    const name = String(service || '').replace(/[^a-zA-Z0-9@._-]/g, '');
    if (!name) return reply.status(400).send({ error: 'Ungültiger Dienst' });
    try {
      ctx.privExec(`systemctl ${action} ${name}`, { timeout: 10000 });
      ctx.audit(req.user.id, 'taskmanager.service.' + action, name);
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'systemctl Fehler' });
    }
  });
};
