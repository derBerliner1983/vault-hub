'use strict';
// Backups-Plugin-Backend (CommonJS). Verzeichnis-Backups als .tar.gz mit
// Zeitplänen (interner Ticker + Cron-Matcher). Persistenter Speicher via
// ctx.dataDir (überlebt Plugin-Updates). Dependency-frei.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Mini-Cron-Matcher (5 Felder: m h dom mon dow) ──
function fieldMatch(field, value) {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    const step = part.split('/');
    const range = step[0];
    const inc = step[1] ? parseInt(step[1]) : 1;
    let lo, hi;
    if (range === '*') { lo = -Infinity; hi = Infinity; }
    else if (range.indexOf('-') >= 0) { const r = range.split('-'); lo = parseInt(r[0]); hi = parseInt(r[1]); }
    else { lo = hi = parseInt(range); }
    if (range === '*') { if (value % inc === 0) return true; }
    else if (value >= lo && value <= hi && (value - lo) % inc === 0) return true;
  }
  return false;
}
function cronMatches(expr, d) {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return false;
  const dow = d.getDay();
  return fieldMatch(p[0], d.getMinutes()) && fieldMatch(p[1], d.getHours()) &&
    fieldMatch(p[2], d.getDate()) && fieldMatch(p[3], d.getMonth() + 1) &&
    (fieldMatch(p[4], dow) || (p[4].indexOf('7') >= 0 && dow === 0));
}
function isValidCron(expr) { return typeof expr === 'string' && expr.trim().split(/\s+/).length === 5; }

module.exports.register = function register(fastify, ctx) {
  const FILES = path.join(ctx.dataDir, 'files');
  const STATE = path.join(ctx.dataDir, 'backups.json');
  const SCHED = path.join(ctx.dataDir, 'schedules.json');
  try { fs.mkdirSync(FILES, { recursive: true }); } catch (_) {}

  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return []; } };
  const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
  const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const ts = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const auth = async (req, reply, admin) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    if (admin && req.user.role !== 'admin') { reply.status(403).send({ error: 'Admin erforderlich' }); return false; }
    return true;
  };

  function createBackup(source, label) {
    if (!source || !source.startsWith('/')) throw new Error('Absoluter Quellpfad erforderlich');
    if (!fs.existsSync(source)) throw new Error('Quellpfad existiert nicht');
    const name = safe(label || path.basename(source) || 'backup');
    const file = `dir-${name}-${ts()}.tar.gz`;
    const out = path.join(FILES, file);
    execSync(`tar czf '${out}' -C '${source}' .`, { timeout: 600000 });
    const size = (() => { try { return fs.statSync(out).size; } catch (_) { return 0; } })();
    const entry = { id: Date.now().toString(36), type: 'directory', name, source, path: out, file, size, created_at: new Date().toISOString() };
    const list = readJson(STATE); list.unshift(entry); writeJson(STATE, list);
    return entry;
  }

  function applyRetention(source, keep) {
    if (!keep || keep < 1) return;
    const list = readJson(STATE);
    const forSource = list.filter((b) => b.source === source).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const remove = forSource.slice(keep);
    for (const b of remove) { try { fs.unlinkSync(b.path); } catch (_) {} }
    if (remove.length) writeJson(STATE, list.filter((b) => !remove.some((r) => r.id === b.id)));
  }

  const P = '/app/backups/api';

  fastify.get(P + '/list', async (req, reply) => { if (!(await auth(req, reply))) return; reply.send({ backups: readJson(STATE) }); });

  fastify.post(P + '/create', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    try { const e = createBackup((req.body && req.body.source) || '', req.body && req.body.label); ctx.audit(req.user.id, 'backup.create', e.source); reply.status(201).send({ ok: true, backup: e }); }
    catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Backup-Fehler' }); }
  });

  fastify.delete(P + '/:id', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const list = readJson(STATE); const b = list.find((x) => x.id === req.params.id);
    if (!b) return reply.status(404).send({ error: 'Nicht gefunden' });
    try { fs.unlinkSync(b.path); } catch (_) {}
    writeJson(STATE, list.filter((x) => x.id !== req.params.id));
    ctx.audit(req.user.id, 'backup.delete', b.file); reply.send({ ok: true });
  });

  fastify.get(P + '/download/:id', async (req, reply) => {
    if (!(await auth(req, reply))) return;
    const b = readJson(STATE).find((x) => x.id === req.params.id);
    if (!b || !fs.existsSync(b.path)) return reply.status(404).send({ error: 'Nicht gefunden' });
    reply.header('Content-Disposition', `attachment; filename="${b.file}"`).header('Content-Type', 'application/gzip').send(fs.createReadStream(b.path));
  });

  fastify.post(P + '/restore/:id', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const b = readJson(STATE).find((x) => x.id === req.params.id);
    if (!b || !fs.existsSync(b.path)) return reply.status(404).send({ error: 'Nicht gefunden' });
    const target = ((req.body && req.body.target) || b.source || '').trim();
    if (!target.startsWith('/')) return reply.status(400).send({ error: 'Absolutes Zielverzeichnis erforderlich' });
    try { fs.mkdirSync(target, { recursive: true }); execSync(`tar xzf '${b.path}' -C '${target}'`, { timeout: 600000 }); ctx.audit(req.user.id, 'backup.restore', target); reply.send({ ok: true }); }
    catch (err) { reply.status(500).send({ error: err instanceof Error ? err.message : 'Restore-Fehler' }); }
  });

  // ── Zeitpläne ──
  fastify.get(P + '/schedules', async (req, reply) => { if (!(await auth(req, reply))) return; reply.send({ schedules: readJson(SCHED) }); });

  fastify.post(P + '/schedules', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const b = req.body || {};
    if (!b.source || !String(b.source).startsWith('/')) return reply.status(400).send({ error: 'Absoluter Quellpfad erforderlich' });
    if (!isValidCron(b.schedule)) return reply.status(400).send({ error: 'Zeitplan muss 5 Felder haben' });
    const list = readJson(SCHED);
    list.push({ id: Date.now().toString(36), source: b.source, label: b.label || '', schedule: b.schedule, retention: parseInt(b.retention) || 7, enabled: true, last_run: null, last_status: null });
    writeJson(SCHED, list);
    reply.status(201).send({ ok: true });
  });

  fastify.post(P + '/schedules/:id/toggle', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    const list = readJson(SCHED); const s = list.find((x) => x.id === req.params.id);
    if (!s) return reply.status(404).send({ error: 'Nicht gefunden' });
    s.enabled = !!(req.body && req.body.enabled); writeJson(SCHED, list); reply.send({ ok: true });
  });

  fastify.delete(P + '/schedules/:id', async (req, reply) => {
    if (!(await auth(req, reply, true))) return;
    writeJson(SCHED, readJson(SCHED).filter((x) => x.id !== req.params.id)); reply.send({ ok: true });
  });

  // ── Ticker: fällige Zeitpläne minütlich ausführen ──
  let lastTickMinute = '';
  setInterval(() => {
    const now = new Date();
    const minuteKey = now.toISOString().slice(0, 16);
    if (minuteKey === lastTickMinute) return;
    lastTickMinute = minuteKey;
    const list = readJson(SCHED); let changed = false;
    for (const s of list) {
      if (!s.enabled || !isValidCron(s.schedule)) continue;
      if (!cronMatches(s.schedule, now)) continue;
      try { createBackup(s.source, s.label); applyRetention(s.source, s.retention); s.last_status = 'ok'; }
      catch (e) { s.last_status = 'error: ' + (e instanceof Error ? e.message : e); }
      s.last_run = now.toISOString(); changed = true;
    }
    if (changed) writeJson(SCHED, list);
  }, 30000);
};
