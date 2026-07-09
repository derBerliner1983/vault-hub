import type { FastifyInstance } from 'fastify';
import si from 'systeminformation';
import Dockerode from 'dockerode';
import { execSync } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

function safeExec(cmd: string, timeout = 5000): string {
  try {
    return execSync(cmd, { timeout, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

/** Approximate RAM used by all running Docker containers (bytes). */
async function dockerMemoryUsage(): Promise<number> {
  try {
    const containers = await docker.listContainers({ all: false });
    let total = 0;
    await Promise.all(
      containers.slice(0, 30).map(async (c) => {
        try {
          const stats = (await docker.getContainer(c.Id).stats({ stream: false })) as Dockerode.ContainerStats;
          const cache = (stats.memory_stats.stats as Record<string, number>)?.cache ?? 0;
          total += (stats.memory_stats.usage ?? 0) - cache;
        } catch {
          /* ignore single container */
        }
      })
    );
    return total;
  } catch {
    return 0;
  }
}

/**
 * Echter RAM-Verbrauch wie htop ihn anzeigt – direkt aus /proc/meminfo.
 * used = MemTotal - MemFree - Buffers - (Cached + SReclaimable - Shmem)
 * Gibt null zurück, wenn /proc/meminfo nicht verfügbar ist (Nicht-Linux).
 */
function htopUsedMemory(): number | null {
  const raw = safeExec('cat /proc/meminfo 2>/dev/null');
  if (!raw) return null;
  const vals: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (m) vals[m[1]] = parseInt(m[2]) * 1024; // kB → Bytes
  }
  if (vals.MemTotal === undefined || vals.MemFree === undefined) return null;
  const buffers = vals.Buffers ?? 0;
  const cached = (vals.Cached ?? 0) + (vals.SReclaimable ?? 0) - (vals.Shmem ?? 0);
  const used = vals.MemTotal - vals.MemFree - buffers - cached;
  return Math.max(0, used);
}

/** Approximate RAM used by KVM/QEMU virtual machines (bytes). */
function vmMemoryUsage(): number {
  const out = safeExec("ps -eo rss,comm --no-headers | grep -iE 'qemu|kvm' || true");
  let kb = 0;
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)/);
    if (m) kb += parseInt(m[1]);
  }
  return kb * 1024;
}

interface GpuStat {
  name: string;
  vendor: 'nvidia' | 'amd' | 'unknown';
  utilizationPct: number | null;
  vramTotalMb: number | null;
  vramUsedMb: number | null;
  unified: boolean;
}

function detectGpus(): GpuStat[] {
  // NVIDIA via nvidia-smi
  const nv = safeExec('nvidia-smi --query-gpu=name,utilization.gpu,memory.total,memory.used --format=csv,noheader,nounits 2>/dev/null');
  if (nv.trim()) {
    return nv.trim().split('\n').flatMap((line) => {
      const p = line.split(',').map((s) => s.trim());
      if (!p[0]) return [];
      return [{ name: p[0], vendor: 'nvidia' as const, utilizationPct: parseFloat(p[1]) || 0, vramTotalMb: parseInt(p[2]) || null, vramUsedMb: parseInt(p[3]) || null, unified: false }];
    });
  }

  // AMD via amdgpu kernel driver sysfs
  const cards = safeExec('ls /sys/class/drm/ 2>/dev/null').split(/\s+/).filter((d) => /^card\d+$/.test(d.trim()));
  const amdGpus: GpuStat[] = [];
  for (const card of cards.slice(0, 2)) {
    const base = `/sys/class/drm/${card.trim()}/device`;
    const busyRaw = safeExec(`cat ${base}/gpu_busy_percent 2>/dev/null`).trim();
    if (!busyRaw) continue;
    const vramTotal = parseInt(safeExec(`cat ${base}/mem_info_vram_total 2>/dev/null`).trim()) || 0;
    const vramUsed  = parseInt(safeExec(`cat ${base}/mem_info_vram_used  2>/dev/null`).trim()) || 0;
    const lspciLine = safeExec('lspci 2>/dev/null | grep -iE "VGA compatible|3D controller|Display controller" | head -1');
    const name = lspciLine.replace(/^[^\s]+\s+[^:]+:\s*/, '').trim() || 'AMD GPU';
    amdGpus.push({
      name, vendor: 'amd',
      utilizationPct: parseInt(busyRaw) || 0,
      vramTotalMb: vramTotal > 0 ? Math.round(vramTotal / 1024 / 1024) : null,
      vramUsedMb:  vramUsed  > 0 ? Math.round(vramUsed  / 1024 / 1024) : null,
      unified: vramTotal < 256 * 1024 * 1024, // <256 MB dedicated → UMA/APU
    });
    break;
  }
  return amdGpus;
}

export async function systemRoutes(fastify: FastifyInstance) {
  // ── Full system stats (CPU per core, RAM breakdown, disk, network) ──
  fastify.get('/api/system/stats', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const [cpuLoad, mem, fsSizes, netStats, osInfo, time, cpuInfo, dockerMem] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        si.osInfo(),
        si.time(),
        si.cpu(),
        dockerMemoryUsage(),
      ]);
      const gpu = detectGpus();

      const vmMem = vmMemoryUsage();
      // Echter RAM-Verbrauch wie htop: zuerst /proc/meminfo, sonst Fallback.
      const procUsed = htopUsedMemory();
      const realUsed = procUsed ?? ((mem.active && mem.active > 0) ? mem.active : mem.used);
      const dockerMemClamped = Math.min(dockerMem, realUsed);
      const vmMemClamped = Math.min(vmMem, Math.max(0, realUsed - dockerMemClamped));
      const systemMem = Math.max(0, realUsed - dockerMemClamped - vmMemClamped);

      reply.send({
        cpu: {
          usage: Math.round(cpuLoad.currentLoad),
          cores: cpuLoad.cpus.length,
          brand: `${cpuInfo.manufacturer} ${cpuInfo.brand}`.trim(),
          speed: cpuInfo.speed,
          perCore: cpuLoad.cpus.map((c) => Math.round(c.load)),
        },
        memory: {
          total: mem.total,
          used: realUsed,
          free: mem.free,
          available: mem.available,
          percent: Math.round((realUsed / mem.total) * 100),
          breakdown: {
            system: systemMem,
            docker: dockerMemClamped,
            vm: vmMemClamped,
            free: mem.total - realUsed,
          },
        },
        disk: fsSizes
          .filter((f) => f.size > 0 && !f.mount.startsWith('/snap') && !f.mount.startsWith('/var/lib/docker'))
          .map((f) => ({
            fs: f.fs,
            type: f.type,
            size: f.size,
            used: f.used,
            available: f.available,
            percent: Math.round(f.use),
            mount: f.mount,
          })),
        network: netStats.slice(0, 4).map((n) => ({
          iface: n.iface,
          rx_bytes: n.rx_bytes,
          tx_bytes: n.tx_bytes,
          rx_sec: Math.max(0, n.rx_sec ?? 0),
          tx_sec: Math.max(0, n.tx_sec ?? 0),
          operstate: n.operstate,
        })),
        os: {
          hostname: osInfo.hostname,
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          kernel: osInfo.kernel,
          arch: osInfo.arch,
          uptime: time.uptime,
        },
        gpu,
      });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'System error' });
    }
  });

  fastify.get('/api/system/docker-version', { preHandler: requireAuth }, async (_req, reply) => {
    const version = safeExec('docker version --format "{{.Server.Version}}"', 3000).trim();
    reply.send({ version: version || 'unknown' });
  });

  // ── Optimierungsvorschläge (Ressourcen-Fresser, gestoppte Container, Swap …) ──
  fastify.get('/api/system/optimize', { preHandler: requireAuth }, async (_req, reply) => {
    interface Suggestion {
      id: string;
      severity: 'info' | 'warn';
      title: string;
      detail: string;
      actionType?: 'process' | 'container' | 'link';
      actionTarget?: string;
      actionLabel?: string;
    }
    const suggestions: Suggestion[] = [];
    try {
      const [procs, mem] = await Promise.all([si.processes(), si.mem()]);

      // Top-RAM-Prozesse (> 5% RAM, nicht Kernel/Vault-Hub selbst)
      const ramHogs = procs.list
        .filter((p) => p.memRss * 1024 > mem.total * 0.05 && p.pid !== process.pid)
        .sort((a, b) => b.memRss - a.memRss)
        .slice(0, 3);
      for (const p of ramHogs) {
        suggestions.push({
          id: `ram-${p.pid}`,
          severity: 'warn',
          title: `${p.name} belegt viel RAM`,
          detail: `${(p.memRss * 1024 / 1024 / 1024).toFixed(1)} GB (${Math.round(p.mem)}%) – PID ${p.pid}`,
          actionType: 'process',
          actionTarget: String(p.pid),
          actionLabel: 'Im Taskmanager öffnen',
        });
      }

      // Top-CPU-Prozesse (> 50%)
      const cpuHogs = procs.list
        .filter((p) => p.cpu > 50 && p.pid !== process.pid)
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 3);
      for (const p of cpuHogs) {
        suggestions.push({
          id: `cpu-${p.pid}`,
          severity: 'warn',
          title: `${p.name} verbraucht viel CPU`,
          detail: `${Math.round(p.cpu)}% CPU – PID ${p.pid}`,
          actionType: 'process',
          actionTarget: String(p.pid),
          actionLabel: 'Im Taskmanager öffnen',
        });
      }

      // Zombie-Prozesse
      const zombies = procs.list.filter((p) => p.state === 'zombie').length;
      if (zombies > 0) {
        suggestions.push({ id: 'zombies', severity: 'info', title: `${zombies} Zombie-Prozess(e)`, detail: 'Verwaiste Prozesse – ein Neustart des Elternprozesses räumt sie auf.' });
      }

      // Swap-Nutzung hoch
      if (mem.swaptotal > 0 && mem.swapused / mem.swaptotal > 0.5) {
        suggestions.push({ id: 'swap', severity: 'warn', title: 'Hohe Swap-Nutzung', detail: `${Math.round((mem.swapused / mem.swaptotal) * 100)}% des Swap belegt – RAM könnte knapp werden.` });
      }
    } catch { /* si error – skip */ }

    // Gestoppte Docker-Container (belegen Platz, könnten entfernt werden)
    try {
      const all = await docker.listContainers({ all: true });
      const stopped = all.filter((c) => c.State === 'exited');
      if (stopped.length > 0) {
        suggestions.push({
          id: 'stopped-containers',
          severity: 'info',
          title: `${stopped.length} gestoppte(r) Container`,
          detail: stopped.slice(0, 5).map((c) => (c.Names[0] ?? '').replace(/^\//, '')).join(', '),
          actionType: 'link',
          actionTarget: '/containers',
          actionLabel: 'Container verwalten',
        });
      }
    } catch { /* docker off */ }

    // Festplatten über 85%
    try {
      const fsSizes = await si.fsSize();
      for (const f of fsSizes.filter((f) => f.size > 0 && f.use >= 85 && !f.mount.startsWith('/snap'))) {
        suggestions.push({ id: `disk-${f.mount}`, severity: 'warn', title: `Festplatte ${f.mount} fast voll`, detail: `${Math.round(f.use)}% belegt – alte Backups/Logs aufräumen.` });
      }
    } catch { /* */ }

    reply.send({ suggestions, checkedAt: new Date().toISOString() });
  });

  // ── Processes (Task Manager) ──
  fastify.get('/api/system/processes', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const procs = await si.processes();
      const list = procs.list
        .filter((p) => p.cpu > 0.05 || p.memRss > 5000)
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 60)
        .map((p) => ({
          pid: p.pid,
          name: p.name,
          cpu: Math.round(p.cpu * 10) / 10,
          mem: Math.round(p.mem * 10) / 10,
          memRss: p.memRss * 1024,
          user: p.user,
          state: p.state,
          command: p.command?.substring(0, 120) ?? '',
        }));
      reply.send({ processes: list, total: procs.all, running: procs.running });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Process error' });
    }
  });

  fastify.post<{ Params: { pid: string }; Body: { signal?: string } }>(
    '/api/system/processes/:pid/kill',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const pid = parseInt(req.params.pid);
      if (!pid || pid < 100) return reply.status(400).send({ error: 'Ungültige PID' });
      const signal = req.body?.signal === 'KILL' ? 'KILL' : 'TERM';
      try {
        process.kill(pid, `SIG${signal}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Kill fehlgeschlagen' });
      }
    }
  );

  // ── systemd services ──
  fastify.get('/api/system/services', { preHandler: requireAuth }, async (_req, reply) => {
    const output = safeExec(
      'systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null | head -120'
    );
    const services = output
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().replace(/^●\s*/, '').split(/\s+/);
        return {
          name: parts[0] ?? '',
          load: parts[1] ?? '',
          active: parts[2] ?? '',
          sub: parts[3] ?? '',
          description: parts.slice(4).join(' '),
        };
      })
      .filter((s) => s.name.endsWith('.service'));
    reply.send({ services });
  });

  fastify.post<{ Body: { service: string; action: string } }>(
    '/api/system/services/control',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { service, action } = req.body ?? {};
      const allowed = ['start', 'stop', 'restart', 'enable', 'disable'];
      if (!allowed.includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const safeName = (service ?? '').replace(/[^a-zA-Z0-9@._-]/g, '');
      if (!safeName) return reply.status(400).send({ error: 'Ungültiger Dienst' });
      try {
        execSync(`systemctl ${action} ${safeName}`, { timeout: 10000 });
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'systemctl Fehler' });
      }
    }
  );

  // ── Autostart (enabled systemd units) ──
  fastify.get('/api/system/autostart', { preHandler: requireAuth }, async (_req, reply) => {
    const output = safeExec(
      'systemctl list-unit-files --type=service --state=enabled,disabled --no-pager --no-legend --plain 2>/dev/null | head -200'
    );
    const units = output
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return { name: parts[0] ?? '', state: parts[1] ?? '' };
      })
      .filter((u) => u.name.endsWith('.service'));
    reply.send({ units });
  });
}
