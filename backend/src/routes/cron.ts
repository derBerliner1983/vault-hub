import type { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries } from '../db/index';

interface CronJob {
  id: number;
  schedule: string;
  command: string;
  comment: string;
  enabled: boolean;
  raw: string;
}

function readCrontab(): string {
  try {
    return execSync('crontab -l 2>/dev/null', { timeout: 4000 }).toString();
  } catch {
    return '';
  }
}

function parseCrontab(raw: string): CronJob[] {
  const lines = raw.split('\n');
  const jobs: CronJob[] = [];
  let lastComment = '';
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      lastComment = trimmed.replace(/^#+\s*/, '');
      return;
    }
    const disabled = false;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 6) return;
    const schedule = parts.slice(0, 5).join(' ');
    const command = parts.slice(5).join(' ');
    jobs.push({
      id: idx,
      schedule,
      command,
      comment: lastComment,
      enabled: !disabled,
      raw: line,
    });
    lastComment = '';
  });
  return jobs;
}

function writeCrontab(content: string): void {
  const tmp = `/tmp/corehub-cron-${Date.now()}`;
  execSync(`cat > ${tmp} <<'COREHUB_EOF'\n${content}\nCOREHUB_EOF`, { timeout: 4000 });
  execSync(`crontab ${tmp} && rm -f ${tmp}`, { timeout: 4000 });
}

export async function cronRoutes(fastify: FastifyInstance) {
  fastify.get('/api/cron', { preHandler: requireAuth }, async (_req, reply) => {
    const raw = readCrontab();
    reply.send({ jobs: parseCrontab(raw), raw });
  });

  fastify.post<{ Body: { schedule: string; command: string; comment?: string } }>(
    '/api/cron',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { schedule, command, comment } = req.body ?? {};
      if (!schedule || !command) return reply.status(400).send({ error: 'Zeitplan und Befehl erforderlich' });
      if (schedule.split(/\s+/).length !== 5) return reply.status(400).send({ error: 'Zeitplan muss 5 Felder haben (m h dom mon dow)' });
      try {
        const current = readCrontab().replace(/\n+$/, '');
        const block = `${comment ? `# ${comment}\n` : ''}${schedule} ${command}`;
        writeCrontab(`${current}\n${block}\n`);
        auditQueries.log.run(req.user.id, 'cron.add', command);
        reply.status(201).send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Crontab Fehler' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/cron/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const targetId = parseInt(req.params.id);
      try {
        const raw = readCrontab();
        const lines = raw.split('\n');
        const newLines = lines.filter((_, idx) => idx !== targetId);
        writeCrontab(newLines.join('\n').replace(/\n+$/, '') + '\n');
        auditQueries.log.run(req.user.id, 'cron.remove', String(targetId));
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Crontab Fehler' });
      }
    }
  );

  fastify.put<{ Body: { raw: string } }>(
    '/api/cron/raw',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { raw } = req.body ?? {};
      if (typeof raw !== 'string') return reply.status(400).send({ error: 'Ungültiger Inhalt' });
      try {
        writeCrontab(raw.replace(/\n+$/, '') + '\n');
        auditQueries.log.run(req.user.id, 'cron.edit', null);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Crontab Fehler' });
      }
    }
  );
}
