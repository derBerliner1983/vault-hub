import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { prefsQueries } from '../db/index';

/**
 * Pro-Benutzer UI-Einstellungen (z.B. Sortierung von Sidebar und Panels).
 * Gespeichert als ein JSON-Objekt je Benutzer. Beliebige Schlüssel/Werte;
 * das Frontend legt die Struktur fest (z.B. { sidebarOrder, panelOrder }).
 */
export async function prefsRoutes(fastify: FastifyInstance) {
  // Alle Einstellungen des angemeldeten Benutzers laden
  fastify.get('/api/prefs', { preHandler: requireAuth }, async (req, reply) => {
    const row = prefsQueries.get.get(req.user.id);
    let prefs: Record<string, unknown> = {};
    if (row?.prefs) { try { prefs = JSON.parse(row.prefs); } catch { prefs = {}; } }
    reply.send({ prefs });
  });

  // Einstellungen zusammenführen (Patch) – nur die übergebenen Schlüssel werden überschrieben
  fastify.put<{ Body: { prefs?: Record<string, unknown> } }>(
    '/api/prefs',
    { preHandler: requireAuth },
    async (req, reply) => {
      const patch = req.body?.prefs;
      if (!patch || typeof patch !== 'object') return reply.status(400).send({ error: 'prefs-Objekt erforderlich' });
      const row = prefsQueries.get.get(req.user.id);
      let current: Record<string, unknown> = {};
      if (row?.prefs) { try { current = JSON.parse(row.prefs); } catch { current = {}; } }
      const merged = { ...current, ...patch };
      // Begrenzung gegen Missbrauch (max. ~64 KB)
      const json = JSON.stringify(merged);
      if (json.length > 65536) return reply.status(413).send({ error: 'Einstellungen zu groß' });
      prefsQueries.set.run(req.user.id, json);
      reply.send({ ok: true, prefs: merged });
    },
  );
}
