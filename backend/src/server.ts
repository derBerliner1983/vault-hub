import crypto from 'node:crypto';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import './types';
import { auditQueries } from './db/index';
import { APP_VERSION } from './routes/settings';
import { authRoutes } from './routes/auth';
import { settingsRoutes } from './routes/settings';
import { prefsRoutes } from './routes/prefs';
import { pluginRoutes } from './routes/plugins';
import { storeRoutes } from './routes/store';

// JWT_SECRET kommt im Produktivbetrieb aus der Env-Datei (install.sh erzeugt
// einen dauerhaften, starken Schlüssel). Fällt der weg, wird ein kryptografisch
// starker Zufallswert genutzt (statt des früheren schwachen Math.random).
const JWT_SECRET = process.env.JWT_SECRET ?? crypto.randomBytes(48).toString('hex');
const PORT = parseInt(process.env.PORT ?? '4300');
const HOST = process.env.HOST ?? '0.0.0.0';
const IS_DEV = process.env.NODE_ENV !== 'production';

const fastify = Fastify({
  logger: IS_DEV
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : true,
});

async function main() {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyMultipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
  await fastify.register(fastifyWebsocket);

  await fastify.register(fastifyJwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });

  await fastify.register(fastifyCors, {
    origin: IS_DEV ? ['http://localhost:5173'] : false,
    credentials: true,
  });

  // Health check endpoint (no auth required – for monitoring tools)
  fastify.get('/health', async (_req, reply) => {
    reply.send({ ok: true, version: APP_VERSION, uptime: Math.floor(process.uptime()), ts: new Date().toISOString() });
  });

  await fastify.register(authRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(prefsRoutes);
  await fastify.register(pluginRoutes);
  await fastify.register(storeRoutes);

  const frontendDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    await fastify.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });
    // SPA-Fallback NUR für echte Navigationsanfragen (HTML). Fehlende Assets
    // (/assets/*, *.js, *.css, /api/*) dürfen NICHT index.html zurückgeben –
    // sonst bekommt der Browser HTML als JS-Modul ("MIME type text/html") und
    // die Seite bleibt weiß. Stattdessen ein ehrlicher 404.
    fastify.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0];
      const accepts = (req.headers['accept'] || '').includes('text/html');
      const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(url);
      if (req.method !== 'GET' || url.startsWith('/api/') || url.startsWith('/assets/') || looksLikeFile || !accepts) {
        reply.status(404).send({ error: 'Not found', path: url });
        return;
      }
      reply.type('text/html').sendFile('index.html');
    });
  }

  await fastify.listen({ port: PORT, host: HOST });
  console.log(`\n⬡ Vault-Hub running at http://localhost:${PORT} (proxied via Caddy → https)\n`);

  // Audit-log rotation – delete entries older than 90 days, runs daily
  const pruneAuditLog = () => {
    try {
      auditQueries.pruneOld.run();
    } catch { /* non-critical */ }
  };
  pruneAuditLog();
  setInterval(pruneAuditLog, 24 * 60 * 60 * 1000);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
