import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { safeExec, privExec, hasBinary, isRoot } from '../lib/privilege';
import { auditQueries } from '../db/index';
import { notify } from '../lib/notify';

interface Infected {
  file: string;
  virus: string;
}

interface ScanState {
  running: boolean;
  path: string;
  startedAt?: string;
  finishedAt?: string;
  scanned: number;
  infected: Infected[];
  error?: string;
}

let scan: ScanState = { running: false, path: '', scanned: 0, infected: [] };

function spawnPriv(bin: string, args: string[]) {
  return isRoot ? spawn(bin, args) : spawn('sudo', ['-n', bin, ...args]);
}

/** Age (days) of the virus definition database, or null if unknown. */
function defsAgeDays(): number | null {
  const ts = safeExec("stat -c %Y /var/lib/clamav/daily.cvd /var/lib/clamav/daily.cld 2>/dev/null | sort -n | tail -1").trim();
  if (!ts) return null;
  return Math.floor((Date.now() / 1000 - parseInt(ts)) / 86400);
}

function avStatus() {
  const installed = hasBinary('clamscan') || hasBinary('clamdscan');
  const daemonActive = safeExec('systemctl is-active clamav-daemon 2>/dev/null').trim() === 'active';
  const freshclamActive = safeExec('systemctl is-active clamav-freshclam 2>/dev/null').trim() === 'active';
  const version = installed ? safeExec('clamscan --version 2>/dev/null').trim() : '';
  return {
    installed,
    daemonActive,
    freshclamActive,
    version,
    defsAgeDays: defsAgeDays(),
  };
}

export async function antivirusRoutes(fastify: FastifyInstance) {
  fastify.get('/api/antivirus', { preHandler: requireAuth }, async (_req, reply) => {
    const status = avStatus();
    reply.send({
      ...status,
      message: status.installed ? undefined : 'ClamAV nicht installiert',
      scan: {
        running: scan.running,
        path: scan.path,
        startedAt: scan.startedAt,
        finishedAt: scan.finishedAt,
        scanned: scan.scanned,
        infectedCount: scan.infected.length,
        infected: scan.infected.slice(0, 200),
        error: scan.error,
      },
    });
  });

  // Install ClamAV + daemon
  fastify.post('/api/antivirus/install', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      if (hasBinary('apt-get')) privExec('apt-get install -y clamav clamav-daemon', { timeout: 300000 });
      else if (hasBinary('dnf')) privExec('dnf install -y clamav clamav-update clamd', { timeout: 300000 });
      else if (hasBinary('pacman')) privExec('pacman -S --noconfirm clamav', { timeout: 300000 });
      else return reply.status(400).send({ error: 'Kein unterstützter Paketmanager' });
      auditQueries.log.run(req.user.id, 'antivirus.install', null);
      reply.send({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Installation fehlgeschlagen';
      reply.status(500).send({ error: msg.includes('sudo') ? 'Keine Root-Rechte – bitte einmal „sudo bash install.sh --fix-perms“ ausführen (aktualisiert die sudoers-Rechte).' : msg });
    }
  });

  // Update virus definitions (freshclam)
  fastify.post('/api/antivirus/update', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('freshclam')) return reply.status(503).send({ error: 'freshclam nicht installiert' });
    try {
      // freshclam scheitert, wenn der Auto-Updater (clamav-freshclam) die DB sperrt → vorher stoppen
      try { privExec('systemctl stop clamav-freshclam', { timeout: 8000 }); } catch { /* Dienst evtl. nicht aktiv */ }
      try {
        privExec('freshclam', { timeout: 180000 });
      } finally {
        try { privExec('systemctl start clamav-freshclam', { timeout: 8000 }); } catch { /* */ }
      }
      auditQueries.log.run(req.user.id, 'antivirus.update', null);
      reply.send({ ok: true, defsAgeDays: defsAgeDays() });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Update fehlgeschlagen' });
    }
  });

  // Daemon / Auto-Updates aktivieren oder deaktivieren
  fastify.post<{ Body: { service: 'daemon' | 'freshclam'; enable: boolean } }>(
    '/api/antivirus/daemon',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const service = req.body?.service;
      const unit = service === 'freshclam' ? 'clamav-freshclam' : 'clamav-daemon';
      if (service !== 'daemon' && service !== 'freshclam') return reply.status(400).send({ error: 'Ungültiger Dienst' });
      try {
        if (req.body?.enable) {
          // Vor dem Start sicherstellen, dass Signaturen vorhanden sind (Daemon startet sonst nicht)
          if (service === 'daemon' && defsAgeDays() === null && hasBinary('freshclam')) {
            try { privExec('freshclam', { timeout: 180000 }); } catch { /* weiter versuchen */ }
          }
          privExec(`systemctl enable --now ${unit}`, { timeout: 30000 });
        } else {
          privExec(`systemctl disable --now ${unit}`, { timeout: 15000 });
        }
        auditQueries.log.run(req.user.id, `antivirus.${service}`, req.body?.enable ? 'on' : 'off');
        // kurz warten, damit systemctl-Status aktuell ist
        const active = safeExec(`systemctl is-active ${unit} 2>/dev/null`).trim() === 'active';
        reply.send({ ok: true, active });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Aktion fehlgeschlagen';
        reply.status(500).send({ error: msg.includes('sudo') ? 'Keine Root-Rechte – bitte einmal „sudo bash install.sh --fix-perms“ ausführen (aktualisiert die sudoers-Rechte).' : `${unit} ließ sich nicht ${req.body?.enable ? 'starten' : 'stoppen'} – evtl. fehlen die Signaturen (erst „Signaturen aktualisieren").` });
      }
    }
  );

  // Start a background scan of a path
  fastify.post<{ Body: { path: string; exclude?: string } }>('/api/antivirus/scan', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('clamscan') && !hasBinary('clamdscan')) return reply.status(503).send({ error: 'ClamAV nicht installiert' });
    if (scan.running) return reply.status(409).send({ error: 'Es läuft bereits ein Scan' });
    const path = (req.body?.path ?? '').trim();
    if (!path.startsWith('/')) return reply.status(400).send({ error: 'Absoluter Pfad erforderlich' });

    // Auszuschließende Ordner (Komma-getrennt) → nur absolute Pfade
    const excludeDirs = (req.body?.exclude ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('/'));

    scan = { running: true, path, startedAt: new Date().toISOString(), scanned: 0, infected: [] };
    // Bei Ausschlüssen clamscan erzwingen (clamdscan unterstützt --exclude-dir nicht)
    const useDaemon = hasBinary('clamdscan') && avStatus().daemonActive && excludeDirs.length === 0;
    const bin = useDaemon ? 'clamdscan' : 'clamscan';
    const excludeArgs = excludeDirs.map((d) => `--exclude-dir=^${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const args = useDaemon ? ['-m', '--fdpass', '-i', path] : ['-r', ...excludeArgs, '-i', path];

    const child = spawnPriv(bin, args);
    let buf = '';
    const handle = (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^(.*):\s+(.+)\s+FOUND$/);
        if (m) scan.infected.push({ file: m[1], virus: m[2] });
        const sc = line.match(/^Scanned files:\s+(\d+)/);
        if (sc) scan.scanned = parseInt(sc[1]);
      }
    };
    child.stdout?.on('data', handle);
    child.stderr?.on('data', () => { /* progress noise */ });
    child.on('error', (e) => { scan.running = false; scan.error = e.message; scan.finishedAt = new Date().toISOString(); });
    child.on('close', () => {
      scan.running = false;
      scan.finishedAt = new Date().toISOString();
      auditQueries.log.run(req.user.id, 'antivirus.scan', `${path} (${scan.infected.length} Funde)`);
      if (scan.infected.length > 0) {
        void notify('error', `Virenscan: ${scan.infected.length} Fund(e)`, `Bedrohungen in ${path} gefunden, z. B. ${scan.infected[0].virus}.`, 'antivirus');
      }
    });

    reply.send({ ok: true, started: true });
  });
}
