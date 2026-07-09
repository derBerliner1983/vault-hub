import { execFileSync } from 'child_process';
import nodemailer from 'nodemailer';
import { notificationQueries, notifyConfigQueries, type NotifyConfigRow } from '../db/index';
import { hasBinary } from './privilege';

export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';
export type NotifyEvent = 'backup' | 'security' | 'container' | 'antivirus' | 'test';

const EMOJI: Record<NotifyLevel, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '🚨' };

function eventEnabled(cfg: NotifyConfigRow, event: NotifyEvent): boolean {
  switch (event) {
    case 'backup': return cfg.on_backup === 1;
    case 'security': return cfg.on_security === 1;
    case 'container': return cfg.on_container === 1;
    case 'antivirus': return cfg.on_antivirus === 1;
    default: return true; // test always dispatches
  }
}

async function dispatchWebhook(url: string, level: NotifyLevel, title: string, message: string): Promise<void> {
  const text = `${EMOJI[level]} **${title}**\n${message}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // content → Discord, text → Slack/Mattermost, the rest → generic consumers
      body: JSON.stringify({ content: text, text, app: 'vault-hub', level, title, message, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* webhook unreachable – ignore, already logged in DB */ }
}

/** Mehrere Empfänger aus einem Komma/Semikolon/Leerzeichen-getrennten String. */
function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

/**
 * E-Mail an die angegebenen Empfänger senden.
 * Bevorzugt SMTP (wenn konfiguriert), sonst lokales mail-Programm.
 * Gibt true zurück, wenn ein Versandweg vorhanden war.
 */
export async function sendEmail(cfg: NotifyConfigRow, recipients: string, title: string, message: string): Promise<boolean> {
  const to = parseRecipients(recipients);
  if (to.length === 0) return false;

  // 1) SMTP, falls konfiguriert
  if (cfg.smtp_host && cfg.smtp_port) {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.smtp_host,
        port: cfg.smtp_port,
        secure: cfg.smtp_secure === 1, // true für Port 465
        auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass ?? '' } : undefined,
      });
      await transporter.sendMail({
        from: cfg.smtp_from || cfg.smtp_user || 'vault-hub@localhost',
        to: to.join(', '),
        subject: `[Vault-Hub] ${title}`,
        text: message,
      });
      return true;
    } catch {
      // SMTP fehlgeschlagen → auf lokales mail zurückfallen
    }
  }

  // 2) Lokales mail/mailx
  const bin = hasBinary('mail') ? 'mail' : hasBinary('mailx') ? 'mailx' : null;
  if (!bin) return false;
  try {
    execFileSync(bin, ['-s', `[Vault-Hub] ${title}`, ...to], { input: message, timeout: 8000, stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Record a notification and dispatch it to the configured channels.
 * Always stored in the DB log; external delivery depends on the per-event toggles.
 */
export async function notify(level: NotifyLevel, title: string, message = '', event: NotifyEvent = 'test'): Promise<void> {
  try {
    notificationQueries.create.run(level, title, message || null, event);
    notificationQueries.prune.run();
  } catch { /* DB issue – never block the caller */ }

  let cfg;
  try { cfg = notifyConfigQueries.get.get(); } catch { return; }
  if (!cfg || !eventEnabled(cfg, event)) return;

  if (cfg.webhook_url) await dispatchWebhook(cfg.webhook_url, level, title, message);
  if (cfg.email_to) await sendEmail(cfg, cfg.email_to, title, message);
}
