'use strict';
// Datei-Manager-Plugin-Backend (CommonJS), portiert von Core-Hubs files.ts.
// fs-Operationen mit sudo-Fallback bei EACCES; dependency-frei.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MAX_READ_BYTES = 512 * 1024;
const isEACCES = (e) => e && e.code === 'EACCES';
function sudoRun(args) { execFileSync('sudo', ['-n', ...args], { stdio: 'ignore', timeout: 10000 }); }
function safePath(p) { const r = path.resolve(p || '/'); if (!r) throw new Error('Ungültiger Pfad'); return r; }

function privMkdir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (e) { if (!isEACCES(e)) throw e; sudoRun(['mkdir', '-p', p]); } }
function privWrite(p, content) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content, 'utf8'); }
  catch (e) {
    if (!isEACCES(e)) throw e;
    const tmp = path.join(os.tmpdir(), `vh-${crypto.randomBytes(6).toString('hex')}`);
    try { fs.writeFileSync(tmp, content, 'utf8'); sudoRun(['mkdir', '-p', path.dirname(p)]); sudoRun(['cp', tmp, p]); }
    finally { try { fs.unlinkSync(tmp); } catch (_) {} }
  }
}
function privRm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { if (!isEACCES(e)) throw e; sudoRun(['rm', '-rf', p]); } }
function privRename(from, to) { try { fs.renameSync(from, to); } catch (e) { if (!isEACCES(e)) throw e; sudoRun(['cp', '-a', from, to]); sudoRun(['rm', '-rf', from]); } }
function privChmod(p, mode) { try { fs.chmodSync(p, mode); } catch (e) { if (!isEACCES(e)) throw e; sudoRun(['chmod', mode.toString(8), p]); } }

function statEntry(fp) {
  const stat = fs.statSync(fp);
  let owner = '', group = '';
  try { [owner, group] = execFileSync('stat', ['-c', '%U %G', fp], { encoding: 'utf8', timeout: 3000 }).trim().split(' '); } catch (_) {}
  return {
    name: path.basename(fp), path: fp, isDir: stat.isDirectory(), isSymlink: stat.isSymbolicLink(),
    size: stat.size, permissions: (stat.mode & 0o7777).toString(8).padStart(4, '0'),
    isExecutable: !!(stat.mode & 0o111), owner, group, mtime: stat.mtime.toISOString(),
  };
}

module.exports.register = function register(fastify, ctx) {
  const auth = async (req, reply) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };
  const P = '/app/filemanager/api';

  fastify.get(P + '/list', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    try {
      const dir = safePath(req.query.path || '/');
      if (!fs.statSync(dir).isDirectory()) return reply.status(400).send({ error: 'Kein Verzeichnis' });
      const entries = [];
      for (const name of fs.readdirSync(dir)) { try { entries.push(statEntry(path.join(dir, name))); } catch (_) {} }
      entries.sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name));
      reply.send({ path: dir, entries, parent: dir !== '/' ? path.dirname(dir) : null });
    } catch (e) { reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' }); }
  });

  fastify.get(P + '/read', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    try {
      const p = safePath(req.query.path); const stat = fs.statSync(p);
      if (stat.isDirectory()) return reply.status(400).send({ error: 'Ist ein Verzeichnis' });
      if (stat.size > MAX_READ_BYTES) return reply.status(413).send({ error: `Datei zu groß (max ${MAX_READ_BYTES / 1024} KB)` });
      reply.send({ content: fs.readFileSync(p, 'utf8'), size: stat.size });
    } catch (e) { reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' }); }
  });

  fastify.post(P + '/write', async (req, reply) => { if (!(await auth(req, reply))) return; try { privWrite(safePath(req.body.path), req.body.content || ''); ctx.audit(req.user.id, 'file.write', req.body.path); reply.send({ ok: true }); } catch (e) { reply.status(500).send({ error: e.message }); } });
  fastify.post(P + '/mkdir', async (req, reply) => { if (!(await auth(req, reply))) return; try { privMkdir(safePath(req.body.path)); reply.send({ ok: true }); } catch (e) { reply.status(500).send({ error: e.message }); } });
  fastify.post(P + '/rename', async (req, reply) => { if (!(await auth(req, reply))) return; try { privRename(safePath(req.body.from), safePath(req.body.to)); reply.send({ ok: true }); } catch (e) { reply.status(500).send({ error: e.message }); } });
  fastify.post(P + '/chmod', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    try { const mode = parseInt(req.body.mode, 8); if (isNaN(mode) || mode < 0 || mode > 0o7777) return reply.status(400).send({ error: 'Ungültiger Mode' }); privChmod(safePath(req.body.path), mode); reply.send({ ok: true }); }
    catch (e) { reply.status(500).send({ error: e.message }); }
  });

  fastify.delete(P, async (req, reply) => {
    if (!(await auth(req, reply))) return;
    try { const p = safePath(req.query.path); if (p === '/') return reply.status(400).send({ error: 'Root kann nicht gelöscht werden' }); privRm(p); ctx.audit(req.user.id, 'file.delete', p); reply.send({ ok: true }); }
    catch (e) { reply.status(500).send({ error: e.message }); }
  });

  fastify.get(P + '/download', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    try {
      const p = safePath(req.query.path); const stat = fs.statSync(p);
      if (stat.isDirectory()) return reply.status(400).send({ error: 'Verzeichnisse können nicht heruntergeladen werden' });
      reply.header('Content-Disposition', `attachment; filename="${path.basename(p)}"`).header('Content-Type', 'application/octet-stream').header('Content-Length', stat.size).send(fs.createReadStream(p));
    } catch (e) { reply.status(500).send({ error: e.message }); }
  });

  fastify.post(P + '/upload', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    try {
      const dir = safePath(req.query.path || '/tmp'); privMkdir(dir);
      const saved = [];
      for await (const part of req.files()) {
        const dest = path.join(dir, path.basename(part.filename));
        const tmp = path.join(os.tmpdir(), `vh-up-${crypto.randomBytes(6).toString('hex')}`);
        try {
          await new Promise((resolve, reject) => { const ws = fs.createWriteStream(tmp); part.file.pipe(ws); ws.on('finish', resolve); ws.on('error', reject); });
          privRename(tmp, dest);
        } catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
        saved.push(dest);
      }
      ctx.audit(req.user.id, 'file.upload', dir);
      reply.send({ ok: true, saved });
    } catch (e) { reply.status(500).send({ error: e.message }); }
  });
};
