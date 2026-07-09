import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { notificationQueries, notifyConfigQueries, auditQueries } from '../db/index';
import { notify, sendEmail } from '../lib/notify';

export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get('/api/notifications', { preHandler: requireAuth }, async (_req, reply) => {
    const cfg = notifyConfigQueries.get.get();
    reply.send({
      notifications: notificationQueries.recent.all(),
      unread: notificationQueries.unreadCount.get()?.n ?? 0,
      config: {
        webhookUrl: cfg?.webhook_url ?? '',
        emailTo: cfg?.email_to ?? '',
        onBackup: (cfg?.on_backup ?? 1) === 1,
        onSecurity: (cfg?.on_security ?? 1) === 1,
        onContainer: (cfg?.on_container ?? 1) === 1,
        onAntivirus: (cfg?.on_antivirus ?? 1) === 1,
        smtpHost: cfg?.smtp_host ?? '',
        smtpPort: cfg?.smtp_port ?? null,
        smtpUser: cfg?.smtp_user ?? '',
        smtpFrom: cfg?.smtp_from ?? '',
        smtpSecure: (cfg?.smtp_secure ?? 0) === 1,
        smtpConfigured: !!cfg?.smtp_host,
      },
    });
  });

  // SMTP-Konfiguration speichern (Passwort nur überschreiben, wenn neu angegeben)
  fastify.post<{ Body: { smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPass?: string; smtpFrom?: string; smtpSecure?: boolean } }>(
    '/api/notifications/smtp',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const b = req.body ?? {};
      const cur = notifyConfigQueries.get.get();
      // Leeres Passwort → bestehendes behalten
      const pass = (b.smtpPass && b.smtpPass.length > 0) ? b.smtpPass : (cur?.smtp_pass ?? null);
      notifyConfigQueries.updateSmtp.run(
        b.smtpHost?.trim() || null,
        b.smtpPort ? Number(b.smtpPort) : null,
        b.smtpUser?.trim() || null,
        pass,
        b.smtpFrom?.trim() || null,
        b.smtpSecure ? 1 : 0,
      );
      auditQueries.log.run(req.user.id, 'notifications.smtp', b.smtpHost ?? null);
      reply.send({ ok: true });
    }
  );

  // Test-E-Mail an eine angegebene Adresse senden
  fastify.post<{ Body: { to?: string } }>(
    '/api/notifications/smtp/test',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const cfg = notifyConfigQueries.get.get();
      const to = (req.body?.to?.trim()) || cfg?.email_to || '';
      if (!cfg || !to) return reply.status(400).send({ error: 'Keine Empfängeradresse angegeben' });
      const ok = await sendEmail(cfg, to, 'Test-E-Mail', 'Wenn du diese E-Mail erhältst, funktioniert der E-Mail-Versand von Vault-Hub.');
      if (!ok) return reply.status(500).send({ error: 'Versand fehlgeschlagen – SMTP-Daten prüfen oder lokales Mail-System fehlt.' });
      auditQueries.log.run(req.user.id, 'notifications.smtp.test', to);
      reply.send({ ok: true });
    }
  );

  fastify.post('/api/notifications/read', { preHandler: requireAuth }, async (_req, reply) => {
    notificationQueries.markAllRead.run();
    reply.send({ ok: true });
  });

  fastify.delete('/api/notifications', { preHandler: requireAuth }, async (_req, reply) => {
    notificationQueries.clear.run();
    reply.send({ ok: true });
  });

  fastify.post<{ Body: { webhookUrl?: string; emailTo?: string; onBackup?: boolean; onSecurity?: boolean; onContainer?: boolean; onAntivirus?: boolean } }>(
    '/api/notifications/config',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const b = req.body ?? {};
      notifyConfigQueries.update.run(
        b.webhookUrl?.trim() || null,
        b.emailTo?.trim() || null,
        b.onBackup === false ? 0 : 1,
        b.onSecurity === false ? 0 : 1,
        b.onContainer === false ? 0 : 1,
        b.onAntivirus === false ? 0 : 1,
      );
      auditQueries.log.run(req.user.id, 'notifications.config', null);
      reply.send({ ok: true });
    }
  );

  fastify.post('/api/notifications/test', { preHandler: requireAdmin }, async (req, reply) => {
    await notify('info', 'Test-Benachrichtigung', 'Wenn du das siehst, funktionieren die Benachrichtigungen von Vault-Hub.', 'test');
    auditQueries.log.run(req.user.id, 'notifications.test', null);
    reply.send({ ok: true });
  });
}
