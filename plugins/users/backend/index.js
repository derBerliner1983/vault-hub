'use strict';
// Benutzer-Plugin-Backend (CommonJS). Verwaltet LINUX-Systembenutzer (portiert
// von Core-Hubs linuxusers.ts). Web-Logins werden von der Kern-API (/api/users)
// abgedeckt und direkt vom Frontend genutzt.

module.exports.register = function register(fastify, ctx) {
  const auth = async (req, reply, admin) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (admin && req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };
  const clean = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '');

  function parsePasswd() {
    const passwd = ctx.safeExec('cat /etc/passwd', 4000);
    const users = [];
    for (const line of passwd.split('\n')) {
      const p = line.split(':');
      if (p.length < 7) continue;
      const uid = parseInt(p[2]);
      const username = p[0];
      const groups = ctx.safeExec(`id -nG ${clean(username)} 2>/dev/null`, 3000).trim().split(/\s+/).filter(Boolean);
      users.push({ username, uid, gid: parseInt(p[3]), home: p[5], shell: p[6], groups, system: uid < 1000 || uid === 65534 });
    }
    return users;
  }

  fastify.get('/app/users/api/linux/users', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const all = parsePasswd();
    const showSystem = (req.query && req.query.system) === '1';
    reply.send({ users: showSystem ? all : all.filter((u) => !u.system) });
  });

  fastify.get('/app/users/api/linux/groups', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const groups = ctx.safeExec('cut -d: -f1 /etc/group', 4000).split('\n').map((g) => g.trim()).filter(Boolean);
    reply.send({ groups });
  });

  fastify.post('/app/users/api/linux/users', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const username = clean(req.body && req.body.username);
    if (!username) return reply.status(400).send({ error: 'Ungültiger Benutzername' });
    const password = (req.body && req.body.password) || '';
    const groups = ((req.body && req.body.groups) || []).map(clean).filter(Boolean);
    if (req.body && req.body.sudo && !groups.includes('sudo')) groups.push('sudo');
    try {
      ctx.privExec(`useradd -m -s /bin/bash ${username}`, { timeout: 8000 });
      if (password) ctx.privExec(`bash -c "echo '${username}:${password}' | chpasswd"`, { timeout: 6000 });
      for (const g of groups) ctx.privExec(`usermod -aG ${g} ${username}`, { timeout: 5000 });
      ctx.audit(req.user.id, 'linuxuser.create', username);
      reply.status(201).send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'useradd-Fehler' });
    }
  });

  fastify.post('/app/users/api/linux/users/:username/password', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const username = clean(req.params.username);
    const password = (req.body && req.body.password) || '';
    if (!password) return reply.status(400).send({ error: 'Passwort erforderlich' });
    try {
      ctx.privExec(`bash -c "echo '${username}:${password}' | chpasswd"`, { timeout: 6000 });
      ctx.audit(req.user.id, 'linuxuser.passwd', username);
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'chpasswd-Fehler' });
    }
  });

  fastify.delete('/app/users/api/linux/users/:username', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const username = clean(req.params.username);
    if (['root', 'vault-hub'].includes(username)) return reply.status(400).send({ error: 'Systemkritischer Benutzer' });
    try {
      const flag = (req.query && req.query.removeHome) === '1' ? '-r ' : '';
      ctx.privExec(`userdel ${flag}${username}`, { timeout: 8000 });
      ctx.audit(req.user.id, 'linuxuser.delete', username);
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'userdel-Fehler' });
    }
  });
};
