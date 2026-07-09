import si from 'systeminformation';
import Dockerode from 'dockerode';
import { alertQueries, notifyConfigQueries, notificationQueries, type AlertRuleRow } from '../db/index';
import { safeExec, privExec } from './privilege';
import { sendEmail } from './notify';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// Mindestabstand zwischen zwei E-Mails derselben Regel (Anti-Spam).
const COOLDOWN_MS = 60 * 60 * 1000; // 1 Stunde

export interface PredefinedAlert {
  key: string;
  name: string;
  description: string;
  hasThreshold?: boolean;
  thresholdLabel?: string;
  defaultThreshold?: number;
}

/** Katalog der vordefinierten Auffälligkeiten (für das UI). */
export const PREDEFINED_ALERTS: PredefinedAlert[] = [
  { key: 'ssh_root_login', name: 'SSH Root-Login erlaubt', description: 'Schlägt Alarm, wenn PermitRootLogin auf "yes" steht.' },
  { key: 'failed_logins', name: 'Fehlgeschlagene Logins / gesperrte IPs', description: 'Schlägt Alarm, wenn fail2ban IPs gesperrt hat.', hasThreshold: true, thresholdLabel: 'gesperrte IPs ab', defaultThreshold: 1 },
  { key: 'risky_ports', name: 'Riskante offene Ports', description: 'Schlägt Alarm bei öffentlich erreichbaren Risiko-Ports (Telnet, RDP, ungesicherte DB-Ports).' },
  { key: 'low_score', name: 'Sicherheits-Score zu niedrig', description: 'Schlägt Alarm, wenn der Security-Score unter den Schwellwert fällt.', hasThreshold: true, thresholdLabel: 'Score unter', defaultThreshold: 65 },
  { key: 'priv_container', name: 'Privilegierte Container', description: 'Schlägt Alarm, wenn privilegierte Docker-Container laufen.' },
  { key: 'fw_blocked', name: 'Blockierte Verbindungen (Firewall)', description: 'Schlägt Alarm, wenn die Firewall in der letzten Stunde auffällig viele Zugriffe blockiert hat (nur wenn aktiviert).', hasThreshold: true, thresholdLabel: 'blockierte Verbindungen ab', defaultThreshold: 20 },
];

export interface MetricOption {
  key: string;
  name: string;
  unit: string;
}
export const METRIC_OPTIONS: MetricOption[] = [
  { key: 'cpu', name: 'CPU-Auslastung', unit: '%' },
  { key: 'ram', name: 'RAM-Auslastung', unit: '%' },
  { key: 'disk', name: 'Festplatten-Belegung (/)', unit: '%' },
];

const RISKY_PORTS = new Set(['23', '21', '3389', '5900', '3306', '5432', '27017', '6379', '9200', '11211']);

/** Ergebnis einer Regelauswertung: Bedingung erfüllt? + Detailtext. */
interface EvalResult {
  breached: boolean;
  detail: string;
}

async function getMetricPercent(metric: string): Promise<number> {
  if (metric === 'cpu') {
    const l = await si.currentLoad();
    return Math.round(l.currentLoad);
  }
  if (metric === 'ram') {
    const m = await si.mem();
    const used = (m.active && m.active > 0) ? m.active : m.used;
    return Math.round((used / m.total) * 100);
  }
  if (metric === 'disk') {
    const fs = await si.fsSize();
    const root = fs.find((f) => f.mount === '/') ?? fs[0];
    return root ? Math.round(root.use) : 0;
  }
  return 0;
}

function evalPredefinedSync(rule: AlertRuleRow): EvalResult | null {
  switch (rule.rule_key) {
    case 'ssh_root_login': {
      const conf = safeExec('cat /etc/ssh/sshd_config 2>/dev/null') + '\n' + safeExec('cat /etc/ssh/sshd_config.d/*.conf 2>/dev/null');
      const v = conf.match(/^\s*PermitRootLogin\s+(\S+)/im)?.[1]?.toLowerCase();
      return { breached: v === 'yes', detail: `PermitRootLogin ${v ?? 'unbekannt'}` };
    }
    case 'failed_logins': {
      const out = safeExec('fail2ban-client status sshd 2>/dev/null');
      const banned = parseInt(out.match(/Currently banned:\s*(\d+)/)?.[1] ?? '0');
      const limit = rule.threshold ?? 1;
      return { breached: banned >= limit, detail: `${banned} gesperrte IP(s) (Schwelle ${limit})` };
    }
    case 'risky_ports': {
      const out = safeExec('ss -tlnH 2>/dev/null');
      const open = out.split('\n')
        .map((l) => l.trim().split(/\s+/)[3])
        .filter((a) => a && (a.startsWith('0.0.0.0') || a.startsWith('*') || a.startsWith('[::]')))
        .map((a) => a.split(':').pop() ?? '')
        .filter((p) => RISKY_PORTS.has(p));
      const unique = [...new Set(open)];
      return { breached: unique.length > 0, detail: unique.length ? `Riskante Ports offen: ${unique.join(', ')}` : 'keine riskanten Ports' };
    }
    case 'fw_blocked': {
      const limit = rule.threshold ?? 20;
      const readCount = (cmd: string): number => {
        try { return parseInt(privExec(cmd, { timeout: 8000 }).toString().trim()) || 0; } catch { return 0; }
      };
      // Blockierungen der letzten 60 Minuten aus dem Kernel-Journal …
      let count = readCount('bash -c "journalctl -k --since \\"60 min ago\\" --no-pager 2>/dev/null | grep -c -i \\"UFW BLOCK\\" || true"');
      // … sonst grob aus dem UFW-Log (letzte Zeilen)
      if (count === 0) count = readCount('bash -c "tail -n 3000 /var/log/ufw.log 2>/dev/null | grep -c -i \\"UFW BLOCK\\" || true"');
      return { breached: count >= limit, detail: `${count} blockierte Verbindung(en) in der letzten Stunde (Schwelle ${limit})` };
    }
    default:
      return null;
  }
}

async function evalPredefinedAsync(rule: AlertRuleRow): Promise<EvalResult | null> {
  if (rule.rule_key === 'priv_container') {
    try {
      const containers = await docker.listContainers({ all: false });
      const priv: string[] = [];
      await Promise.all(containers.map(async (c) => {
        const info = await docker.getContainer(c.Id).inspect().catch(() => null);
        if (info?.HostConfig?.Privileged) priv.push(info.Name.replace(/^\//, ''));
      }));
      return { breached: priv.length > 0, detail: priv.length ? `Privilegiert: ${priv.join(', ')}` : 'keine privilegierten Container' };
    } catch {
      return { breached: false, detail: 'Docker nicht verfügbar' };
    }
  }
  if (rule.rule_key === 'low_score') {
    const score = await quickSecurityScore();
    const limit = rule.threshold ?? 65;
    return { breached: score < limit, detail: `Score ${score} (Schwelle ${limit})` };
  }
  return null;
}

/** Schlanke Score-Berechnung für den Alarm (unabhängig vom UI-Scan). */
async function quickSecurityScore(): Promise<number> {
  let critical = 0;
  let warn = 0;
  const conf = safeExec('cat /etc/ssh/sshd_config 2>/dev/null') + '\n' + safeExec('cat /etc/ssh/sshd_config.d/*.conf 2>/dev/null');
  if (conf.match(/^\s*PermitRootLogin\s+yes/im)) critical++;
  if (!/^\s*PasswordAuthentication\s+no/im.test(conf) && conf.trim()) warn++;
  const ufw = safeExec('ufw status 2>/dev/null');
  if (ufw && !/Status:\s*active/i.test(ufw)) critical++;
  if (safeExec('systemctl is-active fail2ban 2>/dev/null').trim() !== 'active') warn++;
  try {
    const containers = await docker.listContainers({ all: false });
    let priv = 0;
    await Promise.all(containers.map(async (c) => {
      const info = await docker.getContainer(c.Id).inspect().catch(() => null);
      if (info?.HostConfig?.Privileged) priv++;
    }));
    if (priv > 0) critical++;
  } catch { /* docker off */ }
  return Math.max(0, Math.min(100, 100 - critical * 20 - warn * 8));
}

async function evaluateRule(rule: AlertRuleRow): Promise<EvalResult> {
  if (rule.kind === 'metric' && rule.metric) {
    const value = await getMetricPercent(rule.metric);
    const limit = rule.threshold ?? 90;
    const opt = METRIC_OPTIONS.find((m) => m.key === rule.metric);
    return { breached: value >= limit, detail: `${opt?.name ?? rule.metric}: ${value}% (Schwelle ${limit}%)` };
  }
  const sync = evalPredefinedSync(rule);
  if (sync) return sync;
  const asyncRes = await evalPredefinedAsync(rule);
  if (asyncRes) return asyncRes;
  return { breached: false, detail: '' };
}

async function fireAlert(rule: AlertRuleRow, detail: string): Promise<void> {
  const cfg = notifyConfigQueries.get.get();
  const recipients = (rule.recipients && rule.recipients.trim()) || cfg?.email_to || '';
  const title = `Alarm: ${rule.name}`;
  const message = `Eine Sicherheits-/System-Regel hat ausgelöst.\n\nRegel: ${rule.name}\nDetails: ${detail}\nZeitpunkt: ${new Date().toLocaleString('de-DE')}\n\n– Vault-Hub`;

  // In der Oberfläche protokollieren
  try {
    notificationQueries.create.run('warning', title, message, 'security');
    notificationQueries.prune.run();
  } catch { /* */ }

  // E-Mail an die Empfänger der Regel (oder global)
  if (cfg && recipients) {
    await sendEmail(cfg, recipients, title, message);
  }

  alertQueries.setTriggered.run(new Date().toISOString(), rule.id);
}

let running = false;

/** Einmalige Auswertung aller aktiven Regeln. */
export async function runAlertChecks(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rules = alertQueries.getEnabled.all();
    for (const rule of rules) {
      let result: EvalResult;
      try {
        result = await evaluateRule(rule);
      } catch {
        continue;
      }

      if (!result.breached) {
        // Bedingung nicht (mehr) erfüllt → Breach-Timer zurücksetzen
        if (rule.breach_since) alertQueries.setBreachSince.run(null, rule.id);
        continue;
      }

      // Bedingung erfüllt → Dauer prüfen
      const now = Date.now();
      if (!rule.breach_since) {
        alertQueries.setBreachSince.run(new Date().toISOString(), rule.id);
      }
      const breachStart = rule.breach_since ? new Date(rule.breach_since).getTime() : now;
      const durationMs = (rule.duration_min ?? 0) * 60 * 1000;
      if (now - breachStart < durationMs) continue; // noch nicht lange genug

      // Cooldown prüfen
      const last = rule.last_triggered ? new Date(rule.last_triggered).getTime() : 0;
      if (now - last < COOLDOWN_MS) continue;

      await fireAlert(rule, result.detail);
    }
  } finally {
    running = false;
  }
}

/** Startet die periodische Überwachung (alle 60 s). */
export function startAlertMonitor(): void {
  setInterval(() => { void runAlertChecks(); }, 60_000);
}
