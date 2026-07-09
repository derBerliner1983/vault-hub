import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { alertQueries, notifyConfigQueries, auditQueries, type AlertRuleRow } from '../db/index';
import { PREDEFINED_ALERTS, METRIC_OPTIONS, runAlertChecks } from '../lib/alertmonitor';
import { sendEmail } from '../lib/notify';

function ruleToDto(r: AlertRuleRow) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    ruleKey: r.rule_key,
    metric: r.metric,
    threshold: r.threshold,
    durationMin: r.duration_min,
    recipients: r.recipients ?? '',
    enabled: r.enabled === 1,
    lastTriggered: r.last_triggered,
  };
}

export async function alertRoutes(fastify: FastifyInstance) {
  fastify.get('/api/alerts', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({
      rules: alertQueries.getAll.all().map(ruleToDto),
      predefined: PREDEFINED_ALERTS,
      metrics: METRIC_OPTIONS,
    });
  });

  fastify.post<{
    Body: { name?: string; kind: string; ruleKey?: string; metric?: string; threshold?: number; durationMin?: number; recipients?: string };
  }>('/api/alerts', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body ?? { kind: '' };
    if (b.kind !== 'predefined' && b.kind !== 'metric') {
      return reply.status(400).send({ error: 'Ungültiger Regeltyp' });
    }
    if (b.kind === 'predefined' && !b.ruleKey) return reply.status(400).send({ error: 'Vordefinierte Auffälligkeit fehlt' });
    if (b.kind === 'metric' && !b.metric) return reply.status(400).send({ error: 'Metrik fehlt' });

    // Standardname ableiten, falls keiner angegeben
    let name = b.name?.trim();
    if (!name) {
      if (b.kind === 'predefined') name = PREDEFINED_ALERTS.find((p) => p.key === b.ruleKey)?.name ?? 'Alarm';
      else name = (METRIC_OPTIONS.find((m) => m.key === b.metric)?.name ?? 'Metrik') + ` > ${b.threshold ?? 90}%`;
    }

    alertQueries.create.run(
      name,
      b.kind,
      b.kind === 'predefined' ? (b.ruleKey ?? null) : null,
      b.kind === 'metric' ? (b.metric ?? null) : null,
      b.threshold != null ? Number(b.threshold) : null,
      b.durationMin != null ? Number(b.durationMin) : 0,
      b.recipients?.trim() || null,
    );
    auditQueries.log.run(req.user.id, 'alert.create', name);
    reply.status(201).send({ ok: true });
  });

  fastify.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/alerts/:id/enabled',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      if (!alertQueries.getById.get(id)) return reply.status(404).send({ error: 'Nicht gefunden' });
      alertQueries.setEnabled.run(req.body?.enabled ? 1 : 0, id);
      reply.send({ ok: true });
    }
  );

  fastify.delete<{ Params: { id: string } }>('/api/alerts/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const row = alertQueries.getById.get(id);
    if (!row) return reply.status(404).send({ error: 'Nicht gefunden' });
    alertQueries.delete.run(id);
    auditQueries.log.run(req.user.id, 'alert.delete', row.name);
    reply.send({ ok: true });
  });

  // Test: Alarm-E-Mail einer Regel sofort verschicken
  fastify.post<{ Params: { id: string } }>('/api/alerts/:id/test', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id);
    const rule = alertQueries.getById.get(id);
    if (!rule) return reply.status(404).send({ error: 'Nicht gefunden' });
    const cfg = notifyConfigQueries.get.get();
    const recipients = (rule.recipients && rule.recipients.trim()) || cfg?.email_to || '';
    if (!cfg || !recipients) return reply.status(400).send({ error: 'Keine Empfänger – Regel-Empfänger oder globale E-Mail setzen.' });
    const ok = await sendEmail(cfg, recipients, `Test-Alarm: ${rule.name}`, `Dies ist eine Test-Benachrichtigung für die Alarm-Regel "${rule.name}".\n\n– Vault-Hub`);
    if (!ok) return reply.status(500).send({ error: 'Versand fehlgeschlagen – SMTP prüfen.' });
    reply.send({ ok: true });
  });

  // Alle Regeln sofort auswerten (manuelle Prüfung)
  fastify.post('/api/alerts/check', { preHandler: requireAdmin }, async (_req, reply) => {
    await runAlertChecks();
    reply.send({ ok: true });
  });
}
