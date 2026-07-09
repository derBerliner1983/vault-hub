import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries } from '../db/index';

interface InstalledPackage {
  name: string;
  version: string;
  size: number; // Bytes
  summary: string;
  auto: boolean; // automatisch als Abhängigkeit installiert (kein manuell gewähltes Paket)
}

interface SearchResult {
  name: string;
  summary: string;
  installed: boolean;
}

/** Erkennt den System-Paketmanager. */
function detectPM(): 'apt' | 'dnf' | 'pacman' | null {
  if (hasBinary('apt-get')) return 'apt';
  if (hasBinary('dnf')) return 'dnf';
  if (hasBinary('pacman')) return 'pacman';
  return null;
}

/** Erlaubte Zeichen in Paketnamen – verhindert Shell-Injection. */
function sanitizePkgs(list: string[] | undefined): string[] {
  return (list ?? [])
    .map((p) => p.replace(/[^a-zA-Z0-9._+:-]/g, ''))
    .filter(Boolean);
}

function listApt(): InstalledPackage[] {
  // db:Status-Abbrev = z. B. "ii" für vollständig installiert
  const out = safeExec(
    "dpkg-query -W -f='${db:Status-Abbrev}\\t${Package}\\t${Version}\\t${Installed-Size}\\t${binary:Summary}\\n' 2>/dev/null",
    15000,
  );
  // Automatisch (als Abhängigkeit) installierte Pakete ermitteln
  const autoRaw = safeExec('apt-mark showauto 2>/dev/null', 10000);
  const autoSet = new Set(autoRaw.split('\n').map((l) => l.trim()).filter(Boolean));

  const pkgs: InstalledPackage[] = [];
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const status = parts[0].trim();
    if (!status.startsWith('ii')) continue;
    const name = parts[1].trim();
    if (!name) continue;
    const sizeKb = parseInt(parts[3], 10) || 0;
    pkgs.push({
      name,
      version: parts[2].trim(),
      size: sizeKb * 1024,
      summary: (parts[4] ?? '').trim().slice(0, 160),
      auto: autoSet.has(name),
    });
  }
  return pkgs;
}

function listRpm(): InstalledPackage[] {
  const out = safeExec(
    "rpm -qa --qf '%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{SIZE}\\t%{SUMMARY}\\n' 2>/dev/null",
    15000,
  );
  const userRaw = safeExec('dnf -q repoquery --userinstalled 2>/dev/null', 12000);
  const userSet = new Set(
    userRaw.split('\n').map((l) => l.trim().replace(/-\d.*$/, '')).filter(Boolean),
  );
  const pkgs: InstalledPackage[] = [];
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const name = parts[0].trim();
    if (!name) continue;
    pkgs.push({
      name,
      version: parts[1].trim(),
      size: parseInt(parts[2], 10) || 0,
      summary: (parts[3] ?? '').trim().slice(0, 160),
      auto: userSet.size > 0 ? !userSet.has(name) : false,
    });
  }
  return pkgs;
}

function listPacman(): InstalledPackage[] {
  const out = safeExec('pacman -Q 2>/dev/null', 12000);
  const explicitRaw = safeExec('pacman -Qeq 2>/dev/null', 10000);
  const explicitSet = new Set(explicitRaw.split('\n').map((l) => l.trim()).filter(Boolean));
  const pkgs: InstalledPackage[] = [];
  for (const line of out.split('\n')) {
    const [name, version] = line.trim().split(/\s+/);
    if (!name) continue;
    pkgs.push({
      name,
      version: version ?? '',
      size: 0,
      summary: '',
      auto: explicitSet.size > 0 ? !explicitSet.has(name) : false,
    });
  }
  return pkgs;
}

export async function packageRoutes(fastify: FastifyInstance) {
  // Installierte Pakete auflisten
  fastify.get('/api/system/packages', { preHandler: requireAuth }, async (_req, reply) => {
    const pm = detectPM();
    if (!pm) return reply.send({ available: false, manager: null, packages: [], count: 0 });
    let packages: InstalledPackage[] = [];
    try {
      if (pm === 'apt') packages = listApt();
      else if (pm === 'dnf') packages = listRpm();
      else packages = listPacman();
    } catch { /* leere Liste bei Fehler */ }
    packages.sort((a, b) => a.name.localeCompare(b.name));
    return reply.send({ available: true, manager: pm, packages, count: packages.length });
  });

  // Verfügbare Pakete zur Installation suchen
  fastify.get<{ Querystring: { q?: string } }>(
    '/api/system/packages/search',
    { preHandler: requireAuth },
    async (req, reply) => {
      const pm = detectPM();
      if (!pm) return reply.send({ results: [] });
      const q = (req.query.q ?? '').replace(/[^a-zA-Z0-9._+-]/g, '').slice(0, 60);
      if (q.length < 2) return reply.send({ results: [] });

      const results: SearchResult[] = [];
      try {
        if (pm === 'apt') {
          const out = safeExec(`apt-cache search ${q} 2>/dev/null | head -50`, 12000);
          for (const line of out.split('\n')) {
            const m = line.match(/^(\S+)\s+-\s+(.*)$/);
            if (m) {
              const installed = safeExec(`dpkg-query -W -f='\${db:Status-Abbrev}' ${m[1]} 2>/dev/null`).trim().startsWith('ii');
              results.push({ name: m[1], summary: m[2].slice(0, 160), installed });
            }
          }
        } else if (pm === 'dnf') {
          const out = safeExec(`dnf -q search ${q} 2>/dev/null | head -50`, 15000);
          for (const line of out.split('\n')) {
            const m = line.match(/^(\S+?)\.\S+\s+:\s+(.*)$/);
            if (m) results.push({ name: m[1], summary: m[2].slice(0, 160), installed: false });
          }
        } else {
          const out = safeExec(`pacman -Ss ${q} 2>/dev/null | head -100`, 12000);
          const lines = out.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const head = lines[i].match(/^\S+\/(\S+)\s+\S+(\s+\[installiert\]|\s+\[installed\])?/);
            if (head) {
              const summary = (lines[i + 1] ?? '').trim();
              results.push({ name: head[1], summary: summary.slice(0, 160), installed: !!head[2] });
            }
          }
        }
      } catch { /* leeres Ergebnis */ }
      return reply.send({ results: results.slice(0, 50) });
    },
  );

  // Pakete installieren
  fastify.post<{ Body: { packages?: string[] } }>(
    '/api/system/packages/install',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const pm = detectPM();
      if (!pm) return reply.status(400).send({ error: 'Kein Paketmanager' });
      const pkgs = sanitizePkgs(req.body?.packages);
      if (!pkgs.length) return reply.status(400).send({ error: 'Keine Pakete angegeben' });
      try {
        let cmd: string;
        if (pm === 'apt') {
          const dpkgOpts = '-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold';
          cmd = `/bin/bash -c "DEBIAN_FRONTEND=noninteractive apt-get install -y ${dpkgOpts} ${pkgs.join(' ')}"`;
        } else if (pm === 'dnf') {
          cmd = `dnf -y install ${pkgs.join(' ')}`;
        } else {
          cmd = `pacman -S --noconfirm ${pkgs.join(' ')}`;
        }
        const output = privExec(cmd, { timeout: 600000 });
        auditQueries.log.run(req.user.id, 'system.package.install', pkgs.join(','));
        reply.send({ ok: true, output: output.slice(-4000) });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Installation fehlgeschlagen';
        reply.status(500).send({ error: msg.includes('sudo') ? 'Keine Root-Rechte – bitte einmal „sudo bash install.sh --fix-perms“ ausführen (aktualisiert die sudoers-Rechte).' : msg });
      }
    },
  );

  // Pakete entfernen (optional inkl. Konfiguration / purge)
  fastify.post<{ Body: { packages?: string[]; purge?: boolean } }>(
    '/api/system/packages/remove',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const pm = detectPM();
      if (!pm) return reply.status(400).send({ error: 'Kein Paketmanager' });
      const pkgs = sanitizePkgs(req.body?.packages);
      if (!pkgs.length) return reply.status(400).send({ error: 'Keine Pakete angegeben' });
      const purge = req.body?.purge === true;
      try {
        let cmd: string;
        if (pm === 'apt') {
          const dpkgOpts = '-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold';
          const action = purge ? 'purge' : 'remove';
          cmd = `/bin/bash -c "DEBIAN_FRONTEND=noninteractive apt-get ${action} -y ${dpkgOpts} ${pkgs.join(' ')}"`;
        } else if (pm === 'dnf') {
          cmd = `dnf -y remove ${pkgs.join(' ')}`;
        } else {
          cmd = `pacman -R --noconfirm ${pkgs.join(' ')}`;
        }
        const output = privExec(cmd, { timeout: 600000 });
        auditQueries.log.run(req.user.id, purge ? 'system.package.purge' : 'system.package.remove', pkgs.join(','));
        reply.send({ ok: true, output: output.slice(-4000) });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Entfernen fehlgeschlagen';
        reply.status(500).send({ error: msg.includes('sudo') ? 'Keine Root-Rechte – bitte einmal „sudo bash install.sh --fix-perms“ ausführen (aktualisiert die sudoers-Rechte).' : msg });
      }
    },
  );
}
