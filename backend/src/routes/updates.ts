import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries } from '../db/index';

interface PackageUpdate {
  name: string;
  currentVersion: string;
  newVersion: string;
  repo: string;
}

/** Detect the system package manager. */
function detectPM(): 'apt' | 'dnf' | 'pacman' | null {
  if (hasBinary('apt-get')) return 'apt';
  if (hasBinary('dnf')) return 'dnf';
  if (hasBinary('pacman')) return 'pacman';
  return null;
}

function parseAptUpgradable(out: string): PackageUpdate[] {
  const updates: PackageUpdate[] = [];
  for (const line of out.split('\n')) {
    // Format: pkg/repo newver arch [upgradable from: oldver]
    const m = line.match(/^([^/]+)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from:\s+([^\]]+)\]/);
    if (m) {
      updates.push({ name: m[1], repo: m[2], newVersion: m[3], currentVersion: m[4] });
    }
  }
  return updates;
}

export async function updateRoutes(fastify: FastifyInstance) {
  // List available system (OS) updates
  fastify.get('/api/system/updates', { preHandler: requireAuth }, async (_req, reply) => {
    const pm = detectPM();
    if (!pm) return reply.send({ available: false, manager: null, updates: [], message: 'Kein unterstützter Paketmanager' });

    if (pm === 'apt') {
      const out = safeExec('apt list --upgradable 2>/dev/null', 10000);
      const updates = parseAptUpgradable(out);
      const reboot = safeExec('test -f /var/run/reboot-required && echo yes').trim() === 'yes';
      return reply.send({ available: true, manager: 'apt', updates, count: updates.length, rebootRequired: reboot });
    }
    if (pm === 'dnf') {
      const out = safeExec('dnf -q check-update 2>/dev/null', 15000);
      const updates: PackageUpdate[] = out.split('\n')
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p.length >= 3 && p[0].includes('.'))
        .map((p) => ({ name: p[0], currentVersion: '', newVersion: p[1], repo: p[2] }));
      return reply.send({ available: true, manager: 'dnf', updates, count: updates.length, rebootRequired: false });
    }
    // pacman
    const out = safeExec('pacman -Qu 2>/dev/null', 10000);
    const updates: PackageUpdate[] = out.split('\n').filter(Boolean).map((l) => {
      const p = l.split(/\s+/);
      return { name: p[0], currentVersion: p[1] ?? '', newVersion: p[3] ?? '', repo: '' };
    });
    return reply.send({ available: true, manager: 'pacman', updates, count: updates.length, rebootRequired: false });
  });

  // Refresh package index (apt update)
  fastify.post('/api/system/updates/check', { preHandler: requireAdmin }, async (req, reply) => {
    const pm = detectPM();
    if (!pm) return reply.status(400).send({ error: 'Kein Paketmanager' });
    try {
      if (pm === 'apt') privExec('apt-get update', { timeout: 120000 });
      else if (pm === 'dnf') privExec('dnf -q makecache', { timeout: 120000 });
      else privExec('pacman -Sy', { timeout: 120000 });
      auditQueries.log.run(req.user.id, 'system.update.check', pm);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Update-Check fehlgeschlagen' });
    }
  });

  // Apply updates (all, or specific packages)
  fastify.post<{ Body: { packages?: string[] } }>(
    '/api/system/updates/apply',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const pm = detectPM();
      if (!pm) return reply.status(400).send({ error: 'Kein Paketmanager' });
      const pkgs = (req.body?.packages ?? [])
        .map((p) => p.replace(/[^a-zA-Z0-9._+-]/g, ''))
        .filter(Boolean);
      try {
        let cmd: string;
        if (pm === 'apt') {
          // DEBIAN_FRONTEND muss innerhalb eines bash -c gesetzt werden – sonst
          // lehnt sudo die Env-Variable als nicht erlaubt ab (/bin/bash ist in der Allowlist).
          const dpkgOpts = '-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold';
          const inner = pkgs.length
            ? `DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${dpkgOpts} ${pkgs.join(' ')}`
            : `DEBIAN_FRONTEND=noninteractive apt-get upgrade -y ${dpkgOpts}`;
          cmd = `/bin/bash -c "${inner}"`;
        } else if (pm === 'dnf') {
          cmd = pkgs.length ? `dnf -y upgrade ${pkgs.join(' ')}` : 'dnf -y upgrade';
        } else {
          cmd = pkgs.length ? `pacman -S --noconfirm ${pkgs.join(' ')}` : 'pacman -Su --noconfirm';
        }
        const output = privExec(cmd, { timeout: 600000 });
        auditQueries.log.run(req.user.id, 'system.update.apply', pkgs.join(',') || 'all');
        reply.send({ ok: true, output: output.slice(-4000) });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Update fehlgeschlagen';
        reply.status(500).send({ error: msg.includes('sudo') ? 'Keine Root-Rechte – bitte einmal „sudo bash install.sh --fix-perms“ ausführen (aktualisiert die sudoers-Rechte).' : msg });
      }
    }
  );
}
