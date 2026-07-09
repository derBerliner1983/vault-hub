import { randomBytes } from 'crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { userQueries, auditQueries, deviceSessionQueries } from '../db/index';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateSecret, verifyToken, otpauthUrl } from '../lib/totp';

// ── Brute-force protection: 5 attempts per 15 min per IP ──
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const TRUSTED_COOKIE = 'trusted_device';
const TRUSTED_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function checkRateLimit(ip: string): { blocked: boolean; waitMinutes: number } {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now >= rec.resetAt) return { blocked: false, waitMinutes: 0 };
  if (rec.count >= RATE_LIMIT) {
    return { blocked: true, waitMinutes: Math.ceil((rec.resetAt - now) / 60000) };
  }
  return { blocked: false, waitMinutes: 0 };
}

function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) ?? { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now >= rec.resetAt) { rec.count = 0; rec.resetAt = now + RATE_WINDOW_MS; }
  rec.count++;
  loginAttempts.set(ip, rec);
}

function generateDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { username: string; password: string; token?: string } }>('/api/auth/login', async (req, reply) => {
    const { username, password, token: otp } = req.body ?? {};
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    const ip = req.ip ?? 'unknown';
    const { blocked, waitMinutes } = checkRateLimit(ip);
    if (blocked) {
      return reply.status(429).send({ error: `Zu viele Fehlversuche. Bitte in ${waitMinutes} Minuten erneut versuchen.`, errorKey: 'err.too_many_attempts', errorVars: { minutes: waitMinutes } });
    }

    const user = userQueries.getByUsername.get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      recordFailedAttempt(ip);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Second factor (TOTP) if enabled for this account
    if (user.totp_enabled && user.totp_secret) {
      // Check trusted device cookie first
      const trustedToken = req.cookies?.[TRUSTED_COOKIE];
      let isTrusted = false;
      if (trustedToken) {
        const session = deviceSessionQueries.getByToken.get(trustedToken);
        if (session && session.user_id === user.id) {
          deviceSessionQueries.touchLastSeen.run(session.id);
          isTrusted = true;
        }
      }

      if (!isTrusted) {
        if (!otp) {
          return reply.send({ totpRequired: true });
        }
        if (!verifyToken(user.totp_secret, otp)) {
          recordFailedAttempt(ip);
          return reply.status(401).send({ error: 'Ungültiger 2FA-Code', totpRequired: true });
        }
        // Successful 2FA — create trusted device session
        const deviceToken = generateDeviceToken();
        const ua = req.headers['user-agent'] ?? null;
        deviceSessionQueries.create.run(user.id, deviceToken, ua, ip);
        reply.setCookie(TRUSTED_COOKIE, deviceToken, {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          maxAge: TRUSTED_MAX_AGE,
          path: '/',
        });
      }
    }

    // Clear rate-limit record on success
    loginAttempts.delete(ip);

    const jwtToken = fastify.jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      { expiresIn: '24h' }
    );

    auditQueries.log.run(user.id, 'login', null);

    reply
      .setCookie('token', jwtToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60,
        path: '/',
      })
      .send({ user: { id: user.id, username: user.username, role: user.role }, token: jwtToken });
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    // Revoke the trusted device session for this device on logout
    const trustedToken = req.cookies?.[TRUSTED_COOKIE];
    if (trustedToken) {
      const session = deviceSessionQueries.getByToken.get(trustedToken);
      if (session) deviceSessionQueries.revoke.run(session.id);
    }
    reply
      .clearCookie('token', { path: '/' })
      .clearCookie(TRUSTED_COOKIE, { path: '/' })
      .send({ ok: true });
  });

  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = userQueries.getById.get(req.user.id);
    reply.send({ user: { ...req.user, totpEnabled: !!user?.totp_enabled } });
  });

  fastify.get('/api/users', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.send({ users: userQueries.getAll.all() });
  });

  fastify.post<{ Body: { username: string; password: string; role: string } }>(
    '/api/users',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { username, password, role } = req.body ?? {};
      if (!username || !password) return reply.status(400).send({ error: 'Username and password required' });
      try {
        const hash = bcrypt.hashSync(password, 10);
        userQueries.create.run(username, hash, role || 'viewer');
        reply.status(201).send({ ok: true });
      } catch (err: unknown) {
        reply.status(400).send({ error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/users/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      if (id === req.user.id) return reply.status(400).send({ error: 'Cannot delete yourself' });
      userQueries.delete.run(id);
      reply.send({ ok: true });
    }
  );

  fastify.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/api/auth/change-password',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { currentPassword, newPassword } = req.body ?? {};
      const user = userQueries.getByUsername.get(req.user.username);
      if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
        return reply.status(401).send({ error: 'Current password incorrect' });
      }
      const hash = bcrypt.hashSync(newPassword, 10);
      userQueries.changePassword.run(hash, user.id);
      reply.send({ ok: true });
    }
  );

  // ── Two-factor authentication (TOTP) ──
  fastify.get('/api/auth/2fa/status', { preHandler: requireAuth }, async (req, reply) => {
    const user = userQueries.getById.get(req.user.id);
    reply.send({ enabled: !!user?.totp_enabled });
  });

  // Generate a fresh secret (not yet active until verified)
  fastify.post('/api/auth/2fa/setup', { preHandler: requireAuth }, async (req, reply) => {
    const secret = generateSecret();
    userQueries.setTotpSecret.run(secret, req.user.id);
    userQueries.setTotpEnabled.run(0, req.user.id);
    reply.send({ secret, otpauth: otpauthUrl(secret, req.user.username) });
  });

  // Activate 2FA by confirming a valid code
  fastify.post<{ Body: { token: string } }>('/api/auth/2fa/enable', { preHandler: requireAuth }, async (req, reply) => {
    const user = userQueries.getById.get(req.user.id);
    if (!user?.totp_secret) return reply.status(400).send({ error: 'Bitte zuerst 2FA einrichten' });
    if (!verifyToken(user.totp_secret, req.body?.token ?? '')) {
      return reply.status(400).send({ error: 'Ungültiger Code – bitte erneut versuchen' });
    }
    userQueries.setTotpEnabled.run(1, req.user.id);
    auditQueries.log.run(req.user.id, '2fa.enable', null);
    reply.send({ ok: true });
  });

  // Disable 2FA (requires current password)
  fastify.post<{ Body: { password: string } }>('/api/auth/2fa/disable', { preHandler: requireAuth }, async (req, reply) => {
    const user = userQueries.getById.get(req.user.id);
    if (!user || !bcrypt.compareSync(req.body?.password ?? '', user.password_hash)) {
      return reply.status(401).send({ error: 'Passwort falsch' });
    }
    userQueries.setTotpEnabled.run(0, req.user.id);
    userQueries.setTotpSecret.run(null, req.user.id);
    deviceSessionQueries.revokeByUser.run(user.id);
    auditQueries.log.run(req.user.id, '2fa.disable', null);
    reply.send({ ok: true });
  });

  // ── Admin: force / reset 2FA per user ──
  fastify.post<{ Params: { id: string }; Body: { required: boolean } }>(
    '/api/users/:id/2fa/require',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      userQueries.setTotpRequired.run(req.body?.required ? 1 : 0, id);
      auditQueries.log.run(req.user.id, req.body?.required ? '2fa.require' : '2fa.unrequire', String(id));
      reply.send({ ok: true });
    }
  );

  // Admin resets (disables) 2FA for a user — e.g. lost device
  fastify.post<{ Params: { id: string } }>(
    '/api/users/:id/2fa/reset',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      userQueries.setTotpEnabled.run(0, id);
      userQueries.setTotpSecret.run(null, id);
      deviceSessionQueries.revokeByUser.run(id);
      auditQueries.log.run(req.user.id, '2fa.admin-reset', String(id));
      reply.send({ ok: true });
    }
  );

  // ── Device sessions ──
  // List sessions — admin can query any user, regular users see their own
  fastify.get<{ Querystring: { userId?: string } }>(
    '/api/auth/sessions',
    { preHandler: requireAuth },
    async (req, reply) => {
      const targetId = req.query.userId ? parseInt(req.query.userId) : req.user.id;
      if (targetId !== req.user.id && req.user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const sessions = deviceSessionQueries.getByUser.all(targetId);
      reply.send({ sessions });
    }
  );

  // Admin: list all sessions across all users
  fastify.get('/api/auth/sessions/all', { preHandler: requireAdmin }, async (_req, reply) => {
    const sessions = deviceSessionQueries.getAll.all();
    reply.send({ sessions });
  });

  // Revoke a specific session
  fastify.delete<{ Params: { id: string } }>(
    '/api/auth/sessions/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const sessions = deviceSessionQueries.getByUser.all(req.user.id);
      const own = sessions.find((s) => s.id === id);
      if (!own && req.user.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      deviceSessionQueries.revoke.run(id);
      reply.send({ ok: true });
    }
  );

  // Revoke all sessions for a user (admin only for other users)
  fastify.delete<{ Params: { id: string } }>(
    '/api/users/:id/sessions',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      deviceSessionQueries.revokeByUser.run(id);
      auditQueries.log.run(req.user.id, 'sessions.revoke-all', String(id));
      reply.send({ ok: true });
    }
  );
}
