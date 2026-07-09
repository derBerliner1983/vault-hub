import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec } from '../lib/privilege';
import { auditQueries } from '../db/index';

interface LinuxUser {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  groups: string[];
  system: boolean;
}

function parsePasswd(): LinuxUser[] {
  const passwd = safeExec('cat /etc/passwd', 4000);
  const users: LinuxUser[] = [];
  for (const line of passwd.split('\n')) {
    const p = line.split(':');
    if (p.length < 7) continue;
    const uid = parseInt(p[2]);
    const username = p[0];
    const system = uid < 1000 || uid === 65534;
    const groups = safeExec(`id -nG ${username.replace(/[^a-zA-Z0-9_-]/g, '')} 2>/dev/null`, 3000)
      .trim().split(/\s+/).filter(Boolean);
    users.push({ username, uid, gid: parseInt(p[3]), home: p[5], shell: p[6], groups, system });
  }
  return users;
}

export async function linuxUserRoutes(fastify: FastifyInstance) {
  fastify.get('/api/linux-users', { preHandler: requireAuth }, async (req, reply) => {
    const all = parsePasswd();
    // Viewers and the UI only care about real (non-system) users by default
    const showSystem = (req.query as { system?: string })?.system === '1';
    reply.send({ users: showSystem ? all : all.filter((u) => !u.system) });
  });

  fastify.get('/api/linux-groups', { preHandler: requireAuth }, async (_req, reply) => {
    const groups = safeExec('cut -d: -f1 /etc/group', 4000).split('\n').map((g) => g.trim()).filter(Boolean);
    reply.send({ groups });
  });

  fastify.post<{ Body: { username: string; password?: string; groups?: string[]; sudo?: boolean } }>(
    '/api/linux-users',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const username = (req.body?.username ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!username) return reply.status(400).send({ error: 'Ungültiger Benutzername' });
      const password = req.body?.password ?? '';
      const groups = (req.body?.groups ?? []).map((g) => g.replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean);
      if (req.body?.sudo && !groups.includes('sudo')) groups.push('sudo');
      try {
        privExec(`useradd -m -s /bin/bash ${username}`, { timeout: 8000 });
        if (password) {
          privExec(`bash -c "echo '${username}:${password}' | chpasswd"`, { timeout: 6000 });
        }
        for (const g of groups) {
          safeExec(`getent group ${g} >/dev/null && true`);
          privExec(`usermod -aG ${g} ${username}`, { timeout: 5000 });
        }
        auditQueries.log.run(req.user.id, 'linuxuser.create', username);
        reply.status(201).send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'useradd-Fehler' });
      }
    }
  );

  fastify.post<{ Params: { username: string }; Body: { password: string } }>(
    '/api/linux-users/:username/password',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const username = req.params.username.replace(/[^a-zA-Z0-9_-]/g, '');
      const password = req.body?.password ?? '';
      if (!password) return reply.status(400).send({ error: 'Passwort erforderlich' });
      try {
        privExec(`bash -c "echo '${username}:${password}' | chpasswd"`, { timeout: 6000 });
        auditQueries.log.run(req.user.id, 'linuxuser.passwd', username);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'chpasswd-Fehler' });
      }
    }
  );

  fastify.delete<{ Params: { username: string }; Querystring: { removeHome?: string } }>(
    '/api/linux-users/:username',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const username = req.params.username.replace(/[^a-zA-Z0-9_-]/g, '');
      if (['root', 'vault-hub'].includes(username)) return reply.status(400).send({ error: 'Systemkritischer Benutzer' });
      try {
        const flag = req.query.removeHome === '1' ? '-r ' : '';
        privExec(`userdel ${flag}${username}`, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'linuxuser.delete', username);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'userdel-Fehler' });
      }
    }
  );
}
