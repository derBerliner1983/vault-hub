import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { backupQueries, scheduleQueries, auditQueries } from '../db/index';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { notify } from '../lib/notify';
import { cronMatches, isValidCron } from '../lib/cronmatch';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.env.DATA_DIR || process.cwd(), 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function fileSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ── Reusable backup operations (shared by routes + scheduler) ──

export async function backupContainer(containerId: string, stop = false): Promise<{ file: string; size: number; name: string }> {
  ensureBackupDir();
  const container = docker.getContainer(containerId);
  const info = await container.inspect();
  const name = safeName(info.Name.replace(/^\//, ''));
  const volumes = (info.Mounts ?? []).filter((m) => m.Type === 'volume' || m.Type === 'bind');
  if (volumes.length === 0) throw new Error('Container hat keine Volumes zum Sichern');

  const wasRunning = info.State.Running;
  if (stop && wasRunning) await container.stop();

  const fileName = `container-${name}-${ts()}.tar.gz`;
  const outPath = path.join(BACKUP_DIR, fileName);
  const mountArgs = volumes
    .map((m, i) => `-v ${m.Type === 'volume' ? m.Name : m.Source}:/backup-src/${i}:ro`)
    .join(' ');
  const cmd = `docker run --rm ${mountArgs} -v ${BACKUP_DIR}:/backup busybox tar czf /backup/${fileName} -C /backup-src .`;
  execSync(cmd, { timeout: 300000 });

  if (stop && wasRunning) await container.start();

  const size = fileSize(outPath);
  backupQueries.create.run('container', name, containerId, outPath, size, 'ok');
  return { file: fileName, size, name };
}

export function backupDirectory(dir: string, label?: string): { file: string; size: number; name: string } {
  ensureBackupDir();
  if (!dir.startsWith('/')) throw new Error('Absoluter Pfad erforderlich');
  if (!fs.existsSync(dir)) throw new Error('Verzeichnis existiert nicht');
  const name = safeName(label || path.basename(dir) || 'root');
  const fileName = `dir-${name}-${ts()}.tar.gz`;
  const outPath = path.join(BACKUP_DIR, fileName);
  privExec(`tar czf ${outPath} -C ${path.dirname(dir)} ${path.basename(dir)}`, { timeout: 600000 });
  const size = fileSize(outPath);
  backupQueries.create.run('directory', name, dir, outPath, size, 'ok');
  return { file: fileName, size, name };
}

export function backupVm(vmName: string): { file: string; size: number; name: string } {
  ensureBackupDir();
  const vm = safeName(vmName);
  if (!vm) throw new Error('VM-Name erforderlich');
  if (!hasBinary('virsh')) throw new Error('libvirt nicht verfügbar');
  const xml = privExec(`virsh dumpxml ${vm}`, { timeout: 8000 });
  const disks = [...xml.matchAll(/<source file='([^']+\.qcow2)'/g)].map((m) => m[1]);
  if (disks.length === 0) throw new Error('Keine qcow2-Disk gefunden');
  const fileName = `vm-${vm}-${ts()}.qcow2`;
  const outPath = path.join(BACKUP_DIR, fileName);
  privExec(`qemu-img convert -O qcow2 -c ${disks[0]} ${outPath}`, { timeout: 1800000 });
  const size = fileSize(outPath);
  backupQueries.create.run('vm', vm, disks[0], outPath, size, 'ok');
  return { file: fileName, size, name: vm };
}

/** Keep only the newest `keep` backups for a (type, source) pair; delete the rest. */
function applyRetention(type: string, source: string, keep: number): number {
  if (keep <= 0) return 0;
  const rows = backupQueries.getAll.all().filter((b) => b.type === type && b.source === source);
  const stale = rows.slice(keep); // getAll is ordered newest-first
  let removed = 0;
  for (const row of stale) {
    try {
      if (fs.existsSync(row.path)) {
        if (row.path.startsWith(BACKUP_DIR)) fs.unlinkSync(row.path);
        else safeExec(`rm -f ${row.path}`);
      }
      backupQueries.delete.run(row.id);
      removed++;
    } catch { /* ignore individual failures */ }
  }
  return removed;
}

/** Run a single schedule now (used by the scheduler and the "run now" button). */
export async function runSchedule(id: number): Promise<{ file: string; size: number }> {
  const s = scheduleQueries.getById.get(id);
  if (!s) throw new Error('Zeitplan nicht gefunden');
  try {
    let res: { file: string; size: number; name: string };
    if (s.type === 'container') res = await backupContainer(s.source, s.stop_container === 1);
    else if (s.type === 'directory') res = backupDirectory(s.source, s.label);
    else if (s.type === 'vm') res = backupVm(s.source);
    else throw new Error('Unbekannter Backup-Typ');

    applyRetention(s.type, s.type === 'directory' ? s.source : s.source, s.retention);
    scheduleQueries.setRun.run(new Date().toISOString(), 'ok', res.file, id);
    void notify('success', `Backup „${s.label}" erstellt`, `Geplantes ${s.type}-Backup erfolgreich (${res.file}).`, 'backup');
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Fehler';
    scheduleQueries.setRun.run(new Date().toISOString(), 'error', msg, id);
    void notify('error', `Backup „${s.label}" fehlgeschlagen`, msg, 'backup');
    throw err;
  }
}

let lastTickMinute = '';

/** Called every minute by the server scheduler; runs all due schedules. */
export async function runDueSchedules(now = new Date()): Promise<void> {
  const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (stamp === lastTickMinute) return; // guard against double-fire within the same minute
  lastTickMinute = stamp;
  for (const s of scheduleQueries.getEnabled.all()) {
    if (cronMatches(s.schedule, now)) {
      try { await runSchedule(s.id); } catch { /* already logged + notified */ }
    }
  }
}

export async function backupRoutes(fastify: FastifyInstance) {
  ensureBackupDir();

  fastify.get('/api/backups', { preHandler: requireAuth }, async (_req, reply) => {
    const backups = backupQueries.getAll.all().map((b) => ({ ...b, exists: fs.existsSync(b.path) }));
    reply.send({ backups, dir: BACKUP_DIR });
  });

  fastify.post<{ Body: { containerId: string; stop?: boolean } }>(
    '/api/backups/container',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { containerId, stop } = req.body ?? {};
      if (!containerId) return reply.status(400).send({ error: 'Container-ID erforderlich' });
      try {
        const res = await backupContainer(containerId, !!stop);
        auditQueries.log.run(req.user.id, 'backup.container', res.name);
        reply.status(201).send({ ok: true, file: res.file, size: res.size });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Backup fehlgeschlagen' });
      }
    }
  );

  fastify.post<{ Body: { dir: string; label?: string } }>(
    '/api/backups/directory',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { dir, label } = req.body ?? {};
      try {
        const res = backupDirectory(dir, label);
        auditQueries.log.run(req.user.id, 'backup.directory', dir);
        reply.status(201).send({ ok: true, file: res.file, size: res.size });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Backup fehlgeschlagen' });
      }
    }
  );

  fastify.post<{ Body: { vm: string } }>(
    '/api/backups/vm',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const res = backupVm(req.body?.vm ?? '');
        auditQueries.log.run(req.user.id, 'backup.vm', res.name);
        reply.status(201).send({ ok: true, file: res.file, size: res.size });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'VM-Backup fehlgeschlagen' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/backups/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const row = backupQueries.getById.get(id);
      if (!row) return reply.status(404).send({ error: 'Backup nicht gefunden' });
      try {
        if (fs.existsSync(row.path)) {
          if (row.path.startsWith(BACKUP_DIR)) fs.unlinkSync(row.path);
          else safeExec(`rm -f ${row.path}`);
        }
        backupQueries.delete.run(id);
        auditQueries.log.run(req.user.id, 'backup.delete', row.name);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Löschen fehlgeschlagen' });
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/backups/:id/download',
    { preHandler: requireAuth },
    async (req, reply) => {
      const row = backupQueries.getById.get(parseInt(req.params.id));
      if (!row || !fs.existsSync(row.path)) return reply.status(404).send({ error: 'Datei nicht gefunden' });
      const stream = fs.createReadStream(row.path);
      reply.header('Content-Disposition', `attachment; filename="${path.basename(row.path)}"`);
      reply.type('application/gzip');
      return reply.send(stream);
    }
  );

  fastify.get('/api/backups/sources', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const containers = await docker.listContainers({ all: true });
      const list = await Promise.all(
        containers.map(async (c) => {
          const info = await docker.getContainer(c.Id).inspect().catch(() => null);
          const volumes = info ? (info.Mounts ?? []).filter((m) => m.Type === 'volume' || m.Type === 'bind').length : 0;
          return { id: c.Id, name: (c.Names[0] ?? '').replace(/^\//, ''), state: c.State, volumes };
        })
      );
      reply.send({ containers: list.filter((c) => c.volumes > 0) });
    } catch {
      reply.send({ containers: [] });
    }
  });

  // ── Backup schedules (automatic, cron-based, with retention) ──
  fastify.get('/api/backups/schedules', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({ schedules: scheduleQueries.getAll.all() });
  });

  fastify.post<{ Body: { type: string; source: string; label?: string; schedule: string; retention?: number; stop?: boolean } }>(
    '/api/backups/schedules',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { type, source, label, schedule, retention, stop } = req.body ?? {};
      if (!['container', 'directory', 'vm'].includes(type)) return reply.status(400).send({ error: 'Ungültiger Typ' });
      if (!source) return reply.status(400).send({ error: 'Quelle erforderlich' });
      if (!isValidCron(schedule)) return reply.status(400).send({ error: 'Zeitplan muss 5 Felder haben (m h dom mon dow)' });
      const info = scheduleQueries.create.run(type, source, label || source, schedule, Math.max(0, retention ?? 7), stop ? 1 : 0);
      auditQueries.log.run(req.user.id, 'backup.schedule.add', `${type}:${source}`);
      reply.status(201).send({ ok: true, id: info.lastInsertRowid });
    }
  );

  fastify.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/backups/schedules/:id/toggle',
    { preHandler: requireAdmin },
    async (req, reply) => {
      scheduleQueries.setEnabled.run(req.body?.enabled ? 1 : 0, parseInt(req.params.id));
      reply.send({ ok: true });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/backups/schedules/:id/run',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const res = await runSchedule(parseInt(req.params.id));
        auditQueries.log.run(req.user.id, 'backup.schedule.run', req.params.id);
        reply.send({ ok: true, file: res.file, size: res.size });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Backup fehlgeschlagen' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/backups/schedules/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      scheduleQueries.delete.run(parseInt(req.params.id));
      auditQueries.log.run(req.user.id, 'backup.schedule.delete', req.params.id);
      reply.send({ ok: true });
    }
  );
}
