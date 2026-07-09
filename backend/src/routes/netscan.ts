import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { scanHostTcp, scanViaExec, scanViaSsh } from '../lib/probe';

// Hintergrund-Stapelverarbeitung für Port-Scans: Jobs werden der Reihe nach
// abgearbeitet, das Ergebnis kommt als Bericht. Jobs sind entfernbar.
type Via = 'local' | 'exec' | 'ssh';
interface Job {
  id: string; label: string; via: Via; container?: string; nodeId?: string; host: string;
  ports: number[]; status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  done: number; total: number; open: number[]; error?: string; createdAt: number; finishedAt?: number;
}

const jobs = new Map<string, Job>();
let working = false;

function pruneOld() {
  const finished = [...jobs.values()].filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'canceled')
    .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  while (finished.length > 20) { const j = finished.shift()!; jobs.delete(j.id); }
}

async function runJob(job: Job) {
  const CHUNK = job.via === 'local' ? 600 : 300;
  const open: number[] = [];
  for (let i = 0; i < job.ports.length; i += CHUNK) {
    if (job.status === 'canceled') return;
    const slice = job.ports.slice(i, i + CHUNK);
    try {
      const found = job.via === 'local' ? await scanHostTcp(job.host, slice)
        : job.via === 'exec' ? await scanViaExec(job.container!, job.host, slice)
        : await scanViaSsh(job.nodeId!, job.host, slice);
      for (const p of found) if (!open.includes(p)) open.push(p);
      job.open = [...open].sort((a, b) => a - b);
    } catch (e) { job.error = e instanceof Error ? e.message : 'Scan-Fehler'; }
    job.done = Math.min(i + CHUNK, job.ports.length);
  }
  if (job.status !== 'canceled') { job.status = job.error ? 'error' : 'done'; job.finishedAt = Date.now(); }
}

async function pump() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const next = [...jobs.values()].find((j) => j.status === 'queued');
      if (!next) break;
      next.status = 'running';
      await runJob(next);
      pruneOld();
    }
  } finally { working = false; }
}

function expandPorts(body: { ports?: number[]; from?: number; to?: number }): number[] {
  if (Array.isArray(body.ports) && body.ports.length) {
    return [...new Set(body.ports.map(Number).filter((p) => p >= 1 && p <= 65535))].slice(0, 65535);
  }
  const from = Math.max(1, Math.min(65535, Number(body.from) || 1));
  const to = Math.max(from, Math.min(65535, Number(body.to) || 65535));
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p);
  return out;
}

export async function netscanRoutes(fastify: FastifyInstance) {
  // Job anlegen (Stapel)
  fastify.post<{ Body: { via: Via; container?: string; nodeId?: string; host: string; label?: string; ports?: number[]; from?: number; to?: number } }>(
    '/api/netscan/jobs', { preHandler: requireAdmin }, async (req, reply) => {
      const b = req.body || ({} as Record<string, never>);
      const host = (b.host || '').trim();
      if (!['local', 'exec', 'ssh'].includes(b.via) || !/^[a-zA-Z0-9_.:-]+$/.test(host)) {
        return reply.status(400).send({ error: 'via und Host erforderlich' });
      }
      if (b.via === 'exec' && !b.container) return reply.status(400).send({ error: 'Container erforderlich' });
      if (b.via === 'ssh' && !b.nodeId) return reply.status(400).send({ error: 'nodeId erforderlich' });
      const ports = expandPorts(b);
      const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const job: Job = {
        id, label: (b.label || host).slice(0, 80), via: b.via, container: b.container, nodeId: b.nodeId, host,
        ports, status: 'queued', done: 0, total: ports.length, open: [], createdAt: Date.now(),
      };
      jobs.set(id, job);
      void pump();
      reply.status(201).send({ id });
    });

  // Jobs auflisten (Bericht/Status)
  fastify.get('/api/netscan/jobs', { preHandler: requireAdmin }, async (_req, reply) => {
    const list = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map((j) => ({
      id: j.id, label: j.label, via: j.via, host: j.host, status: j.status,
      done: j.done, total: j.total, open: j.open, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt,
    }));
    reply.send({ jobs: list, running: working });
  });

  // Job entfernen/abbrechen
  fastify.delete<{ Params: { id: string } }>('/api/netscan/jobs/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const j = jobs.get(req.params.id);
    if (j && (j.status === 'queued' || j.status === 'running')) j.status = 'canceled';
    jobs.delete(req.params.id);
    reply.send({ ok: true });
  });
}
