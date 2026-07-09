import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import type { DbUser } from '../types';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'vault-hub.db');

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Kern-Schema (Auth, Audit, Sessions, Präferenzen, App-Einstellungen) ───────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    target TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS device_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_token TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_device_sessions_token ON device_sessions(device_token);
  CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON device_sessions(user_id);

  -- Pro-Benutzer UI-Einstellungen (z. B. Theme/Layout) als JSON-Blob
  CREATE TABLE IF NOT EXISTS user_prefs (
    user_id    INTEGER PRIMARY KEY,
    prefs      TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Globale System-Einstellungen als Key/Value
  CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Migrationen: 2FA-Spalten an users anhängen ────────────────────────────────
function columnExists(table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
}
if (!columnExists('users', 'totp_secret')) db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
if (!columnExists('users', 'totp_enabled')) db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
if (!columnExists('users', 'totp_required')) db.exec("ALTER TABLE users ADD COLUMN totp_required INTEGER NOT NULL DEFAULT 0");

// ── Standard-Admin (admin/admin) beim ersten Start anlegen ────────────────────
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
  console.log('✓ Default admin user created: admin / admin');
  console.log('  → Please change the password after first login!');
}

export const userQueries = {
  getByUsername: db.prepare<[string], DbUser>('SELECT * FROM users WHERE username = ?'),
  getById: db.prepare<[number], DbUser>('SELECT * FROM users WHERE id = ?'),
  getAll: db.prepare<[], Omit<DbUser, 'password_hash'>>('SELECT id, username, role, totp_enabled, totp_required, created_at FROM users'),
  create: db.prepare<[string, string, string]>('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'),
  delete: db.prepare<[number]>('DELETE FROM users WHERE id = ?'),
  changePassword: db.prepare<[string, number]>('UPDATE users SET password_hash = ? WHERE id = ?'),
  setTotpSecret: db.prepare<[string | null, number]>('UPDATE users SET totp_secret = ? WHERE id = ?'),
  setTotpEnabled: db.prepare<[number, number]>('UPDATE users SET totp_enabled = ? WHERE id = ?'),
  setTotpRequired: db.prepare<[number, number]>('UPDATE users SET totp_required = ? WHERE id = ?'),
};

export const appSettingsQueries = {
  get: db.prepare<[string], { value: string }>('SELECT value FROM app_settings WHERE key = ?'),
  set: db.prepare<[string, string]>(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ),
};

export const prefsQueries = {
  get: db.prepare<[number], { prefs: string }>('SELECT prefs FROM user_prefs WHERE user_id = ?'),
  set: db.prepare<[number, string]>(
    `INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = datetime('now')`
  ),
};

export interface DeviceSessionRow {
  id: number;
  user_id: number;
  device_token: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen: string;
  revoked: number;
}

export const deviceSessionQueries = {
  create: db.prepare<[number, string, string | null, string | null]>(
    'INSERT INTO device_sessions (user_id, device_token, user_agent, ip) VALUES (?, ?, ?, ?)'
  ),
  getByToken: db.prepare<[string], DeviceSessionRow>(
    'SELECT * FROM device_sessions WHERE device_token = ? AND revoked = 0'
  ),
  touchLastSeen: db.prepare<[number]>(
    "UPDATE device_sessions SET last_seen = datetime('now') WHERE id = ?"
  ),
  getByUser: db.prepare<[number], DeviceSessionRow>(
    'SELECT * FROM device_sessions WHERE user_id = ? ORDER BY last_seen DESC'
  ),
  getAll: db.prepare<[], DeviceSessionRow & { username: string }>(
    `SELECT ds.*, u.username FROM device_sessions ds
     JOIN users u ON u.id = ds.user_id
     ORDER BY ds.last_seen DESC`
  ),
  revoke: db.prepare<[number]>('UPDATE device_sessions SET revoked = 1 WHERE id = ?'),
  revokeByUser: db.prepare<[number]>('UPDATE device_sessions SET revoked = 1 WHERE user_id = ?'),
  pruneOld: db.prepare("DELETE FROM device_sessions WHERE last_seen < datetime('now', '-90 days')"),
};

export const auditQueries = {
  log: db.prepare<[number | null, string, string | null]>(
    'INSERT INTO audit_log (user_id, action, target) VALUES (?, ?, ?)'
  ),
  recent: db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50'),
  pruneOld: db.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days')"),
};
