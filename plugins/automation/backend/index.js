'use strict';
// Automatisierung-Plugin-Backend (CommonJS), portiert von Core-Hubs cron.ts.
// Verwaltet die crontab des Dienst-Benutzers (list/add/delete/raw).

const fs = require('fs');
const { execSync } = require('child_process');

function readCrontab() {
  try { return execSync('crontab -l 2>/dev/null', { timeout: 4000 }).toString(); } catch (_) { return ''; }
}
function writeCrontab(content) {
  const tmp = `/tmp/vh-cron-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  try { execSync(`crontab ${tmp}`, { timeout: 4000 }); } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}
function parseCrontab(raw) {
  const jobs = []; let lastComment = '';
  raw.split('\n').forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    if (t.startsWith('#')) { lastComment = t.replace(/^#+\s*/, ''); return; }
    const parts = t.split(/\s+/);
    if (parts.length < 6) return;
    jobs.push({ id: idx, schedule: parts.slice(0, 5).join(' '), command: parts.slice(5).join(' '), comment: lastComment, raw: line });
    lastComment = '';
  });
  return jobs;
}

module.exports.register = function register(fastify, ctx) {
  const auth = async (req, reply, admin) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (admin && req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };
  const P = '/app/automation/api';

  fastify.get(P + '/jobs', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const raw = readCrontab();
    reply.send({ jobs: parseCrontab(raw), raw });
  });

  fastify.post(P + '/jobs', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const { schedule, command, comment } = req.body || {};
    if (!schedule || !command) return reply.status(400).send({ error: 'Zeitplan und Befehl erforderlich' });
    if (String(schedule).trim().split(/\s+/).length !== 5) return reply.status(400).send({ error: 'Zeitplan muss 5 Felder haben (m h dom mon dow)' });
    try {
      const current = readCrontab().replace(/\n+$/, '');
      const block = `${comment ? `# ${comment}\n` : ''}${schedule} ${command}`;
      writeCrontab(`${current}\n${block}\n`.replace(/^\n/, ''));
      ctx.audit(req.user.id, 'cron.add', command);
      reply.status(201).send({ ok: true });
    } catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Crontab-Fehler' }); }
  });

  fastify.delete(P + '/jobs/:id', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const target = parseInt(req.params.id);
    try {
      const lines = readCrontab().split('\n').filter((_, idx) => idx !== target);
      writeCrontab(lines.join('\n').replace(/\n+$/, '') + '\n');
      ctx.audit(req.user.id, 'cron.remove', String(target));
      reply.send({ ok: true });
    } catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Crontab-Fehler' }); }
  });

  fastify.put(P + '/raw', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const raw = req.body && req.body.raw;
    if (typeof raw !== 'string') return reply.status(400).send({ error: 'Ungültiger Inhalt' });
    try { writeCrontab(raw.replace(/\n+$/, '') + '\n'); ctx.audit(req.user.id, 'cron.edit', null); reply.send({ ok: true }); }
    catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Crontab-Fehler' }); }
  });
};
