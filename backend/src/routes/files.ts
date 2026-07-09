import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const MAX_READ_BYTES = 512 * 1024; // 512 KB

function isEACCES(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === 'EACCES';
}

function sudoRun(args: string[]): void {
  execFileSync('sudo', ['-n', ...args], { stdio: 'ignore', timeout: 10_000 });
}

function safePath(p: string): string {
  const resolved = path.resolve(p || '/');
  if (!resolved) throw new Error('Ungültiger Pfad');
  return resolved;
}

// ── Privileged helpers (retry with sudo on EACCES) ─────────────────────────────

function privMkdir(p: string): void {
  try { fs.mkdirSync(p, { recursive: true }); }
  catch (e) {
    if (!isEACCES(e)) throw e;
    sudoRun(['mkdir', '-p', p]);
  }
}

function privWrite(p: string, content: string): void {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  } catch (e) {
    if (!isEACCES(e)) throw e;
    // Write to a temp file then sudo-copy it into place
    const tmp = path.join(os.tmpdir(), `corehub-${crypto.randomBytes(6).toString('hex')}`);
    try {
      fs.writeFileSync(tmp, content, 'utf8');
      sudoRun(['mkdir', '-p', path.dirname(p)]);
      sudoRun(['cp', tmp, p]);
    } finally { try { fs.unlinkSync(tmp); } catch { /* */ } }
  }
}

function privRm(p: string): void {
  try { fs.rmSync(p, { recursive: true, force: true }); }
  catch (e) {
    if (!isEACCES(e)) throw e;
    sudoRun(['rm', '-rf', p]);
  }
}

function privRename(from: string, to: string): void {
  try { fs.renameSync(from, to); }
  catch (e) {
    if (!isEACCES(e)) throw e;
    sudoRun(['cp', '-a', from, to]);
    sudoRun(['rm', '-rf', from]);
  }
}

function privChmod(p: string, mode: number): void {
  try { fs.chmodSync(p, mode); }
  catch (e) {
    if (!isEACCES(e)) throw e;
    sudoRun(['chmod', mode.toString(8), p]);
  }
}

// ── Stat helper ────────────────────────────────────────────────────────────────

function statEntry(filePath: string) {
  const stat = fs.statSync(filePath);
  const mode = stat.mode;
  const perm = (mode & 0o7777).toString(8).padStart(4, '0');
  let owner = '', group = '';
  try {
    const out = execFileSync('stat', ['-c', '%U %G', filePath], { encoding: 'utf8', timeout: 3000 }).trim();
    [owner, group] = out.split(' ');
  } catch { /* ignore */ }
  return {
    name: path.basename(filePath),
    path: filePath,
    isDir: stat.isDirectory(),
    isSymlink: stat.isSymbolicLink(),
    size: stat.size,
    permissions: perm,
    mode,
    isExecutable: !!(mode & 0o111),
    ownerExecutable: !!(mode & 0o100),
    groupExecutable: !!(mode & 0o010),
    otherExecutable: !!(mode & 0o001),
    owner,
    group,
    mtime: stat.mtime.toISOString(),
    ctime: stat.ctime.toISOString(),
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

export async function fileRoutes(fastify: FastifyInstance) {

  // List directory
  fastify.get<{ Querystring: { path?: string } }>('/api/files', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const dir = safePath(req.query.path ?? '/');
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) return reply.status(400).send({ error: 'Kein Verzeichnis' });
      const names = fs.readdirSync(dir);
      const entries = [];
      for (const name of names) {
        try { entries.push(statEntry(path.join(dir, name))); } catch { /* skip unreadable */ }
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      reply.send({ path: dir, entries, parent: dir !== '/' ? path.dirname(dir) : null });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Stat a single path
  fastify.get<{ Querystring: { path: string } }>('/api/files/stat', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      reply.send(statEntry(safePath(req.query.path)));
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Read text file content
  fastify.get<{ Querystring: { path: string } }>('/api/files/read', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const p = safePath(req.query.path);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) return reply.status(400).send({ error: 'Ist ein Verzeichnis' });
      if (stat.size > MAX_READ_BYTES) return reply.status(413).send({ error: `Datei zu groß (max ${MAX_READ_BYTES / 1024} KB)`, errorKey: 'err.file_too_large', errorVars: { kb: MAX_READ_BYTES / 1024 } });
      const content = fs.readFileSync(p, 'utf8');
      reply.send({ content, size: stat.size });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Write text file content
  fastify.post<{ Body: { path: string; content: string } }>('/api/files/write', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      privWrite(safePath(req.body.path), req.body.content ?? '');
      reply.send({ ok: true });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Create directory
  fastify.post<{ Body: { path: string } }>('/api/files/mkdir', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      privMkdir(safePath(req.body.path));
      reply.send({ ok: true });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Delete file or directory (recursive)
  fastify.delete<{ Querystring: { path: string } }>('/api/files', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const p = safePath(req.query.path);
      if (p === '/') return reply.status(400).send({ error: 'Root kann nicht gelöscht werden' });
      privRm(p);
      reply.send({ ok: true });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Rename / move
  fastify.post<{ Body: { from: string; to: string } }>('/api/files/rename', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      privRename(safePath(req.body.from), safePath(req.body.to));
      reply.send({ ok: true });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Change permissions (chmod)
  fastify.post<{ Body: { path: string; mode: string } }>('/api/files/chmod', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const mode = parseInt(req.body.mode, 8);
      if (isNaN(mode) || mode < 0 || mode > 0o7777) return reply.status(400).send({ error: 'Ungültiger Mode' });
      privChmod(safePath(req.body.path), mode);
      reply.send({ ok: true });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Download file
  fastify.get<{ Querystring: { path: string } }>('/api/files/download', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const p = safePath(req.query.path);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) return reply.status(400).send({ error: 'Verzeichnisse können nicht heruntergeladen werden' });
      reply
        .header('Content-Disposition', `attachment; filename="${path.basename(p)}"`)
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', stat.size)
        .send(fs.createReadStream(p));
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Upload file(s) to a directory
  fastify.post<{ Querystring: { path?: string } }>('/api/files/upload', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const dir = safePath(req.query.path ?? '/tmp');
      privMkdir(dir);
      const parts = req.files();
      const saved: string[] = [];
      for await (const part of parts) {
        const dest = path.join(dir, path.basename(part.filename));
        // Stream to temp then move in case dest is root-owned
        const tmp = path.join(os.tmpdir(), `corehub-up-${crypto.randomBytes(6).toString('hex')}`);
        try {
          await new Promise<void>((resolve, reject) => {
            const ws = fs.createWriteStream(tmp);
            part.file.pipe(ws);
            ws.on('finish', resolve);
            ws.on('error', reject);
          });
          privRename(tmp, dest);
        } catch (e) {
          try { fs.unlinkSync(tmp); } catch { /* */ }
          throw e;
        }
        saved.push(dest);
      }
      reply.send({ ok: true, saved });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });
}
