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

// Migrate legacy database name (docker-gui.db → vault-hub.db) if present
const legacyDb = path.join(DATA_DIR, 'docker-gui.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(legacyDb)) {
  try {
    fs.renameSync(legacyDb, DB_PATH);
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(legacyDb + ext)) fs.renameSync(legacyDb + ext, DB_PATH + ext);
    }
  } catch { /* fall through – fresh DB will be created */ }
}

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

  CREATE TABLE IF NOT EXISTS container_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT,
    path TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS proxy_hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL UNIQUE,
    target_host TEXT NOT NULL DEFAULT 'localhost',
    target_port INTEGER NOT NULL,
    https INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS backup_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    label TEXT NOT NULL,
    schedule TEXT NOT NULL,
    retention INTEGER NOT NULL DEFAULT 7,
    stop_container INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    last_status TEXT,
    last_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT,
    event TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notification_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    webhook_url TEXT,
    email_to TEXT,
    on_backup INTEGER NOT NULL DEFAULT 1,
    on_security INTEGER NOT NULL DEFAULT 1,
    on_container INTEGER NOT NULL DEFAULT 1,
    on_antivirus INTEGER NOT NULL DEFAULT 1
  );
  INSERT OR IGNORE INTO notification_config (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,            -- 'predefined' | 'metric'
    rule_key TEXT,                 -- predefined: ssh_root_login | failed_logins | risky_ports | low_score | priv_container
    metric TEXT,                   -- metric: cpu | ram | disk
    threshold REAL,                -- metric: percentage; low_score: score
    duration_min INTEGER NOT NULL DEFAULT 0,
    recipients TEXT,               -- comma-separated emails; empty → global email_to
    enabled INTEGER NOT NULL DEFAULT 1,
    last_triggered TEXT,
    breach_since TEXT,             -- when the condition first became true (for duration tracking)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Schema migrations (add columns to existing tables) ──
function columnExists(table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
}
if (!columnExists('users', 'totp_secret')) db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
if (!columnExists('users', 'totp_enabled')) db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
if (!columnExists('users', 'totp_required')) db.exec("ALTER TABLE users ADD COLUMN totp_required INTEGER NOT NULL DEFAULT 0");

// Device sessions for trusted-device 2FA memory
db.exec(`
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

  -- Pro-Benutzer UI-Einstellungen (Sortierung von Sidebar/Panels u.a.) als JSON-Blob
  CREATE TABLE IF NOT EXISTS user_prefs (
    user_id    INTEGER PRIMARY KEY,
    prefs      TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Globale System-Einstellungen als Key/Value (z.B. ipv6_enabled)
  CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// SMTP-Konfiguration für echten E-Mail-Versand (an notification_config angehängt)
if (!columnExists('notification_config', 'smtp_host')) db.exec('ALTER TABLE notification_config ADD COLUMN smtp_host TEXT');
if (!columnExists('notification_config', 'smtp_port')) db.exec('ALTER TABLE notification_config ADD COLUMN smtp_port INTEGER');
if (!columnExists('notification_config', 'smtp_user')) db.exec('ALTER TABLE notification_config ADD COLUMN smtp_user TEXT');
if (!columnExists('notification_config', 'smtp_pass')) db.exec('ALTER TABLE notification_config ADD COLUMN smtp_pass TEXT');
if (!columnExists('notification_config', 'smtp_from')) db.exec('ALTER TABLE notification_config ADD COLUMN smtp_from TEXT');
if (!columnExists('notification_config', 'smtp_secure')) db.exec("ALTER TABLE notification_config ADD COLUMN smtp_secure INTEGER NOT NULL DEFAULT 0");

// App-Icon je Container (aus dem Store übernommen) – an container_categories angehängt
if (!columnExists('container_categories', 'icon')) db.exec('ALTER TABLE container_categories ADD COLUMN icon TEXT');

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

export const categoryQueries = {
  set: db.prepare<[string, string]>(
    'INSERT INTO container_categories (container_id, category) VALUES (?, ?) ON CONFLICT(container_id) DO UPDATE SET category = excluded.category'
  ),
  // Icon setzen, ohne die Kategorie zu überschreiben (category als leerer Default)
  setIcon: db.prepare<[string, string]>(
    "INSERT INTO container_categories (container_id, category, icon) VALUES (?, '', ?) ON CONFLICT(container_id) DO UPDATE SET icon = excluded.icon"
  ),
  getAll: db.prepare<[], { container_id: string; category: string; icon: string | null }>('SELECT container_id, category, icon FROM container_categories'),
  get: db.prepare<[string], { container_id: string; category: string; icon: string | null }>('SELECT container_id, category, icon FROM container_categories WHERE container_id = ?'),
  delete: db.prepare<[string]>('DELETE FROM container_categories WHERE container_id = ?'),
};

export interface BackupRow {
  id: number;
  type: string;
  name: string;
  source: string | null;
  path: string;
  size: number;
  status: string;
  created_at: string;
}

export const backupQueries = {
  create: db.prepare<[string, string, string | null, string, number, string]>(
    'INSERT INTO backups (type, name, source, path, size, status) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getAll: db.prepare<[], BackupRow>('SELECT * FROM backups ORDER BY created_at DESC'),
  getById: db.prepare<[number], BackupRow>('SELECT * FROM backups WHERE id = ?'),
  delete: db.prepare<[number]>('DELETE FROM backups WHERE id = ?'),
};

export interface ProxyRow {
  id: number;
  container_id: string | null;
  name: string;
  hostname: string;
  target_host: string;
  target_port: number;
  https: number;
  enabled: number;
  created_at: string;
}

export const proxyQueries = {
  getAll: db.prepare<[], ProxyRow>('SELECT * FROM proxy_hosts ORDER BY name'),
  getById: db.prepare<[number], ProxyRow>('SELECT * FROM proxy_hosts WHERE id = ?'),
  upsert: db.prepare<[string | null, string, string, string, number, number, number]>(
    `INSERT INTO proxy_hosts (container_id, name, hostname, target_host, target_port, https, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hostname) DO UPDATE SET
       container_id = excluded.container_id, name = excluded.name,
       target_host = excluded.target_host, target_port = excluded.target_port,
       https = excluded.https, enabled = excluded.enabled`
  ),
  setHttps: db.prepare<[number, number]>('UPDATE proxy_hosts SET https = ? WHERE id = ?'),
  setEnabled: db.prepare<[number, number]>('UPDATE proxy_hosts SET enabled = ? WHERE id = ?'),
  update: db.prepare<[string, string, string, number, number, number]>(
    'UPDATE proxy_hosts SET name = ?, hostname = ?, target_host = ?, target_port = ?, https = ? WHERE id = ?'
  ),
  setHttpsAll: db.prepare<[number]>('UPDATE proxy_hosts SET https = ?'),
  delete: db.prepare<[number]>('DELETE FROM proxy_hosts WHERE id = ?'),
};

export interface ScheduleRow {
  id: number;
  type: string;
  source: string;
  label: string;
  schedule: string;
  retention: number;
  stop_container: number;
  enabled: number;
  last_run: string | null;
  last_status: string | null;
  last_message: string | null;
  created_at: string;
}

export const scheduleQueries = {
  getAll: db.prepare<[], ScheduleRow>('SELECT * FROM backup_schedules ORDER BY created_at DESC'),
  getEnabled: db.prepare<[], ScheduleRow>('SELECT * FROM backup_schedules WHERE enabled = 1'),
  getById: db.prepare<[number], ScheduleRow>('SELECT * FROM backup_schedules WHERE id = ?'),
  create: db.prepare<[string, string, string, string, number, number]>(
    'INSERT INTO backup_schedules (type, source, label, schedule, retention, stop_container) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  setEnabled: db.prepare<[number, number]>('UPDATE backup_schedules SET enabled = ? WHERE id = ?'),
  setRun: db.prepare<[string, string, string | null, number]>(
    'UPDATE backup_schedules SET last_run = ?, last_status = ?, last_message = ? WHERE id = ?'
  ),
  delete: db.prepare<[number]>('DELETE FROM backup_schedules WHERE id = ?'),
};

export interface NotificationRow {
  id: number;
  level: string;
  title: string;
  message: string | null;
  event: string | null;
  read: number;
  created_at: string;
}

export const notificationQueries = {
  recent: db.prepare<[], NotificationRow>('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100'),
  unreadCount: db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE read = 0'),
  create: db.prepare<[string, string, string | null, string | null]>(
    'INSERT INTO notifications (level, title, message, event) VALUES (?, ?, ?, ?)'
  ),
  markAllRead: db.prepare('UPDATE notifications SET read = 1 WHERE read = 0'),
  clear: db.prepare('DELETE FROM notifications'),
  prune: db.prepare("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 500)"),
};

export interface NotifyConfigRow {
  id: number;
  webhook_url: string | null;
  email_to: string | null;
  on_backup: number;
  on_security: number;
  on_container: number;
  on_antivirus: number;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  smtp_secure: number;
}

export const notifyConfigQueries = {
  get: db.prepare<[], NotifyConfigRow>('SELECT * FROM notification_config WHERE id = 1'),
  update: db.prepare<[string | null, string | null, number, number, number, number]>(
    `UPDATE notification_config SET webhook_url = ?, email_to = ?, on_backup = ?, on_security = ?, on_container = ?, on_antivirus = ? WHERE id = 1`
  ),
  updateSmtp: db.prepare<[string | null, number | null, string | null, string | null, string | null, number]>(
    `UPDATE notification_config SET smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?, smtp_from = ?, smtp_secure = ? WHERE id = 1`
  ),
};

export interface AlertRuleRow {
  id: number;
  name: string;
  kind: string;          // 'predefined' | 'metric'
  rule_key: string | null;
  metric: string | null;
  threshold: number | null;
  duration_min: number;
  recipients: string | null;
  enabled: number;
  last_triggered: string | null;
  breach_since: string | null;
  created_at: string;
}

export const alertQueries = {
  getAll: db.prepare<[], AlertRuleRow>('SELECT * FROM alert_rules ORDER BY created_at DESC'),
  getEnabled: db.prepare<[], AlertRuleRow>('SELECT * FROM alert_rules WHERE enabled = 1'),
  getById: db.prepare<[number], AlertRuleRow>('SELECT * FROM alert_rules WHERE id = ?'),
  create: db.prepare<[string, string, string | null, string | null, number | null, number, string | null]>(
    `INSERT INTO alert_rules (name, kind, rule_key, metric, threshold, duration_min, recipients)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  setEnabled: db.prepare<[number, number]>('UPDATE alert_rules SET enabled = ? WHERE id = ?'),
  setTriggered: db.prepare<[string | null, number]>('UPDATE alert_rules SET last_triggered = ? WHERE id = ?'),
  setBreachSince: db.prepare<[string | null, number]>('UPDATE alert_rules SET breach_since = ? WHERE id = ?'),
  delete: db.prepare<[number]>('DELETE FROM alert_rules WHERE id = ?'),
};
