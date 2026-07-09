import type { FastifyInstance } from 'fastify';
import { Client } from 'ssh2';
import { db } from '../db/index';
import { auditQueries } from '../db/index';
import { requireAdmin } from '../middleware/auth';
import { encryptSecret, decryptSecret } from '../lib/secrets';
import { sanitizePorts, scanScript, parseOpenPorts } from '../lib/scan';

// Verschlüsselt hinterlegte SSH-Zugänge zu fremden Objekten (VPS/PC/Server).
// Erlaubt echte Tests „von diesem Gerät aus" – das System verbindet sich per
// SSH und prüft von dort die Erreichbarkeit ins Netz.
db.exec(`
  CREATE TABLE IF NOT EXISTS ssh_targets (
    node_id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    secret_enc TEXT NOT NULL,
    passphrase_enc TEXT,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

interface SshRow {
  node_id: string; host: string; port: number; username: string;
  auth_type: 'password' | 'key'; secret_enc: string; passphrase_enc: string | null; label: string | null;
}

const q = {
  get: db.prepare<[string]>('SELECT * FROM ssh_targets WHERE node_id = ?'),
  list: db.prepare('SELECT node_id, host, port, username, auth_type, label FROM ssh_targets ORDER BY node_id'),
  upsert: db.prepare(`
    INSERT INTO ssh_targets (node_id, host, port, username, auth_type, secret_enc, passphrase_enc, label)
    VALUES (@node_id, @host, @port, @username, @auth_type, @secret_enc, @passphrase_enc, @label)
    ON CONFLICT(node_id) DO UPDATE SET host=@host, port=@port, username=@username,
      auth_type=@auth_type, secret_enc=@secret_enc, passphrase_enc=@passphrase_enc, label=@label
  `),
  del: db.prepare<[string]>('DELETE FROM ssh_targets WHERE node_id = ?'),
};

function connectConfig(row: SshRow) {
  const base = { host: row.host, port: row.port || 22, username: row.username, readyTimeout: 8000 };
  if (row.auth_type === 'key') {
    return { ...base, privateKey: decryptSecret(row.secret_enc), passphrase: row.passphrase_enc ? decryptSecret(row.passphrase_enc) : undefined };
  }
  return { ...base, password: decryptSecret(row.secret_enc) };
}

// Baut eine SSH-Verbindung auf und führt optional ein Kommando aus.
function sshRun(row: SshRow, cmd?: string): Promise<{ ok: boolean; out: string; ms: number; error?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const conn = new Client();
    let done = false;
    const fin = (r: { ok: boolean; out: string; error?: string }) => {
      if (done) return; done = true;
      try { conn.end(); } catch { /* */ }
      resolve({ ...r, ms: Date.now() - start });
    };
    conn.on('ready', () => {
      if (!cmd) return fin({ ok: true, out: '' });
      conn.exec(cmd, (err, stream) => {
        if (err) return fin({ ok: false, out: '', error: err.message });
        let out = '';
        stream.on('data', (d: Buffer) => { out += d.toString(); });
        stream.stderr.on('data', () => { /* ignorieren */ });
        stream.on('close', () => fin({ ok: true, out }));
      });
    });
    conn.on('error', (e) => fin({ ok: false, out: '', error: e.message }));
    try { conn.connect(connectConfig(row)); } catch (e) { fin({ ok: false, out: '', error: e instanceof Error ? e.message : 'Verbindungsfehler' }); }
  });
}

// TCP-Test-Skript, das im Ziel-Shell nacheinander nc / bash-/dev/tcp / python3 probiert.
function probeScript(host: string, port: number) {
  return `h='${host}'; p='${port}';` +
    `if command -v nc >/dev/null 2>&1; then nc -w 3 -z "$h" "$p" >/dev/null 2>&1 && echo CH_OPEN || echo CH_CLOSED;` +
    `elif command -v bash >/dev/null 2>&1; then timeout 3 bash -c "exec 3<>/dev/tcp/$h/$p" >/dev/null 2>&1 && echo CH_OPEN || echo CH_CLOSED;` +
    `elif command -v python3 >/dev/null 2>&1; then python3 -c "import socket,sys; s=socket.socket(); s.settimeout(3); sys.exit(0 if s.connect_ex(('$h',int('$p')))==0 else 1)" && echo CH_OPEN || echo CH_CLOSED;` +
    `else echo CH_NOTOOL; fi`;
}

export async function sshRoutes(fastify: FastifyInstance) {
  // Zugänge auflisten (ohne Secrets)
  fastify.get('/api/ssh/targets', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.send({ targets: q.list.all() });
  });

  // Zugang speichern/aktualisieren
  fastify.post<{ Body: { nodeId: string; host: string; port?: number; username: string; authType: 'password' | 'key'; password?: string; privateKey?: string; passphrase?: string; label?: string } }>(
    '/api/ssh/targets', { preHandler: requireAdmin }, async (req, reply) => {
      const b = req.body || ({} as Record<string, never>);
      const nodeId = (b.nodeId || '').trim();
      const host = (b.host || '').trim();
      const username = (b.username || '').trim();
      if (!nodeId || !host || !username || (b.authType !== 'password' && b.authType !== 'key')) {
        return reply.status(400).send({ error: 'nodeId, Host, Benutzer und Auth-Typ erforderlich' });
      }
      const secret = b.authType === 'key' ? (b.privateKey || '') : (b.password || '');
      const existing = q.get.get(nodeId) as SshRow | undefined;
      // Kein neues Secret übergeben → vorhandenes behalten (Bearbeiten ohne Passwort-Neueingabe)
      const secret_enc = secret ? encryptSecret(secret) : existing?.secret_enc;
      if (!secret_enc) return reply.status(400).send({ error: 'Passwort bzw. privater Schlüssel erforderlich' });
      const passphrase_enc = b.passphrase ? encryptSecret(b.passphrase) : (secret ? null : existing?.passphrase_enc ?? null);
      q.upsert.run({ node_id: nodeId, host, port: Number(b.port) || 22, username, auth_type: b.authType, secret_enc, passphrase_enc, label: b.label || null });
      auditQueries.log.run(req.user.id, 'ssh.save', `${username}@${host}`);
      reply.send({ ok: true });
    });

  fastify.delete<{ Params: { nodeId: string } }>('/api/ssh/targets/:nodeId', { preHandler: requireAdmin }, async (req, reply) => {
    q.del.run(req.params.nodeId);
    auditQueries.log.run(req.user.id, 'ssh.delete', req.params.nodeId);
    reply.send({ ok: true });
  });

  // Reiner Verbindungstest (Login prüfen)
  fastify.post<{ Body: { nodeId: string } }>('/api/ssh/test', { preHandler: requireAdmin }, async (req, reply) => {
    const row = q.get.get((req.body?.nodeId || '').trim()) as SshRow | undefined;
    if (!row) return reply.status(404).send({ error: 'Kein Zugang hinterlegt' });
    const r = await sshRun(row);
    reply.send({ ok: r.ok, ms: r.ms, error: r.error });
  });

  // Echter Erreichbarkeits-Test AUS dem entfernten Gerät heraus (SSH → TCP zu host:port)
  fastify.post<{ Body: { nodeId: string; host: string; port: number } }>('/api/ssh/probe', { preHandler: requireAdmin }, async (req, reply) => {
    const row = q.get.get((req.body?.nodeId || '').trim()) as SshRow | undefined;
    if (!row) return reply.status(404).send({ error: 'Kein Zugang hinterlegt' });
    const host = (req.body?.host || '').trim();
    const port = Number(req.body?.port);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(host) || !port || port < 1 || port > 65535) {
      return reply.status(400).send({ error: 'Host und Port erforderlich' });
    }
    const r = await sshRun(row, probeScript(host, port));
    if (!r.ok) return reply.send({ open: false, ms: r.ms, error: r.error || 'ssh-fehler' });
    if (r.out.includes('CH_OPEN')) return reply.send({ open: true, ms: r.ms });
    if (r.out.includes('CH_NOTOOL')) return reply.send({ open: false, ms: r.ms, error: 'no-tool' });
    return reply.send({ open: false, ms: r.ms, error: 'closed' });
  });

  // Port-Scan AUS dem entfernten Gerät heraus: welche Ports von host sind offen?
  fastify.post<{ Body: { nodeId: string; host: string; ports?: number[] } }>('/api/ssh/scan', { preHandler: requireAdmin }, async (req, reply) => {
    const row = q.get.get((req.body?.nodeId || '').trim()) as SshRow | undefined;
    if (!row) return reply.status(404).send({ error: 'Kein Zugang hinterlegt' });
    const host = (req.body?.host || '').trim();
    if (!/^[a-zA-Z0-9_.:-]+$/.test(host)) return reply.status(400).send({ error: 'Host erforderlich' });
    const r = await sshRun(row, scanScript(host, sanitizePorts(req.body?.ports)));
    if (!r.ok) return reply.status(200).send({ open: [], ms: r.ms, error: r.error || 'ssh-fehler' });
    reply.send({ open: parseOpenPorts(r.out), ms: r.ms });
  });
}
