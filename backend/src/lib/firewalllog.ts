import crypto from 'crypto';
import { db } from '../db/index';
import { privExec, hasBinary } from './privilege';

export interface ConnLogEntry {
  ts: string;
  action: string;     // BLOCK | ALLOW | AUDIT | LIMIT
  direction: string;  // IN | OUT
  iface: string;
  src: string;
  dst: string;
  proto: string;
  spt: string;
  dpt: string;
  hash?: string;
}

const MAX_ROWS = 50_000; // Protokoll begrenzen, damit die DB nicht unbegrenzt wächst

db.exec(`
  CREATE TABLE IF NOT EXISTS firewall_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT,
    action    TEXT,
    direction TEXT,
    iface     TEXT,
    src       TEXT,
    dst       TEXT,
    proto     TEXT,
    spt       TEXT,
    dpt       TEXT,
    line_hash TEXT UNIQUE,
    seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_fwlog_id ON firewall_log(id DESC);
`);

const q = {
  insert: db.prepare(`INSERT OR IGNORE INTO firewall_log
    (ts, action, direction, iface, src, dst, proto, spt, dpt, line_hash)
    VALUES (@ts, @action, @direction, @iface, @src, @dst, @proto, @spt, @dpt, @hash)`),
  list: db.prepare(`SELECT ts, action, direction, iface, src, dst, proto, spt, dpt
    FROM firewall_log ORDER BY id DESC LIMIT ?`),
  count: db.prepare(`SELECT COUNT(*) AS c FROM firewall_log`),
  countBlocked: db.prepare(`SELECT COUNT(*) AS c FROM firewall_log WHERE action = 'BLOCK'`),
  clear: db.prepare(`DELETE FROM firewall_log`),
  prune: db.prepare(`DELETE FROM firewall_log WHERE id <= (
    SELECT id FROM firewall_log ORDER BY id DESC LIMIT 1 OFFSET ?
  )`),
};

/** Rohzeilen aus dem UFW-Log lesen (dediziertes Log bevorzugt, sonst Kernel-Journal). */
function readRawLogs(): string {
  const tryCmd = (cmd: string): string => {
    try { return privExec(cmd, { timeout: 8000 }).toString(); } catch { return ''; }
  };
  let raw = tryCmd('bash -c "tail -n 4000 /var/log/ufw.log 2>/dev/null"');
  if (!raw.trim()) raw = tryCmd('bash -c "journalctl -k -n 4000 --no-pager 2>/dev/null | grep -i ufw"');
  return raw;
}

/** UFW-Kernel-Logzeilen parsen. */
export function parseUfwLogLines(out: string): ConnLogEntry[] {
  const entries: ConnLogEntry[] = [];
  for (const line of out.split('\n')) {
    const am = line.match(/\[UFW\s+(BLOCK|ALLOW|AUDIT|LIMIT)\]/i);
    if (!am) continue;
    const field = (k: string) => { const m = line.match(new RegExp(`\\b${k}=([^\\s]+)`)); return m ? m[1] : ''; };
    const tsm = line.match(/^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})/) || line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+)/);
    const inIf = field('IN');
    const outIf = field('OUT');
    entries.push({
      ts: tsm ? tsm[1] : '',
      action: am[1].toUpperCase(),
      direction: inIf ? 'IN' : outIf ? 'OUT' : '',
      iface: inIf || outIf,
      src: field('SRC'),
      dst: field('DST'),
      proto: field('PROTO'),
      spt: field('SPT'),
      dpt: field('DPT'),
      hash: crypto.createHash('sha1').update(line.trim()).digest('hex'),
    });
  }
  return entries;
}

/** Neue Logzeilen einlesen und (dedupliziert) in die Protokoll-DB schreiben. Gibt die Anzahl neuer Einträge zurück. */
export function ingestFirewallLog(): number {
  if (!hasBinary('ufw')) return 0;
  const entries = parseUfwLogLines(readRawLogs());
  if (entries.length === 0) return 0;
  let inserted = 0;
  const tx = db.transaction((rows: ConnLogEntry[]) => {
    for (const e of rows) { const r = q.insert.run(e); inserted += r.changes; }
  });
  tx(entries);
  if (inserted > 0) { try { q.prune.run(MAX_ROWS); } catch { /* */ } }
  return inserted;
}

export function queryFirewallLog(limit: number): ConnLogEntry[] {
  return q.list.all(Math.min(50_000, Math.max(1, limit))) as ConnLogEntry[];
}

export function firewallLogStats(): { total: number; blocked: number } {
  return {
    total: (q.count.get() as { c: number }).c,
    blocked: (q.countBlocked.get() as { c: number }).c,
  };
}

export function clearFirewallLog(): void { q.clear.run(); }

/** Periodisches Einlesen, damit das Protokoll auch ohne offenen Tab weiterläuft. */
export function startFirewallLogIngest(): void {
  if (!hasBinary('ufw')) return;
  try { ingestFirewallLog(); } catch { /* */ }
  setInterval(() => { try { ingestFirewallLog(); } catch { /* */ } }, 180_000); // alle 3 Min
}
