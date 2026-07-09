import { writeFileSync, unlinkSync } from 'fs';
import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { safeExec, privExec, hasBinary } from '../lib/privilege';
import { userQueries, auditQueries } from '../db/index';
import { ensureLanWebAccess } from './firewall';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

type Status = 'ok' | 'warn' | 'critical' | 'info';

interface Finding {
  id: string;
  category: string;
  title: string;
  status: Status;
  detail: string;
  recommendation: string;
  fix?: string;
  fixLabel?: string;   // eigener Button-Text statt „Beheben"
  link?: string;       // Frontend-Route zum Navigieren (statt/zusätzlich zu fix)
  linkLabel?: string;
  accessZone?: 'lan-only' | 'internet-ok' | 'internet-conditional';
  port?: string;
  lan?: boolean;       // aktuell aus dem LAN erreichbar?
  internet?: boolean;  // aktuell aus dem Internet erreichbar?
  subnet?: string;     // erkanntes LAN-Subnetz
}

function sshServiceUnit(): string {
  // Check which unit file exists; Debian uses 'ssh', RHEL/Arch use 'sshd'
  const files = safeExec('systemctl list-unit-files 2>/dev/null');
  if (/(?:^|\n)ssh\.service\s/m.test(files)) return 'ssh';
  if (/(?:^|\n)sshd\.service\s/m.test(files)) return 'sshd';
  // Fallback: check which is active right now
  if (safeExec('systemctl is-active ssh 2>/dev/null').trim() === 'active') return 'ssh';
  if (safeExec('systemctl is-active sshd 2>/dev/null').trim() === 'active') return 'sshd';
  return 'ssh';
}

function defaultPasswordCheck(): Finding[] {
  try {
    const admin = userQueries.getByUsername.get('admin');
    if (admin && bcrypt.compareSync('admin', admin.password_hash)) {
      return [{ id: 'default-pw', category: 'Vault-Hub', title: 'Standard-Passwort "admin" noch aktiv', status: 'critical', detail: 'Login admin/admin', recommendation: 'Ändere das Passwort sofort unter Einstellungen → Passwort ändern.' }];
    }
  } catch { /* */ }
  return [{ id: 'default-pw', category: 'Vault-Hub', title: 'Standard-Passwort geändert', status: 'ok', detail: '', recommendation: '' }];
}

function privSafe(cmd: string): string {
  try { return privExec(cmd, { timeout: 6000 }); } catch { return ''; }
}

function sshChecks(): Finding[] {
  const conf = safeExec('cat /etc/ssh/sshd_config 2>/dev/null') + '\n' + safeExec('cat /etc/ssh/sshd_config.d/*.conf 2>/dev/null');
  const findings: Finding[] = [];
  if (!conf.trim()) return findings;

  const rootLogin = conf.match(/^\s*PermitRootLogin\s+(\S+)/im)?.[1]?.toLowerCase();
  findings.push(
    rootLogin === 'yes'
      ? { id: 'ssh-root', category: 'SSH', title: 'Root-Login per SSH erlaubt', status: 'critical', detail: `PermitRootLogin ${rootLogin}`, recommendation: 'Setze "PermitRootLogin no" und nutze einen normalen Benutzer mit sudo.', fix: 'ssh-disable-root' }
      : { id: 'ssh-root', category: 'SSH', title: 'Root-Login per SSH deaktiviert', status: 'ok', detail: `PermitRootLogin ${rootLogin ?? 'prohibit-password'}`, recommendation: '' }
  );

  const pwAuth = conf.match(/^\s*PasswordAuthentication\s+(\S+)/im)?.[1]?.toLowerCase();
  findings.push(
    pwAuth === 'no'
      ? { id: 'ssh-pw', category: 'SSH', title: 'SSH nur per Schlüssel (kein Passwort)', status: 'ok', detail: 'PasswordAuthentication no', recommendation: '' }
      : { id: 'ssh-pw', category: 'SSH', title: 'SSH-Passwort-Anmeldung aktiv', status: 'warn', detail: `PasswordAuthentication ${pwAuth ?? 'yes (Standard)'}`, recommendation: 'Nutze SSH-Schlüssel und setze "PasswordAuthentication no".', fix: 'ssh-disable-password' }
  );
  return findings;
}

function firewallCheck(): Finding[] {
  if (!hasBinary('ufw')) {
    return [{ id: 'fw', category: 'Firewall', title: 'Keine Firewall (ufw) installiert', status: 'warn', detail: 'ufw nicht gefunden', recommendation: 'Installiere und aktiviere ufw (eingehend blockieren, SSH erlauben).', fix: 'firewall-install-enable' }];
  }
  const status = safeExec('ufw status 2>/dev/null') || privSafe('ufw status');
  const active = /Status:\s*active/i.test(status);
  return [active
    ? { id: 'fw', category: 'Firewall', title: 'Firewall aktiv', status: 'ok', detail: 'ufw active', recommendation: '' }
    : { id: 'fw', category: 'Firewall', title: 'Firewall installiert, aber inaktiv', status: 'critical', detail: 'ufw inactive', recommendation: 'Aktiviere die Firewall (Standard: eingehend blockieren, SSH erlauben).', fix: 'firewall-install-enable', link: '/networks', linkLabel: 'Zur Firewall' }];
}

function hardeningChecks(): Finding[] {
  const findings: Finding[] = [];
  // MAC framework (AppArmor / SELinux)
  const apparmor = safeExec('aa-status --enabled 2>/dev/null && echo on').includes('on') || safeExec('systemctl is-active apparmor 2>/dev/null').trim() === 'active';
  const selinux = safeExec('getenforce 2>/dev/null').trim().toLowerCase() === 'enforcing';
  findings.push(apparmor || selinux
    ? { id: 'mac', category: 'Härtung', title: `Mandatory Access Control aktiv (${selinux ? 'SELinux' : 'AppArmor'})`, status: 'ok', detail: '', recommendation: '' }
    : { id: 'mac', category: 'Härtung', title: 'Kein AppArmor/SELinux aktiv', status: 'warn', detail: 'MAC-Framework inaktiv', recommendation: 'Aktiviere AppArmor (Debian/Ubuntu) oder SELinux (RHEL) für zusätzliche Isolierung.' });

  // Time sync
  const timesync = safeExec('timedatectl show -p NTPSynchronized --value 2>/dev/null').trim();
  if (timesync) {
    findings.push(timesync === 'yes'
      ? { id: 'time', category: 'Härtung', title: 'Zeitsynchronisation aktiv', status: 'ok', detail: 'NTP synchronisiert', recommendation: '' }
      : { id: 'time', category: 'Härtung', title: 'Keine Zeitsynchronisation', status: 'info', detail: 'NTP nicht synchronisiert', recommendation: 'Aktiviere NTP: timedatectl set-ntp true (wichtig für Zertifikate/Logs).' });
  }
  return findings;
}

function updatesCheck(): Finding[] {
  const findings: Finding[] = [];
  if (hasBinary('apt-get')) {
    const upg = safeExec('apt list --upgradable 2>/dev/null', 10000);
    const secCount = (upg.match(/-security/g) ?? []).length;
    const total = upg.split('\n').filter((l) => l.includes('/')).length;
    findings.push(
      secCount > 0
        ? { id: 'updates-sec', category: 'Updates', title: `${secCount} Sicherheitsupdates verfügbar`, status: 'critical', detail: `${total} Updates gesamt`, recommendation: 'Spiele die Updates ein.', link: '/updates', linkLabel: 'System-Updates öffnen' }
        : { id: 'updates-sec', category: 'Updates', title: 'Keine offenen Sicherheitsupdates', status: 'ok', detail: `${total} normale Updates`, recommendation: '' }
    );
    const unattended = safeExec('dpkg -l unattended-upgrades 2>/dev/null | grep -c ^ii').trim();
    findings.push(
      unattended !== '0' && unattended !== ''
        ? { id: 'auto-upd', category: 'Updates', title: 'Automatische Updates aktiv', status: 'ok', detail: 'unattended-upgrades installiert', recommendation: '' }
        : { id: 'auto-upd', category: 'Updates', title: 'Keine automatischen Sicherheitsupdates', status: 'warn', detail: 'unattended-upgrades fehlt', recommendation: 'Installiere unattended-upgrades für automatische Sicherheitspatches.', fix: 'auto-updates-install' }
    );
  }
  if (safeExec('test -f /var/run/reboot-required && echo y').trim() === 'y') {
    findings.push({ id: 'reboot', category: 'Updates', title: 'Neustart erforderlich', status: 'warn', detail: 'reboot-required gesetzt', recommendation: 'Starte den Server neu, um Kernel-/Sicherheitsupdates zu aktivieren.', fix: 'reboot', fixLabel: 'Jetzt neu starten' });
  }
  return findings;
}

function intrusionCheck(): Finding[] {
  const f2b = safeExec('systemctl is-active fail2ban 2>/dev/null').trim();
  return [f2b === 'active'
    ? { id: 'f2b', category: 'Intrusion', title: 'fail2ban aktiv', status: 'ok', detail: 'Brute-Force-Schutz läuft', recommendation: '' }
    : { id: 'f2b', category: 'Intrusion', title: 'Kein Brute-Force-Schutz (fail2ban)', status: 'warn', detail: 'fail2ban inaktiv/fehlt', recommendation: 'Installiere fail2ban, um wiederholte Login-Versuche automatisch zu sperren.', fix: 'fail2ban-install' }];
}

function antivirusCheck(): Finding[] {
  const installed = hasBinary('clamscan') || hasBinary('clamdscan');
  if (!installed) {
    return [{ id: 'av', category: 'Virenschutz', title: 'Kein Virenschutz (ClamAV) installiert', status: 'warn', detail: 'clamav nicht gefunden', recommendation: 'Installiere ClamAV, um Dateien auf Schadsoftware prüfen zu können.', fix: 'antivirus-install', link: '/antivirus', linkLabel: 'Zum Virenschutz' }];
  }
  const findings: Finding[] = [{ id: 'av', category: 'Virenschutz', title: 'Virenschutz installiert (ClamAV)', status: 'ok', detail: '', recommendation: '' }];
  const ts = safeExec("stat -c %Y /var/lib/clamav/daily.cvd /var/lib/clamav/daily.cld 2>/dev/null | sort -n | tail -1").trim();
  if (ts) {
    const age = Math.floor((Date.now() / 1000 - parseInt(ts)) / 86400);
    if (age > 7) findings.push({ id: 'av-defs', category: 'Virenschutz', title: `Viren-Signaturen veraltet (${age} Tage)`, status: 'warn', detail: '', recommendation: 'Aktualisiere die Signaturen unter „Virenschutz" (freshclam).' });
  }
  return findings;
}

function accountChecks(): Finding[] {
  const findings: Finding[] = [];
  const empty = privSafe("awk -F: '($2==\"\"){print $1}' /etc/shadow").trim();
  if (empty) {
    findings.push({ id: 'empty-pw', category: 'Konten', title: 'Benutzer ohne Passwort', status: 'critical', detail: empty.replace(/\n/g, ', '), recommendation: 'Setze für diese Konten ein Passwort oder sperre sie (passwd -l <user>).' });
  } else {
    findings.push({ id: 'empty-pw', category: 'Konten', title: 'Keine Konten ohne Passwort', status: 'ok', detail: '', recommendation: '' });
  }
  // Multiple UID 0 accounts
  const uid0 = safeExec("awk -F: '($3==0){print $1}' /etc/passwd").trim().split('\n').filter(Boolean);
  if (uid0.length > 1) {
    findings.push({ id: 'uid0', category: 'Konten', title: 'Mehrere Root-Konten (UID 0)', status: 'critical', detail: uid0.join(', '), recommendation: 'Nur "root" sollte UID 0 haben. Entferne zusätzliche UID-0-Konten.' });
  }
  return findings;
}

// Wissendatenbank: wie ist ein Port einzuordnen?
const PORT_DB: Record<string, { name: string; zone: 'lan-only' | 'internet-ok' | 'internet-conditional'; risk: Status; note: string }> = {
  '22':    { name: 'SSH',           zone: 'internet-conditional', risk: 'warn',     note: 'Nur mit SSH-Schlüsseln + fail2ban ins Internet; besser: LAN-only' },
  '80':    { name: 'HTTP',          zone: 'internet-ok',          risk: 'ok',       note: 'HTTP (Redirect auf HTTPS) – für Reverse Proxy (Caddy) sicher' },
  '443':   { name: 'HTTPS',         zone: 'internet-ok',          risk: 'ok',       note: 'Verschlüsselter Reverse Proxy / Webserver – Internet-sicher' },
  '139':   { name: 'NetBIOS/Samba', zone: 'lan-only',             risk: 'critical', note: 'NIE ins Internet – massives Exploit-Risiko (EternalBlue, WannaCry etc.)' },
  '445':   { name: 'SMB/Samba',     zone: 'lan-only',             risk: 'critical', note: 'NIE ins Internet – massives Exploit-Risiko (EternalBlue, WannaCry etc.)' },
  '3306':  { name: 'MySQL/MariaDB', zone: 'lan-only',             risk: 'critical', note: 'Datenbank-Port niemals direkt ins Internet' },
  '5432':  { name: 'PostgreSQL',    zone: 'lan-only',             risk: 'critical', note: 'Datenbank-Port niemals direkt ins Internet' },
  '6379':  { name: 'Redis',         zone: 'lan-only',             risk: 'critical', note: 'Redis hat standardmäßig keine Auth – nur intern/LAN' },
  '27017': { name: 'MongoDB',       zone: 'lan-only',             risk: 'critical', note: 'Datenbank-Port nur intern' },
  '111':   { name: 'RPC',           zone: 'lan-only',             risk: 'warn',     note: 'RPC/NFS nur im LAN verwenden' },
  '2049':  { name: 'NFS',           zone: 'lan-only',             risk: 'warn',     note: 'NFS-Freigaben nur im LAN' },
  '5900':  { name: 'VNC',           zone: 'lan-only',             risk: 'critical', note: 'VNC meist unverschlüsselt – niemals ins Internet' },
  '3389':  { name: 'RDP',           zone: 'lan-only',             risk: 'critical', note: 'RDP-Brute-Force massiv – niemals direkt ins Internet' },
  '8080':  { name: 'HTTP Alt',      zone: 'internet-conditional', risk: 'warn',     note: 'Nur via Reverse Proxy (HTTPS) ins Internet freigeben' },
  '4200':  { name: 'Vault-Hub',      zone: 'internet-conditional', risk: 'warn',     note: 'Vault-Hub via Caddy (Port 443) freigeben, nicht direkt' },
  '9000':  { name: 'Portainer',     zone: 'internet-conditional', risk: 'warn',     note: 'Admin-UI nur via gesichertem Reverse Proxy freigeben' },
  '1194':  { name: 'OpenVPN',       zone: 'internet-ok',          risk: 'ok',       note: 'VPN-Port – für Fernzugriff, verschlüsselt' },
  '51820': { name: 'WireGuard',     zone: 'internet-ok',          risk: 'ok',       note: 'WireGuard VPN – sicher für Internet-Zugriff' },
  '11434': { name: 'Ollama AI',     zone: 'internet-conditional', risk: 'warn',     note: 'Ollama-API – kein Auth-Schutz im Standard; nur LAN oder via VPN freigeben' },
};

/** LAN-Subnetz des Servers aus der primären Netzwerkschnittstelle ermitteln. */
function detectLanSubnet(): string {
  const ip4 = safeExec("ip -4 addr show | grep 'inet ' | grep -v '127.0.0.1'").trim();
  const m = ip4.match(/inet\s+(\d+)\.(\d+)\.\d+\.\d+\/\d+/);
  if (m) {
    const a = parseInt(m[1]), b = parseInt(m[2]);
    if (a === 10) return '10.0.0.0/8';
    if (a === 172 && b >= 16 && b <= 31) return '172.16.0.0/12';
    if (a === 192 && b === 168) return '192.168.0.0/16';
  }
  return '192.168.0.0/16';
}

// ── ufw-Zustandsanalyse: ist ein Port aktuell aus LAN/Internet erreichbar? ──
interface UfwRule { num: number; to: string; action: string; dir: string; from: string }

function parseUfwNumbered(): UfwRule[] {
  const out = safeExec('ufw status numbered 2>/dev/null') || privSafe('ufw status numbered');
  const rules: UfwRule[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT))?\s+(.+?)(?:\s+#.*)?$/i);
    if (m) rules.push({ num: parseInt(m[1]), to: m[2].trim(), action: m[3].toUpperCase(), dir: (m[4] ?? '').toUpperCase(), from: m[5].trim() });
  }
  return rules;
}

function ufwInfo(): { active: boolean; defaultIncoming: 'allow' | 'deny' } {
  const v = safeExec('ufw status verbose 2>/dev/null') || privSafe('ufw status verbose');
  return { active: /Status:\s*active/i.test(v), defaultIncoming: /Default:\s*allow\s*\(incoming\)/i.test(v) ? 'allow' : 'deny' };
}

function ipToInt(ip: string): number | null {
  const o = ip.split('.');
  if (o.length !== 4) return null;
  let n = 0;
  for (const part of o) { const v = parseInt(part); if (isNaN(v) || v < 0 || v > 255) return null; n = (n << 8) | v; }
  return n >>> 0;
}

/** Liegt eine IPv4 in einem CIDR? Nicht-parsebar (z.B. IPv6/Anywhere) → true (nicht ausschließen). */
function ipInCidr(ip: string, cidr: string): boolean {
  if (!cidr || /anywhere/i.test(cidr)) return true;
  const [base, bitsStr] = cidr.split('/');
  const bits = bitsStr === undefined ? 32 : parseInt(bitsStr);
  const ipN = ipToInt(ip), baseN = ipToInt(base);
  if (ipN === null || baseN === null) return true;
  if (bits <= 0) return true;
  const mask = bits >= 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

function ruleToPort(to: string): string | null {
  const m = to.match(/^(\d+)(?:\/(?:tcp|udp))?/i);
  return m ? m[1] : null;
}

/** Würde ein eingehendes Paket von srcIp an port durchgelassen? (ufw: erste passende Regel gewinnt) */
function simulateIncoming(rules: UfwRule[], srcIp: string, port: string, defaultIncoming: 'allow' | 'deny'): boolean {
  for (const r of rules) {
    if (r.dir === 'OUT') continue;
    if (!/anywhere/i.test(r.to) && ruleToPort(r.to) !== port) continue;
    const fromCidr = /anywhere/i.test(r.from) ? '' : r.from.replace(/\s*\(v6\)/i, '').trim();
    if (!ipInCidr(srcIp, fromCidr)) continue;
    return r.action === 'ALLOW' || r.action === 'LIMIT';
  }
  return defaultIncoming === 'allow';
}

function serverIp(): string {
  const out = safeExec("ip -4 addr show scope global 2>/dev/null | grep 'inet '").trim();
  const m = out.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
  return m ? m[1] : '192.168.1.100';
}

/** Alle ufw-Regeln zu einem Port entfernen (Nummern verschieben sich → einzeln + neu parsen). */
function clearPortRules(port: string): void {
  for (let i = 0; i < 50; i++) {
    const rules = parseUfwNumbered();
    const target = rules.find((r) => r.dir !== 'OUT' && ruleToPort(r.to) === port);
    if (!target) break;
    privExec(`bash -c "yes | ufw delete ${target.num}"`, { timeout: 8000 });
  }
}

/** Öffentlich gebundene Ports mit echter LAN/Internet-Erreichbarkeit (aus ufw). */
function networkAccessCheck(): Finding[] {
  const out = safeExec('ss -tlnH 2>/dev/null');
  const publicPorts = out.split('\n')
    .map((l) => l.trim().split(/\s+/)[3])
    .filter((a) => a && (a.startsWith('0.0.0.0') || a.startsWith('*') || a.startsWith('[::]')))
    .map((a) => a.split(':').pop())
    .filter(Boolean) as string[];
  const unique = [...new Set(publicPorts)];
  const subnet = detectLanSubnet();
  if (unique.length === 0) return [{ id: 'ports-none', category: 'Netzwerkzugang', title: 'Keine öffentlich gebundenen Ports', status: 'ok', detail: '', recommendation: '' }];

  const hasUfw = hasBinary('ufw');
  const { active, defaultIncoming } = hasUfw ? ufwInfo() : { active: false, defaultIncoming: 'allow' as const };
  const rules = hasUfw && active ? parseUfwNumbered() : [];
  const lanProbe = serverIp();

  return unique.map((port) => {
    const info = PORT_DB[port];
    const zone = info?.zone ?? 'internet-conditional';
    // Echter Zustand: ohne aktive Firewall ist alles erreichbar
    const lan = (!hasUfw || !active) ? true : simulateIncoming(rules, lanProbe, port, defaultIncoming);
    const internet = (!hasUfw || !active) ? true : simulateIncoming(rules, '1.1.1.1', port, defaultIncoming);

    // Status aus Empfehlung + tatsächlichem Zustand ableiten
    let status: Status;
    if (zone === 'lan-only') status = internet ? 'critical' : (lan ? 'ok' : 'info');
    else if (zone === 'internet-ok') status = 'ok';
    else status = internet ? 'warn' : 'ok';

    const stateTxt = (!hasUfw || !active) ? 'Firewall inaktiv – aktuell für ALLE erreichbar'
      : lan && internet ? 'Aktuell: LAN + Internet erreichbar'
      : lan && !internet ? 'Aktuell: nur LAN (Internet gesperrt) ✓'
      : !lan && internet ? 'Aktuell: nur Internet (LAN gesperrt)'
      : 'Aktuell: komplett gesperrt';

    return {
      id: `port-${port}`,
      category: 'Netzwerkzugang',
      title: `Port ${port}${info ? ' – ' + info.name : ''}`,
      status,
      detail: `${info?.note ?? 'Unbekannter Dienst – prüfen ob öffentlich notwendig'} · ${stateTxt}`,
      recommendation: zone === 'lan-only'
        ? `Empfehlung: nur LAN (${subnet}). Schalte „Internet" unten aus.`
        : zone === 'internet-ok'
        ? 'Internet-Zugriff für diesen Dienst ist vertretbar.'
        : `Empfehlung: prüfen ob Internet nötig; sonst auf LAN (${subnet}) beschränken.`,
      accessZone: zone as Finding['accessZone'],
      port, lan, internet, subnet,
    };
  });
}

async function dockerChecks(): Promise<Finding[]> {
  const findings: Finding[] = [];
  try {
    const containers = await docker.listContainers({ all: false });
    const privileged: string[] = [];
    const sockMount: string[] = [];
    await Promise.all(containers.map(async (c) => {
      const info = await docker.getContainer(c.Id).inspect().catch(() => null);
      if (!info) return;
      const name = info.Name.replace(/^\//, '');
      if (info.HostConfig?.Privileged) privileged.push(name);
      if ((info.Mounts ?? []).some((m) => m.Source === '/var/run/docker.sock')) sockMount.push(name);
    }));
    findings.push(privileged.length
      ? { id: 'priv', category: 'Docker', title: `${privileged.length} privilegierte Container`, status: 'critical', detail: privileged.join(', '), recommendation: 'Vermeide --privileged. Vergib nur einzelne benötigte Capabilities.' }
      : { id: 'priv', category: 'Docker', title: 'Keine privilegierten Container', status: 'ok', detail: '', recommendation: '' });
    if (sockMount.length) {
      findings.push({ id: 'sock', category: 'Docker', title: `Docker-Socket in ${sockMount.length} Container(n)`, status: 'warn', detail: sockMount.join(', '), recommendation: 'Ein gemounteter docker.sock = Root auf dem Host. Nur wenn unbedingt nötig und vertrauenswürdig.' });
    }
    // Pangolin/Newt-Tunnel erkennen – wenn aktiv, können direkte Internet-Ports gesperrt werden
    const newtContainer = containers.find((c) =>
      c.Names.some((n) => /newt/i.test(n)) || c.Image.toLowerCase().includes('newt') || c.Image.toLowerCase().includes('pangolin')
    );
    if (newtContainer) {
      const name = newtContainer.Names[0]?.replace('/', '') ?? newtContainer.Image;
      findings.push({ id: 'pangolin-newt', category: 'Netzwerkzugang', title: 'Pangolin/Newt Tunnel aktiv', status: 'ok', detail: `Tunnel-Container: ${name}`, recommendation: 'Externe Dienste laufen über den Pangolin-Tunnel – kein direkter Internetanschluss nötig. Alle lokalen Ports können auf Nur-LAN gesetzt werden.' });
    }
  } catch {
    /* docker not available */
  }
  return findings;
}

export async function securityRoutes(fastify: FastifyInstance) {
  fastify.get('/api/security/scan', { preHandler: requireAuth }, async (_req, reply) => {
    const findings: Finding[] = [
      ...defaultPasswordCheck(),
      ...sshChecks(),
      ...firewallCheck(),
      ...updatesCheck(),
      ...intrusionCheck(),
      ...antivirusCheck(),
      ...accountChecks(),
      ...networkAccessCheck(),
      ...hardeningChecks(),
      ...(await dockerChecks()),
    ];

    const counts = { ok: 0, warn: 0, critical: 0, info: 0 };
    for (const f of findings) counts[f.status]++;

    let score = 100 - counts.critical * 20 - counts.warn * 8;
    score = Math.max(0, Math.min(100, score));
    const grade = score >= 85 ? 'Sehr gut' : score >= 65 ? 'Gut' : score >= 40 ? 'Verbesserungswürdig' : 'Kritisch';

    const firewallActive = hasBinary('ufw') && ufwInfo().active;
    reply.send({ score, grade, counts, findings, scannedAt: new Date().toISOString(), firewallActive });
  });

  // ── SSH service status & control ──
  fastify.get('/api/security/ssh', { preHandler: requireAuth }, async (_req, reply) => {
    const unit = sshServiceUnit();
    const installed = hasBinary('sshd') || safeExec(`systemctl list-unit-files 2>/dev/null | grep -c "^${unit}.service"`).trim() !== '0';
    const active = safeExec(`systemctl is-active ${unit} 2>/dev/null`).trim() === 'active';
    const enabled = safeExec(`systemctl is-enabled ${unit} 2>/dev/null`).trim() === 'enabled';
    const port = safeExec('grep -hiE "^\\s*Port\\s+" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | head -1').trim().split(/\s+/)[1] || '22';
    reply.send({ installed, active, enabled, unit, port });
  });

  fastify.post<{ Body: { action: 'start' | 'stop' | 'enable' | 'disable' } }>(
    '/api/security/ssh',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const action = req.body?.action;
      if (!['start', 'stop', 'enable', 'disable'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const unit = sshServiceUnit();
      try {
        if (action === 'enable') privExec(`systemctl enable --now ${unit}`, { timeout: 12000 });
        else if (action === 'disable') privExec(`systemctl disable --now ${unit}`, { timeout: 12000 });
        else privExec(`systemctl ${action} ${unit}`, { timeout: 12000 });
        auditQueries.log.run(req.user.id, `ssh.${action}`, unit);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'SSH-Steuerung fehlgeschlagen' });
      }
    }
  );

  // ── One-click hardening actions ──
  fastify.post<{ Body: { action: string } }>(
    '/api/security/action',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const action = req.body?.action;
      const unit = sshServiceUnit();
      try {
        let output = '';
        // Port-Zugang setzen: LAN und/oder Internet getrennt an/aus
        if (action?.startsWith('port-access:')) {
          const parts = action.split(':');
          const port = (parts[1] ?? '').replace(/[^0-9]/g, '');
          const wantLan = parts[2] === '1';
          const wantNet = parts[3] === '1';
          const subnet = (parts.slice(4).join(':') || detectLanSubnet()).replace(/[^0-9a-fA-F:.\/]/g, '');
          if (!port) return reply.status(400).send({ error: 'Ungültige Aktion' });
          if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert – Firewall zuerst einrichten' });
          // Bestehende Regeln für diesen Port entfernen (saubere Basis)
          clearPortRules(port);
          if (wantLan && wantNet) {
            privExec(`ufw allow in to any port ${port}`, { timeout: 8000 });
            output = `Port ${port}: LAN + Internet erlaubt`;
          } else if (wantLan && !wantNet) {
            privExec(`ufw allow in from ${subnet} to any port ${port}`, { timeout: 8000 });
            privExec(`ufw deny in to any port ${port}`, { timeout: 8000 });
            output = `Port ${port}: nur LAN (${subnet}) – Internet gesperrt`;
          } else if (!wantLan && wantNet) {
            privExec(`ufw deny in from ${subnet} to any port ${port}`, { timeout: 8000 });
            privExec(`ufw allow in to any port ${port}`, { timeout: 8000 });
            output = `Port ${port}: nur Internet – LAN gesperrt`;
          } else {
            privExec(`ufw deny in to any port ${port}`, { timeout: 8000 });
            output = `Port ${port}: komplett gesperrt`;
          }
          auditQueries.log.run(req.user.id, 'security.fix', `port-access:${port} lan=${wantLan} net=${wantNet}`);
          const active = /Status:\s*active/i.test(safeExec('ufw status 2>/dev/null') || privSafe('ufw status'));
          return reply.send({ ok: true, output: output + (active ? '' : ' (Firewall ist inaktiv – Regeln greifen erst nach Aktivierung!)') });
        }
        // Server-Neustart: zuerst antworten, dann verzögert rebooten (Verbindung bricht ab)
        if (action === 'reboot') {
          auditQueries.log.run(req.user.id, 'security.fix', 'reboot');
          reply.send({ ok: true, output: 'Server wird neu gestartet… Die Verbindung bricht ab, bitte in 1–2 Minuten neu laden.' });
          setTimeout(() => {
            try { privExec('systemctl reboot', { timeout: 8000 }); }
            catch { try { privExec('reboot', { timeout: 8000 }); } catch { /* */ } }
          }, 800);
          return;
        }
        switch (action) {
          case 'ssh-disable-root': {
            const cfg = safeExec('cat /etc/ssh/sshd_config 2>/dev/null') || privSafe('cat /etc/ssh/sshd_config');
            if (!cfg.trim()) throw new Error('/etc/ssh/sshd_config nicht lesbar');
            let newRoot = cfg.replace(/^[ \t]*#?[ \t]*PermitRootLogin.*$/gim, 'PermitRootLogin no');
            if (!/^PermitRootLogin\s/im.test(newRoot)) newRoot += '\nPermitRootLogin no\n';
            const tmpRoot = `/tmp/sshd_config.${process.pid}.tmp`;
            writeFileSync(tmpRoot, newRoot);
            try { privExec(`cp ${tmpRoot} /etc/ssh/sshd_config`, { timeout: 5000 }); } finally { try { unlinkSync(tmpRoot); } catch { /* */ } }
            privExec(`systemctl reload ${unit} 2>/dev/null || systemctl restart ${unit}`, { timeout: 12000 });
            break;
          }
          case 'ssh-disable-password': {
            const cfg = safeExec('cat /etc/ssh/sshd_config 2>/dev/null') || privSafe('cat /etc/ssh/sshd_config');
            if (!cfg.trim()) throw new Error('/etc/ssh/sshd_config nicht lesbar');
            let newPw = cfg.replace(/^[ \t]*#?[ \t]*PasswordAuthentication.*$/gim, 'PasswordAuthentication no');
            if (!/^PasswordAuthentication\s/im.test(newPw)) newPw += '\nPasswordAuthentication no\n';
            const tmpPw = `/tmp/sshd_config.${process.pid}.tmp`;
            writeFileSync(tmpPw, newPw);
            try { privExec(`cp ${tmpPw} /etc/ssh/sshd_config`, { timeout: 5000 }); } finally { try { unlinkSync(tmpPw); } catch { /* */ } }
            privExec(`systemctl reload ${unit} 2>/dev/null || systemctl restart ${unit}`, { timeout: 12000 });
            break;
          }
          case 'firewall-install-enable':
            // Firewall aktivieren mit sicherer Grundeinstellung: alles eingehend
            // gesperrt, nur SSH (22) und HTTPS (443) fürs LAN offen. Bewusst KEIN
            // OpenSSH/„Anywhere" (das öffnet 22 fürs Internet) und keine weiteren Regeln.
            if (!hasBinary('ufw')) privExec('apt-get install -y ufw', { timeout: 180000 });
            privExec('ufw default deny incoming', { timeout: 8000 });
            privExec('ufw default allow outgoing', { timeout: 8000 });
            ensureLanWebAccess(true);
            privExec('bash -c "yes | ufw enable"', { timeout: 30000 });
            break;
          case 'fail2ban-install':
            privExec('apt-get install -y fail2ban', { timeout: 180000 });
            privExec('systemctl enable --now fail2ban', { timeout: 15000 });
            break;
          case 'auto-updates-install':
            privExec('apt-get install -y unattended-upgrades', { timeout: 180000 });
            privExec('bash -c "echo unattended-upgrades unattended-upgrades/enable_auto_updates boolean true | debconf-set-selections; dpkg-reconfigure -f noninteractive unattended-upgrades"', { timeout: 30000 });
            break;
          case 'antivirus-install':
            privExec('apt-get install -y clamav clamav-daemon', { timeout: 300000 });
            break;
          default:
            return reply.status(400).send({ error: 'Unbekannte Aktion' });
        }
        auditQueries.log.run(req.user.id, 'security.fix', action);
        reply.send({ ok: true, output });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Aktion fehlgeschlagen';
        reply.status(500).send({ error: msg.includes('sudo') ? 'Keine Root-Rechte – bitte einmal „sudo bash install.sh --fix-perms“ ausführen (aktualisiert die sudoers-Rechte).' : msg });
      }
    }
  );
}
