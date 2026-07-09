export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : decimals)} ${sizes[i]}`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function timeAgo(unixTs: number): string {
  const diff = Date.now() / 1000 - unixTs;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `vor ${Math.floor(diff / 86400)}d`;
  return `vor ${Math.floor(diff / 2592000)} Mon.`;
}

const AVATAR_COLORS = [
  '#10B981', '#06B6D4', '#8B5CF6', '#F59E0B',
  '#EF4444', '#2563EB', '#EC4899', '#14B8A6',
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function containerInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

/** Übersetzt eine go-humanize-Zeitangabe (z. B. "About a minute") ins Deutsche. */
function translateTime(t: string): string {
  return t
    .replace(/Less than a second/i, 'weniger als 1 Sekunde')
    .replace(/About a minute/i, 'etwa 1 Minute')
    .replace(/About an hour/i, 'etwa 1 Stunde')
    .replace(/\b(\d+)\s+seconds?\b/gi, (_m, n) => `${n} Sekunde${n === '1' ? '' : 'n'}`)
    .replace(/\b(\d+)\s+minutes?\b/gi, (_m, n) => `${n} Minute${n === '1' ? '' : 'n'}`)
    .replace(/\b(\d+)\s+hours?\b/gi, (_m, n) => `${n} Stunde${n === '1' ? '' : 'n'}`)
    .replace(/\b(\d+)\s+days?\b/gi, (_m, n) => `${n} Tag${n === '1' ? '' : 'en'}`)
    .replace(/\b(\d+)\s+weeks?\b/gi, (_m, n) => `${n} Woche${n === '1' ? '' : 'n'}`)
    .replace(/\b(\d+)\s+months?\b/gi, (_m, n) => `${n} Monat${n === '1' ? '' : 'en'}`)
    .replace(/\b(\d+)\s+years?\b/gi, (_m, n) => `${n} Jahr${n === '1' ? '' : 'en'}`);
}

/**
 * Übersetzt den Docker-Statustext (z. B. "Up About a minute (healthy)") ins
 * Deutsche – inklusive Zustand, Zeit und Gesundheitszustand.
 */
/** Bekannte Ports → Dienst + Hinweis (für Hover-Tipps in der Verbindungsliste). */
const PORT_SERVICES: Record<string, { name: string; risky?: boolean }> = {
  '20': { name: 'FTP-Daten' }, '21': { name: 'FTP', risky: true },
  '22': { name: 'SSH (Fernzugriff)' }, '23': { name: 'Telnet (unverschlüsselt!)', risky: true },
  '25': { name: 'SMTP (Mailversand)' }, '53': { name: 'DNS (Namensauflösung)' },
  '67': { name: 'DHCP-Server' }, '68': { name: 'DHCP-Client' },
  '80': { name: 'HTTP (Web)' }, '110': { name: 'POP3 (Mailabruf)' },
  '111': { name: 'RPC/portmapper', risky: true }, '123': { name: 'NTP (Zeit)' },
  '135': { name: 'MS-RPC', risky: true }, '137': { name: 'NetBIOS', risky: true },
  '139': { name: 'NetBIOS/SMB', risky: true }, '143': { name: 'IMAP (Mail)' },
  '161': { name: 'SNMP', risky: true }, '389': { name: 'LDAP' },
  '443': { name: 'HTTPS (Web, sicher)' }, '445': { name: 'SMB/CIFS (Dateifreigabe)', risky: true },
  '465': { name: 'SMTP (SSL)' }, '514': { name: 'Syslog' }, '587': { name: 'SMTP (Submission)' },
  '631': { name: 'IPP (Drucker)' }, '636': { name: 'LDAPS' },
  '993': { name: 'IMAPS (Mail, sicher)' }, '995': { name: 'POP3S (sicher)' },
  '1194': { name: 'OpenVPN' }, '1433': { name: 'MS SQL Server', risky: true },
  '1521': { name: 'Oracle DB', risky: true }, '1883': { name: 'MQTT (IoT)' },
  '2049': { name: 'NFS (Dateifreigabe)' }, '2375': { name: 'Docker-API (unverschlüsselt!)', risky: true },
  '2376': { name: 'Docker-API (TLS)' }, '3000': { name: 'Web-App (häufig Grafana/Node)' },
  '3306': { name: 'MySQL/MariaDB', risky: true }, '3389': { name: 'RDP (Windows-Fernzugriff)', risky: true },
  '5060': { name: 'SIP (VoIP)' }, '5432': { name: 'PostgreSQL', risky: true },
  '5900': { name: 'VNC (Fernsteuerung)', risky: true }, '5985': { name: 'WinRM', risky: true },
  '6379': { name: 'Redis', risky: true }, '8006': { name: 'Proxmox' },
  '8080': { name: 'HTTP-alternativ (Web/Proxy)' }, '8443': { name: 'HTTPS-alternativ' },
  '8123': { name: 'Home Assistant' }, '9000': { name: 'Web-App (häufig Portainer)' },
  '9090': { name: 'Web-App (häufig Prometheus/Cockpit)' }, '9200': { name: 'Elasticsearch', risky: true },
  '11211': { name: 'Memcached', risky: true }, '27017': { name: 'MongoDB', risky: true },
  '51820': { name: 'WireGuard (VPN)' },
};

export interface PortHint { name: string; category: string; risky: boolean; hint: string; }

/** Liefert eine kurze Erklärung zu einem Port (Dienst + Einordnung) für Hover-Tipps. */
export function portInfo(portStr: string): PortHint {
  const port = parseInt(portStr, 10);
  if (!portStr || isNaN(port)) return { name: 'Unbekannt', category: '', risky: false, hint: 'Kein Port erkannt.' };
  const known = PORT_SERVICES[portStr];
  if (known) {
    return {
      name: known.name,
      category: 'Bekannter Dienst',
      risky: !!known.risky,
      hint: `${known.name} – häufig genutzter Port.${known.risky ? ' ⚠ Sollte nicht offen im Internet stehen.' : ''}`,
    };
  }
  if (port >= 49152) return { name: 'Dynamischer Port', category: 'Dynamisch/ephemer', risky: false, hint: `Port ${port}: dynamischer/temporärer Port – meist die Gegenseite eines Clients, kein fester Dienst.` };
  if (port <= 1023) return { name: 'System-Port', category: 'Well-known (reserviert)', risky: false, hint: `Port ${port}: reservierter System-Port ohne bekannten Standarddienst in dieser Liste.` };
  return { name: 'Kein Standarddienst', category: 'Registriert/anwendungsspezifisch', risky: false, hint: `Port ${port}: kein allgemein bekannter Dienst – meist anwendungsspezifisch (eigener Container/Programm).` };
}

/** Docker-Neustart-Richtlinie auf Deutsch anzeigen. */
export function germanRestart(policy: string): string {
  switch (policy) {
    case 'unless-stopped': return 'Außer wenn manuell gestoppt';
    case 'always':         return 'Immer';
    case 'on-failure':     return 'Nur bei Fehler';
    case 'no':             return 'Nie';
    default:               return policy || 'Nie';
  }
}

export function germanStatus(status: string): string {
  if (!status) return '';
  let s = status.trim();

  // Gesundheits-Suffix abtrennen und übersetzen
  let health = '';
  const hm = s.match(/\((healthy|unhealthy|health:\s*starting)\)\s*$/i);
  if (hm) {
    const key = hm[1].toLowerCase().replace(/\s+/g, ' ');
    health = key === 'healthy' ? ' (gesund)' : key === 'unhealthy' ? ' (fehlerhaft)' : ' (Prüfung läuft)';
    s = s.slice(0, hm.index).trim();
  }

  let m: RegExpMatchArray | null;
  if ((m = s.match(/^Up\s+(.+)$/i)))                                     return `Läuft seit ${translateTime(m[1])}${health}`;
  if ((m = s.match(/^Exited\s+\((\d+)\)\s+(.+?)\s+ago$/i)))             return `Beendet (${m[1]}) vor ${translateTime(m[2])}${health}`;
  if ((m = s.match(/^Exited\s+\((\d+)\)/i)))                            return `Beendet (${m[1]})${health}`;
  if ((m = s.match(/^Restarting\s+\((\d+)\)\s+(.+?)\s+ago$/i)))         return `Neustart (${m[1]}) vor ${translateTime(m[2])}${health}`;
  if (/^Created$/i.test(s))                                             return 'Erstellt';
  if (/^Dead$/i.test(s))                                                return 'Tot';
  if (/^Paused$/i.test(s))                                              return `Pausiert${health}`;
  if (/^Removal In Progress$/i.test(s))                                 return 'Wird entfernt';
  return s + health;
}
