import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries, db } from '../db/index';
import { ingestFirewallLog, queryFirewallLog, firewallLogStats, clearFirewallLog } from '../lib/firewalllog';

interface FirewallRule {
  num: number;
  raw: string;
  to: string;
  action: string;
  direction: string; // IN | OUT | ''
  from: string;
  comment: string;
}

// ── Ignorierte Ports: vom Assistenten ausgeblendet (absichtlich blockiert, nicht mehr fragen) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS firewall_ignored_ports (
    port       TEXT PRIMARY KEY,
    ignored_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
const ipq = {
  list:   db.prepare(`SELECT port FROM firewall_ignored_ports`),
  insert: db.prepare(`INSERT OR IGNORE INTO firewall_ignored_ports (port) VALUES (?)`),
  del:    db.prepare(`DELETE FROM firewall_ignored_ports WHERE port = ?`),
};

// ── Deaktivierte Regeln (Parkbucht): aus ufw entfernt, aber gemerkt zum Reaktivieren ──
db.exec(`
  CREATE TABLE IF NOT EXISTS firewall_disabled (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL DEFAULT 'allow',
    direction  TEXT NOT NULL DEFAULT '',
    port       TEXT NOT NULL DEFAULT '',
    proto      TEXT NOT NULL DEFAULT '',
    from_addr  TEXT NOT NULL DEFAULT '',
    profile    TEXT NOT NULL DEFAULT '',
    comment    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
try { db.exec(`ALTER TABLE firewall_disabled ADD COLUMN profile TEXT NOT NULL DEFAULT ''`); } catch { /* Spalte existiert */ }
interface DisabledRow { id: number; action: string; direction: string; port: string; proto: string; from_addr: string; profile: string; comment: string }
const dq = {
  list:   db.prepare(`SELECT * FROM firewall_disabled ORDER BY id`),
  get:    db.prepare(`SELECT * FROM firewall_disabled WHERE id = ?`),
  insert: db.prepare(`INSERT INTO firewall_disabled (action,direction,port,proto,from_addr,profile,comment) VALUES (?,?,?,?,?,?,?)`),
  del:    db.prepare(`DELETE FROM firewall_disabled WHERE id = ?`),
};

/** Benannte ufw-Profile (z.B. "OpenSSH") shell-sicher säubern. */
function cleanProfile(p?: string): string {
  return (p ?? '').replace(/\s*\(v6\)\s*$/i, '').replace(/[^\w \-()]/g, '').trim().slice(0, 40);
}

/** Redundante Richtungs-Suffixe `(in)`/`(out)` entfernen – die Richtung steht in einer eigenen Spalte. */
function stripDirSuffix(s: string): string {
  return s.replace(/\s*\((?:in|out)\)/gi, '').replace(/\s+/g, ' ').trim();
}

/** Parse `ufw status numbered` output (inkl. Kommentar/Name). */
function parseUfw(out: string): FirewallRule[] {
  const rules: FirewallRule[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT))?\s+(.+?)(?:\s+#\s*(.*))?$/i);
    if (m) {
      rules.push({
        num: parseInt(m[1]),
        to: stripDirSuffix(m[2].trim()),
        action: m[3].toUpperCase(),
        direction: (m[4] ?? '').toUpperCase(),
        from: stripDirSuffix(m[5].trim()),
        comment: (m[6] ?? '').trim(),
        raw: line.trim(),
      });
    }
  }
  return rules;
}

/** Kommentar/Name säubern (Shell-sicher) und auf Länge begrenzen. */
function cleanComment(c?: string): string {
  return (c ?? '').replace(/[^\w \-.,:/äöüÄÖÜß()]/g, '').trim().slice(0, 60);
}

/** Build a `ufw <action> …` command from sanitised parts. Returns null if neither port nor source given. */
function buildRuleCmd(
  action: string,
  parts: { p: string; pr: string; fromIp: string; dir: string; comment?: string },
): string | null {
  const { p, pr, fromIp, dir } = parts;
  const c = parts.comment ? ` comment '${cleanComment(parts.comment)}'` : '';
  const proto = pr ? ` proto ${pr}` : '';
  let base: string | null = null;
  if (dir === 'out') {
    // Ausgehend: die angegebene Adresse ist das Ziel (wohin der Verkehr geht)
    if (fromIp) base = `ufw ${action} out to ${fromIp}${p ? ` port ${p}` : ''}${proto}`;
    else if (p) base = `ufw ${action} out to any port ${p}${proto}`;
  } else if (dir === 'in') {
    // Eingehend: die angegebene Adresse ist die Quelle (woher der Verkehr kommt)
    if (fromIp) base = `ufw ${action} in from ${fromIp}${p ? ` to any port ${p}` : ''}${proto}`;
    else if (p) base = `ufw ${action} in to any port ${p}${proto}`;
  } else {
    // Ohne Richtung → einfache Syntax (Standard = eingehend)
    if (fromIp) base = `ufw ${action} from ${fromIp}${p ? ` to any port ${p}` : ''}${proto}`;
    else if (p) base = `ufw ${action} ${p}${pr ? `/${pr}` : ''}`;
  }
  return base ? base + c : null;
}

function sanitiseParts(body: { port?: string; proto?: string; from?: string; direction?: string; comment?: string }) {
  return {
    p: (body.port ?? '').replace(/[^0-9:]/g, ''),
    pr: body.proto === 'udp' ? 'udp' : body.proto === 'tcp' ? 'tcp' : '',
    fromIp: (body.from ?? '').replace(/[^0-9a-fA-F:./]/g, ''),
    dir: body.direction === 'out' ? 'out' : body.direction === 'in' ? 'in' : '',
    comment: cleanComment(body.comment),
  };
}

/** Mehrere Quell-Adressen aus einem Feld trennen (Komma/Leerzeichen/Zeilenumbruch). */
function splitAddrs(from?: string): string[] {
  return (from ?? '').split(/[\s,;]+/).map((a) => a.replace(/[^0-9a-fA-F:./]/g, '')).filter(Boolean);
}

/** Logging-Status aus `ufw status verbose` lesen (on/off). */
function readLoggingState(): boolean {
  const v = safeExec('ufw status verbose 2>/dev/null') || privExecSafe('ufw status verbose');
  return /Logging:\s*on/i.test(v);
}

/** Logging-Stufe lesen: off | low | medium | high | full. */
function readLoggingLevel(): string {
  const v = safeExec('ufw status verbose 2>/dev/null') || privExecSafe('ufw status verbose');
  const m = v.match(/Logging:\s*on\s*\(([a-z]+)\)/i);
  if (m) return m[1].toLowerCase();
  return /Logging:\s*on/i.test(v) ? 'low' : 'off';
}

const LOG_LEVELS = ['off', 'low', 'medium', 'high', 'full'];

function privExecSafe(cmd: string): string {
  try { return privExec(cmd, { timeout: 6000 }); } catch { return ''; }
}

/** Netzadresse (z.B. 192.168.1.0) aus IP + Präfixlänge berechnen. */
function networkAddress(ip: string, prefix: number): string | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
  const ipInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (ipInt & mask) >>> 0;
  return [(net >>> 24) & 255, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join('.');
}

/** Echte private LAN-Subnetze des Hosts (RFC-1918), z.B. ["192.168.1.0/24"]. */
function hostLanSubnets(): string[] {
  const out = safeExec('ip -o -f inet addr show 2>/dev/null') || privExecSafe('ip -o -f inet addr show');
  const subnets = new Set<string>();
  for (const line of out.split('\n')) {
    const m = line.match(/\binet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/);
    if (!m) continue;
    const ip = m[1];
    const prefix = parseInt(m[2], 10);
    // nur private Bereiche, kein loopback/link-local
    if (!/^10\./.test(ip) && !/^192\.168\./.test(ip) && !/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) continue;
    const net = networkAddress(ip, prefix);
    if (net) subnets.add(`${net}/${prefix}`);
  }
  return [...subnets];
}

// ── Plausibilitäts-Assistent: Regeln gegen bekannte Risiken + offene Ports prüfen ──

/** Bekannte Ports mit Risiko-Einstufung (Teilmenge der Security-PORT_DB, hier lokal gehalten). */
const PORT_RISK: Record<string, { name: string; lanOnly: boolean; note: string }> = {
  '139':   { name: 'NetBIOS/Samba', lanOnly: true,  note: 'NIE ins Internet – Exploit-Risiko (EternalBlue/WannaCry).' },
  '445':   { name: 'SMB/Samba',     lanOnly: true,  note: 'NIE ins Internet – Exploit-Risiko (EternalBlue/WannaCry).' },
  '3306':  { name: 'MySQL/MariaDB', lanOnly: true,  note: 'Datenbank niemals direkt ins Internet.' },
  '5432':  { name: 'PostgreSQL',    lanOnly: true,  note: 'Datenbank niemals direkt ins Internet.' },
  '6379':  { name: 'Redis',         lanOnly: true,  note: 'Redis hat standardmäßig keine Auth – nur LAN.' },
  '27017': { name: 'MongoDB',       lanOnly: true,  note: 'Datenbank nur intern.' },
  '5900':  { name: 'VNC',           lanOnly: true,  note: 'VNC oft unverschlüsselt – niemals ins Internet.' },
  '3389':  { name: 'RDP',           lanOnly: true,  note: 'RDP-Brute-Force-Risiko – niemals direkt ins Internet.' },
  '2049':  { name: 'NFS',           lanOnly: true,  note: 'NFS-Freigaben nur im LAN.' },
  '111':   { name: 'RPC',           lanOnly: true,  note: 'RPC/NFS nur im LAN.' },
  '11434': { name: 'Ollama AI',     lanOnly: true,  note: 'Ollama-API ohne Auth – nur LAN oder via VPN.' },
};

/** Quell-Adresse einer Regel einordnen. */
function classifyFrom(from: string): 'any' | 'lan' | 'specific' {
  const f = from.trim().toLowerCase();
  if (!f || /anywhere/.test(f) || f === '0.0.0.0/0' || f === '::/0') return 'any';
  if (/^10\./.test(f) || /^192\.168\./.test(f) || /^172\.(1[6-9]|2\d|3[01])\./.test(f) ||
      /^169\.254\./.test(f) || /^f[cd]/.test(f) || /^fe80/.test(f)) return 'lan';
  return 'specific';
}

/** Aus dem "to"-Feld einer Regel die Portnummer ziehen (oder null bei Profil-Namen). */
function rulePort(to: string): { port: string; proto: string } | null {
  const m = to.trim().match(/^(\d+)(?::\d+)?(?:\/(tcp|udp))?$/i);
  if (!m) return null;
  return { port: m[1], proto: (m[2] ?? '').toLowerCase() };
}

interface ListenInfo { scope: 'public' | 'local'; proc: string; protos: Set<string> }

/** Lauschende Ports inkl. Prozessname und Protokoll(en). scope='public' = 0.0.0.0/extern, 'local' = nur 127.0.0.1. */
function listeningPorts(): Map<string, ListenInfo> {
  // -p liefert Prozessnamen (braucht root → privExec als Fallback)
  const out = privExecSafe('ss -tulnpH') || safeExec('ss -tulnpH 2>/dev/null') || safeExec('ss -tulnH 2>/dev/null');
  const map = new Map<string, ListenInfo>();
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const proto = cols[0]; // tcp / udp
    const local = cols[4];
    const portM = local.match(/:(\d+)$/);
    if (!portM) continue;
    const port = portM[1];
    const addr = local.slice(0, local.lastIndexOf(':'));
    const isLocal = addr.startsWith('127.') || addr === '[::1]' || addr.includes('127.0.0.53');
    const procM = line.match(/users:\(\("([^"]+)"/) || line.match(/"([^"]+)"/);
    const proc = procM ? procM[1] : '';
    const existing = map.get(port);
    if (existing) {
      if (!isLocal) existing.scope = 'public';
      existing.protos.add(proto);
      if (!existing.proc && proc) existing.proc = proc;
    } else {
      map.set(port, { scope: isLocal ? 'local' : 'public', proc, protos: new Set([proto]) });
    }
  }
  return map;
}

/** Anzahl bestehender (established) Verbindungen je lokalem Port – Hinweis darauf, dass ein Port aktiv genutzt wird. */
function establishedConns(): Map<string, number> {
  const out = safeExec('ss -tunH state established 2>/dev/null') || privExecSafe('ss -tunH state established');
  const map = new Map<string, number>();
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const local = cols[3];
    const m = local.match(/:(\d+)$/);
    if (!m) continue;
    map.set(m[1], (map.get(m[1]) ?? 0) + 1);
  }
  return map;
}

/** Standard-Politik für eingehenden Verkehr (deny/allow/reject). */
function defaultIncoming(): string {
  const v = safeExec('ufw status verbose 2>/dev/null') || privExecSafe('ufw status verbose');
  const m = v.match(/Default:\s*(\w+)\s*\(incoming\)/i);
  return m ? m[1].toLowerCase() : '';
}

/** Ports aus laufenden Docker-Containern ermitteln (host-seitige Bindings). */
function dockerPublishedPorts(): Set<string> {
  const out = safeExec('docker ps --format "{{.Ports}}" 2>/dev/null');
  const ports = new Set<string>();
  for (const seg of out.split(/[\s,]+/)) {
    // Format: 0.0.0.0:8080->80/tcp  oder  :::443->443/tcp
    const m = seg.match(/:(\d+)->/);
    if (m) ports.add(m[1]);
  }
  return ports;
}

/** Ist Samba mit mindestens einer Freigabe konfiguriert? */
function sambaHasShares(): boolean {
  try {
    const fs = require('fs') as typeof import('fs');
    const conf = fs.readFileSync('/etc/samba/smb.conf', 'utf8');
    // Prüfe auf Abschnitte, die keine Standard-Abschnitte sind
    const shareSection = /^\[(?!global\]|homes\]|printers\]|print\$\]|ipc\$\])/im;
    return shareSection.test(conf);
  } catch { return false; }
}

/** Eine konkrete Aktion, die der Assistent auf Knopfdruck ausführen kann. */
interface FwAction {
  id: string;
  kind: 'allow-lan' | 'allow-any' | 'delete' | 'disable' | 'restrict-lan' | 'ignore';
  label: string;
  port?: string;
  proto?: string;
  ruleNum?: number;
}

interface FwFinding {
  id: string;
  severity: 'critical' | 'warn' | 'info' | 'ok';
  title: string;
  detail: string;
  recommendation: string;
  ruleNum?: number;
  port?: string;
  fix?: 'disable' | 'delete' | 'restrict-lan';
  fixLabel?: string;
  actions?: FwAction[];
}

/** Alle Regeln gegen Risiken, offene Ports und Redundanzen prüfen. */
function analyzeFirewall(
  rules: FirewallRule[],
  listening: Map<string, ListenInfo>,
  defIncoming: string,
  dockerPorts: Set<string>,
  conns: Map<string, number>,
  ignoredPorts: Set<string>,
): FwFinding[] {
  const findings: FwFinding[] = [];
  const defaultBlocks = defIncoming === 'deny' || defIncoming === 'reject';

  // 1) Standard-Richtlinie eingehend sollte "deny" sein
  if (defIncoming && !defaultBlocks) {
    findings.push({
      id: 'default-incoming',
      severity: 'warn',
      title: `Standard-Richtlinie (eingehend) ist „${defIncoming}"`,
      detail: `ufw default: ${defIncoming} (incoming)`,
      recommendation: 'Auf „deny (incoming)" stellen — dann sind nur ausdrücklich erlaubte Ports offen. (Wird beim Aktivieren der Firewall automatisch gesetzt.)',
    });
  }

  // 2) Pro Regel prüfen
  const seen = new Map<string, number>();
  const allowedPorts = new Set<string>();
  for (const r of rules) {
    if (r.action === 'ALLOW' && r.direction === 'OUT') continue; // ausgehende Allows sind unkritisch
    const pp = rulePort(r.to);
    const fromClass = classifyFrom(r.from);
    const key = `${r.action}|${r.to}|${r.from}|${r.direction}`;
    if (pp && r.action === 'ALLOW') allowedPorts.add(pp.port);

    // Überflüssige Block-Regel: Default ist bereits deny
    if ((r.action === 'DENY' || r.action === 'REJECT') && r.direction !== 'OUT' && defaultBlocks) {
      findings.push({
        id: `redundant-deny-${r.num}`, severity: 'info',
        title: `Block-Regel #${r.num} ist überflüssig`,
        detail: `Regel #${r.num}: ${r.raw}`,
        recommendation: 'Eingehender Verkehr wird durch die Standard-Richtlinie ohnehin schon blockiert (deny). Diese ausdrückliche Block-Regel ändert nichts und kann entfernt werden.',
        ruleNum: r.num,
        actions: [{ id: `del-${r.num}`, kind: 'delete', label: 'Block-Regel löschen', ruleNum: r.num }],
      });
      continue;
    }

    // Doppelte Regel
    if (seen.has(key)) {
      findings.push({
        id: `dup-${r.num}`, severity: 'info',
        title: `Doppelte Regel #${r.num}`,
        detail: r.raw,
        recommendation: `Inhaltlich identisch mit Regel #${seen.get(key)}. Eine davon kann entfernt werden.`,
        ruleNum: r.num, fix: 'delete', fixLabel: 'Duplikat löschen',
      });
      continue;
    }
    seen.set(key, r.num);

    if (pp && r.action === 'ALLOW') {
      const info = PORT_RISK[pp.port];
      // Gefährliche Freigabe: LAN-only-Port für ALLE offen
      if (info?.lanOnly && fromClass === 'any') {
        findings.push({
          id: `expose-${r.num}`, severity: 'critical',
          title: `${info.name} (Port ${pp.port}) ist für ALLE erreichbar`,
          detail: `Regel #${r.num}: ${r.raw}`,
          recommendation: `${info.note} Auf das LAN beschränken oder die Regel parken.`,
          ruleNum: r.num, port: pp.port, fix: 'disable', fixLabel: 'Regel parken',
        });
      }
      // SSH aus dem Internet
      else if (pp.port === '22' && fromClass === 'any') {
        findings.push({
          id: `ssh-${r.num}`, severity: 'warn',
          title: 'SSH (Port 22) ist aus dem Internet erreichbar',
          detail: `Regel #${r.num}: ${r.raw}`,
          recommendation: 'Auf das LAN beschränken (192.168.0.0/16 + 10.0.0.0/8). Alternativ: fail2ban + nur SSH-Schlüssel. "Auf LAN beschränken" löscht diese Regel und legt automatisch LAN-Only-Regeln an.',
          ruleNum: r.num, port: '22', fix: 'restrict-lan', fixLabel: 'Auf LAN beschränken',
        });
      }
      // Verwaiste Regel: Port offen, aber weder Dienst noch Docker-Container lauscht
      else if (!listening.has(pp.port) && !dockerPorts.has(pp.port)) {
        findings.push({
          id: `orphan-${r.num}`, severity: 'info',
          title: `Port ${pp.port} ist offen, aber kein Dienst lauscht darauf`,
          detail: `Regel #${r.num}: ${r.raw}`,
          recommendation: 'Aktuell hört kein Programm auf diesem Port. Du kannst die Regel gefahrlos parken — sobald ein Docker-Container o. Ä. den Port braucht, einfach wieder aktivieren.',
          ruleNum: r.num, port: pp.port, fix: 'disable', fixLabel: 'Port schließen (parken)',
        });
      }
      // Dienst nur auf localhost → externe Freigabe unnötig
      else if (listening.get(pp.port)?.scope === 'local') {
        findings.push({
          id: `loopback-${r.num}`, severity: 'info',
          title: `Port ${pp.port} ist offen, aber der Dienst läuft nur auf localhost`,
          detail: `Regel #${r.num}: ${r.raw}`,
          recommendation: 'Der Dienst ist von außen ohnehin nicht erreichbar (nur 127.0.0.1). Die Freigabe bringt nichts und kann geparkt werden.',
          ruleNum: r.num, port: pp.port, fix: 'disable', fixLabel: 'Regel parken',
        });
      }
    }
  }

  // 3) Port-Scan: lauschende Dienste, die (noch) nicht freigegeben sind → zur Freigabe anbieten
  const sambaActive = sambaHasShares();
  const SAMBA_PORTS = new Set(['139', '445']);
  const sortedListen = [...listening.entries()].sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  for (const [port, info] of sortedListen) {
    if (info.scope !== 'public') continue;       // nur extern lauschende Dienste
    if (allowedPorts.has(port)) continue;        // schon per Regel freigegeben
    if (ignoredPorts.has(port)) continue;        // vom Nutzer als „ignorieren" markiert
    // Samba-Ports nur zeigen, wenn tatsächlich Freigaben eingerichtet sind
    if (SAMBA_PORTS.has(port) && !sambaActive) continue;
    const proto = info.protos.size === 1 ? [...info.protos][0] : '';
    const svc = info.proc || PORT_RISK[port]?.name || '';
    const nConn = conns.get(port) ?? 0;
    const risky = PORT_RISK[port]?.lanOnly;
    const state = defaultBlocks
      ? 'aktuell durch die Standard-Richtlinie (deny) blockiert'
      : 'aktuell erreichbar (Standard erlaubt eingehend)';
    findings.push({
      id: `listen-${port}`,
      severity: 'info',
      title: `Port ${port}${svc ? ` (${svc})` : ''} lauscht${nConn ? ` – ${nConn} aktive Verbindung${nConn === 1 ? '' : 'en'}` : ''}`,
      detail: `Dienst lauscht auf 0.0.0.0:${port}${proto ? '/' + proto : ''} — ${state}.`,
      recommendation: risky
        ? `${PORT_RISK[port]!.note} Falls überhaupt nötig, nur im LAN freigeben.`
        : 'Soll dieser Dienst erreichbar sein? „Nur im LAN" (empfohlen) oder „Überall" (Internet). „Ignorieren" blendet diesen Port dauerhaft aus.',
      port,
      actions: [
        { id: `${port}-lan`, kind: 'allow-lan', label: 'Nur im LAN freigeben', port, proto },
        { id: `${port}-any`, kind: 'allow-any', label: 'Überall freigeben', port, proto },
        { id: `${port}-ignore`, kind: 'ignore', label: 'Ignorieren', port },
      ],
    });
  }

  return findings;
}

export function buildFirewallAnalysis() {
  const status = safeExec('ufw status numbered 2>/dev/null') || privExecSafe('ufw status numbered');
  const active = /Status:\s*active/i.test(status);
  const rules = parseUfw(status);
  const listening = listeningPorts();
  const def = defaultIncoming();
  const dockerPorts = dockerPublishedPorts();
  const conns = establishedConns();
  const ignoredPorts = new Set<string>((ipq.list.all() as { port: string }[]).map((r) => r.port));
  const findings = analyzeFirewall(rules, listening, def, dockerPorts, conns, ignoredPorts);
  const counts = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  return { active, ruleCount: rules.length, defaultIncoming: def, listeningCount: listening.size, findings, counts };
}

// Stellt NUR die beiden essenziellen LAN-Regeln sicher: SSH (22) und Web-UI (443)
// aus dem lokalen Netz – und das auch nur, wenn es für den Port noch KEINE Regel
// gibt (existiert bereits eine, wird sie unangetastet gelassen). Es werden bewusst
// KEINE weiteren Regeln (80, OpenSSH/Internet, „Notfall") angelegt.
// `force` überspringt die Aktiv-Prüfung (z.B. direkt vor dem Aktivieren/Reset).
export function ensureLanWebAccess(force = false): void {
  try {
    if (!hasBinary('ufw')) return;
    if (!force) {
      const st = safeExec('ufw status 2>/dev/null') || privExecSafe('ufw status');
      if (!/Status:\s*active/i.test(st)) return; // ufw inaktiv → nichts erzwingen
    }
    const statusNum = safeExec('ufw status numbered 2>/dev/null') || privExecSafe('ufw status numbered');
    const rules = parseUfw(statusNum);
    const hasRuleFor = (port: string) => rules.some((r) => {
      const pp = rulePort(r.to);
      return pp?.port === port && (r.action === 'ALLOW' || r.action === 'LIMIT');
    });
    const lans = hostLanSubnets();
    const ranges = lans.length ? lans : ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'];
    for (const port of ['22', '443']) {
      if (hasRuleFor(port)) continue; // bereits eine Regel vorhanden → nichts tun
      for (const lan of ranges) {
        try { privExec(`ufw allow from ${lan} to any port ${port} proto tcp comment 'Vault-Hub LAN (nur SSH/HTTPS)'`, { timeout: 8000 }); } catch { /* */ }
      }
    }
  } catch { /* ufw nicht verfügbar */ }
}

export async function firewallRoutes(fastify: FastifyInstance) {
  fastify.get('/api/firewall', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('ufw')) {
      const ports = safeExec("ss -tulnH 2>/dev/null | awk '{print $1, $5}' | head -60");
      return reply.send({ available: false, active: false, rules: [], disabled: [], logging: false, message: 'ufw nicht installiert (apt install ufw)', listening: ports.trim() });
    }
    const status = safeExec('ufw status numbered 2>/dev/null') || privExecSafe('ufw status numbered');
    const active = /Status:\s*active/i.test(status);
    const disabled = (dq.list.all() as DisabledRow[]).map((d) => ({
      id: d.id, action: d.action, direction: d.direction.toUpperCase(),
      port: d.port, proto: d.proto, from: d.from_addr,
      to: d.profile || (d.port ? `${d.port}${d.proto ? '/' + d.proto : ''}` : 'Regel'),
      comment: d.comment,
    }));
    reply.send({ available: true, active, logging: readLoggingState(), rules: parseUfw(status), disabled });
  });

  // Plausibilitäts-Assistent: Regeln prüfen und Optimierungen vorschlagen
  fastify.get('/api/firewall/analyze', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('ufw')) return reply.send({ available: false, active: false, ruleCount: 0, findings: [], counts: { critical: 0, warn: 0, info: 0 } });
    try {
      reply.send({ available: true, ...buildFirewallAnalysis() });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Analyse fehlgeschlagen' });
    }
  });

  // SSH-Regel auf LAN beschränken: Regel löschen + LAN-only Ersatz-Regeln anlegen
  fastify.post<{ Params: { num: string } }>('/api/firewall/:num/restrict-lan', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    const num = parseInt(req.params.num);
    if (!num) return reply.status(400).send({ error: 'Ungültige Regelnummer' });
    try {
      // Bestehende Regel (allow 22 from Anywhere) löschen
      privExec(`bash -c "yes | ufw delete ${num}"`, { timeout: 8000 });
      // LAN-Ersatzregeln anlegen
      privExec(`ufw allow from 192.168.0.0/16 to any port 22 comment 'SSH LAN-only'`, { timeout: 8000 });
      privExec(`ufw allow from 10.0.0.0/8 to any port 22 comment 'SSH LAN-only'`, { timeout: 8000 });
      privExec(`ufw allow from 172.16.0.0/12 to any port 22 comment 'SSH LAN-only'`, { timeout: 8000 });
      auditQueries.log.run(req.user.id, 'firewall.restrict-lan', `SSH Port 22 Regel #${num} auf LAN beschränkt`);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  fastify.post<{ Body: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string; comment?: string } }>(
    '/api/firewall',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const body = req.body ?? {};
      const { action } = body;
      if (!['allow', 'deny', 'reject'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const base = sanitiseParts(body);
      // "both" → je eine Regel für ein- und ausgehend
      const dirs = body.direction === 'both' ? ['in', 'out'] : [base.dir];
      // Mehrere Quell-Adressen → je eine Regel (gleicher Name zum Gruppieren)
      const addrs = splitAddrs(body.from);
      const targets = addrs.length > 0 ? addrs : [''];
      const cmds: string[] = [];
      for (const a of targets) {
        for (const d of dirs) {
          const cmd = buildRuleCmd(action, { ...base, fromIp: a, dir: d });
          if (cmd) cmds.push(cmd);
        }
      }
      if (cmds.length === 0) return reply.status(400).send({ error: 'Port oder Quell-IP erforderlich' });
      try {
        for (const cmd of cmds) privExec(cmd, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'firewall.add', `${cmds.length} Regel(n): ${cmds[0].replace('ufw ', '')}`);
        reply.send({ ok: true, count: cmds.length });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
      }
    }
  );

  // Regel bearbeiten = an gleicher Position neu einfügen, alte entfernen
  fastify.put<{ Params: { num: string }; Body: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string; comment?: string } }>(
    '/api/firewall/:num',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const num = parseInt(req.params.num);
      if (!num) return reply.status(400).send({ error: 'Ungültige Regelnummer' });
      const { action } = req.body ?? {};
      if (!['allow', 'deny', 'reject'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      // Beim Bearbeiten nur die erste Adresse verwenden (eine Regel = eine Position)
      const parts = sanitiseParts(req.body ?? {});
      const firstAddr = splitAddrs(req.body?.from)[0] ?? '';
      const cmd = buildRuleCmd(action, { ...parts, fromIp: firstAddr });
      if (!cmd) return reply.status(400).send({ error: 'Port oder Quell-IP erforderlich' });
      const insertCmd = cmd.replace(/^ufw /, `ufw insert ${num} `);
      try {
        // Neue Regel an Position NUM einfügen (alte rutscht auf NUM+1) …
        privExec(insertCmd, { timeout: 8000 });
        // … dann die alte (jetzt NUM+1) löschen
        privExec(`bash -c "yes | ufw delete ${num + 1}"`, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'firewall.edit', `${num}: ${cmd.replace('ufw ', '')}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
      }
    }
  );

  // Regel deaktivieren: aus ufw entfernen, aber Spezifikation merken (zum Reaktivieren)
  fastify.post<{ Params: { num: string }; Body: { action?: string; port?: string; proto?: string; from?: string; direction?: string; comment?: string; profile?: string } }>(
    '/api/firewall/:num/disable',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const num = parseInt(req.params.num);
      if (!num) return reply.status(400).send({ error: 'Ungültige Regelnummer' });
      const b = req.body ?? {};
      const p = sanitiseParts(b);
      const profile = cleanProfile(b.profile);
      const action = ['allow', 'deny', 'reject'].includes(b.action ?? '') ? b.action! : 'allow';
      try {
        privExec(`bash -c "yes | ufw delete ${num}"`, { timeout: 8000 });
        dq.insert.run(action, p.dir, p.p, p.pr, p.fromIp, profile, p.comment);
        auditQueries.log.run(req.user.id, 'firewall.disable', String(num));
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
      }
    }
  );

  // Deaktivierte Regel wieder aktivieren: erneut in ufw anlegen, aus der Parkbucht entfernen
  fastify.post<{ Params: { id: string } }>('/api/firewall/disabled/:id/enable', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    const row = dq.get.get(parseInt(req.params.id)) as DisabledRow | undefined;
    if (!row) return reply.status(404).send({ error: 'Regel nicht gefunden' });
    const c = row.comment ? ` comment '${cleanComment(row.comment)}'` : '';
    const cmd = row.profile
      ? `ufw ${row.action}${row.direction ? ` ${row.direction}` : ''} ${cleanProfile(row.profile)}${c}`
      : buildRuleCmd(row.action, { p: row.port, pr: row.proto, fromIp: row.from_addr, dir: row.direction, comment: row.comment });
    if (!cmd) { dq.del.run(row.id); return reply.send({ ok: true }); }
    try {
      privExec(cmd, { timeout: 8000 });
      dq.del.run(row.id);
      auditQueries.log.run(req.user.id, 'firewall.enable', cmd.replace('ufw ', ''));
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  // Deaktivierte Regel endgültig verwerfen
  fastify.delete<{ Params: { id: string } }>('/api/firewall/disabled/:id', { preHandler: requireAdmin }, async (req, reply) => {
    dq.del.run(parseInt(req.params.id));
    auditQueries.log.run(req.user.id, 'firewall.disabled.delete', req.params.id);
    reply.send({ ok: true });
  });

  fastify.delete<{ Params: { num: string } }>('/api/firewall/:num', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    const num = parseInt(req.params.num);
    if (!num) return reply.status(400).send({ error: 'Ungültige Regelnummer' });
    try {
      privExec(`bash -c "yes | ufw delete ${num}"`, { timeout: 8000 });
      auditQueries.log.run(req.user.id, 'firewall.delete', String(num));
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  fastify.post<{ Body: { enable: boolean } }>('/api/firewall/toggle', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    try {
      if (req.body?.enable) {
        // Aussperr-Schutz: nur SSH (22) + Web-UI (443) fürs LAN, und nur falls
        // dafür noch keine Regel existiert. Sonst wird nichts angelegt.
        ensureLanWebAccess(true);
      }
      privExec(`bash -c "yes | ufw ${req.body?.enable ? 'enable' : 'disable'}"`, { timeout: 8000 });
      auditQueries.log.run(req.user.id, 'firewall.toggle', String(req.body?.enable));
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  // Zurücksetzen: ALLE Regeln löschen und nur die beiden Grundregeln neu setzen
  // (SSH 22 + HTTPS 443, jeweils nur fürs LAN). Alles andere bleibt deaktiviert.
  fastify.post('/api/firewall/reset', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    try {
      privExec('bash -c "yes | ufw --force reset"', { timeout: 15000 });
      privExec('ufw default deny incoming', { timeout: 8000 });
      privExec('ufw default allow outgoing', { timeout: 8000 });
      ensureLanWebAccess(true);                       // nur 22 + 443 fürs LAN
      privExec('bash -c "yes | ufw enable"', { timeout: 8000 });
      try { db.exec('DELETE FROM firewall_disabled'); } catch { /* */ }
      auditQueries.log.run(req.user.id, 'firewall.reset', null);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  // Ignorierte Ports: Port dauerhaft aus dem Assistenten-Scan ausblenden
  fastify.post<{ Body: { port: string } }>('/api/firewall/ignore-port', { preHandler: requireAdmin }, async (req, reply) => {
    const port = (req.body?.port ?? '').replace(/[^0-9]/g, '');
    if (!port) return reply.status(400).send({ error: 'Port erforderlich' });
    ipq.insert.run(port);
    auditQueries.log.run(req.user.id, 'firewall.ignore-port', port);
    reply.send({ ok: true, port });
  });

  fastify.delete<{ Params: { port: string } }>('/api/firewall/ignore-port/:port', { preHandler: requireAdmin }, async (req, reply) => {
    const port = (req.params.port ?? '').replace(/[^0-9]/g, '');
    if (!port) return reply.status(400).send({ error: 'Port erforderlich' });
    ipq.del.run(port);
    auditQueries.log.run(req.user.id, 'firewall.unignore-port', port);
    reply.send({ ok: true });
  });

  // Protokollierung (Verbindungsversuche) ein-/ausschalten oder Stufe setzen
  fastify.post<{ Body: { enable?: boolean; level?: string } }>('/api/firewall/logging', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    // Stufe hat Vorrang; sonst per enable an/aus. ufw-Stufen: off/low/medium/high/full
    const target = req.body?.level && LOG_LEVELS.includes(req.body.level)
      ? req.body.level
      : (req.body?.enable ? 'on' : 'off');
    try {
      privExec(`ufw logging ${target}`, { timeout: 8000 });
      auditQueries.log.run(req.user.id, 'firewall.logging', target);
      reply.send({ ok: true, logging: target !== 'off', level: readLoggingLevel() });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  // Verbindungsversuche aus der Protokoll-DB (vorher frische Logzeilen einlesen)
  fastify.get<{ Querystring: { limit?: string } }>('/api/firewall/log', { preHandler: requireAuth }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.send({ available: false, logging: false, entries: [], total: 0, blocked: 0, message: 'ufw nicht installiert' });
    const limit = Math.min(5000, Math.max(10, parseInt(req.query.limit ?? '500') || 500));
    try { ingestFirewallLog(); } catch { /* */ }
    const entries = queryFirewallLog(limit);
    const stats = firewallLogStats();
    reply.send({ available: true, logging: readLoggingState(), level: readLoggingLevel(), source: 'Protokoll-DB', entries, total: stats.total, blocked: stats.blocked });
  });

  // Protokoll leeren
  fastify.delete('/api/firewall/log', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      clearFirewallLog();
      auditQueries.log.run(req.user.id, 'firewall.log.clear', null);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Fehler' });
    }
  });
}
