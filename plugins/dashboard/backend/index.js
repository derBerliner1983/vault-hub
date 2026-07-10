'use strict';
// Dashboard-Plugin-Backend (CommonJS). Liest System-Stats dependency-frei aus
// /proc + Shell (Ubuntu-nativ) und liefert sie unter /app/dashboard/api/stats.

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

function sh(cmd, timeout) {
  try { return execSync(cmd, { timeout: timeout || 4000, stdio: ['pipe', 'pipe', 'ignore'] }).toString(); }
  catch (_) { return ''; }
}
function readFile(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }

// ── CPU (aggregat + pro Kern) über /proc/stat, Delta zwischen zwei Abfragen ──
let prevCpu = null;
function cpuSample() {
  const out = {};
  for (const line of readFile('/proc/stat').split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const p = line.trim().split(/\s+/);
    const key = p[0];
    if (key !== 'cpu' && !/^cpu\d+$/.test(key)) continue;
    const nums = p.slice(1).map(Number);
    const idle = (nums[3] || 0) + (nums[4] || 0);
    const total = nums.reduce((a, b) => a + b, 0);
    out[key] = { idle, total };
  }
  return out;
}
function cpuUsage() {
  const cur = cpuSample();
  const prev = prevCpu || cur;
  prevCpu = cur;
  const pct = (k) => {
    if (!prev[k] || !cur[k]) return 0;
    const dt = cur[k].total - prev[k].total;
    const di = cur[k].idle - prev[k].idle;
    if (dt <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
  };
  const perCore = Object.keys(cur).filter((k) => k !== 'cpu').sort().map(pct);
  return { usage: pct('cpu'), perCore };
}

// ── RAM htop-artig aus /proc/meminfo ──
function memory() {
  const vals = {};
  for (const line of readFile('/proc/meminfo').split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (m) vals[m[1]] = parseInt(m[2]) * 1024;
  }
  const total = vals.MemTotal || 0;
  const free = vals.MemFree || 0;
  const buffers = vals.Buffers || 0;
  const cached = (vals.Cached || 0) + (vals.SReclaimable || 0) - (vals.Shmem || 0);
  const used = Math.max(0, total - free - buffers - cached);
  return {
    total, used, free: vals.MemAvailable || free,
    percent: total ? Math.round((used / total) * 100) : 0,
    breakdown: { system: used, free: Math.max(0, total - used) },
  };
}

// ── Disk über df ──
function disks() {
  const out = sh('df -kP -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null');
  const rows = [];
  const lines = out.split('\n').slice(1);
  for (const line of lines) {
    const p = line.trim().split(/\s+/);
    if (p.length < 6) continue;
    const mount = p.slice(5).join(' ');
    if (mount.startsWith('/snap') || mount.startsWith('/var/lib/docker')) continue;
    const size = parseInt(p[1]) * 1024, used = parseInt(p[2]) * 1024, avail = parseInt(p[3]) * 1024;
    if (!size) continue;
    rows.push({ fs: p[0], size, used, available: avail, percent: parseInt(p[4]) || 0, mount });
  }
  return rows;
}

// ── Netz über /proc/net/dev, Rate zwischen zwei Abfragen ──
let prevNet = null, prevNetTs = 0;
function network() {
  const now = Date.now();
  const cur = {};
  for (const line of readFile('/proc/net/dev').split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/);
    if (!m) continue;
    const iface = m[1].trim();
    if (iface === 'lo') continue;
    cur[iface] = { rx: parseInt(m[2]), tx: parseInt(m[3]) };
  }
  const dt = prevNetTs ? (now - prevNetTs) / 1000 : 0;
  const res = Object.keys(cur).slice(0, 4).map((iface) => {
    const prev = prevNet && prevNet[iface];
    const rx_sec = prev && dt > 0 ? Math.max(0, Math.round((cur[iface].rx - prev.rx) / dt)) : 0;
    const tx_sec = prev && dt > 0 ? Math.max(0, Math.round((cur[iface].tx - prev.tx) / dt)) : 0;
    const operstate = readFile('/sys/class/net/' + iface + '/operstate').trim() || 'unknown';
    return { iface, rx_bytes: cur[iface].rx, tx_bytes: cur[iface].tx, rx_sec, tx_sec, operstate };
  });
  prevNet = cur; prevNetTs = now;
  return res;
}

function osInfo() {
  const rel = readFile('/etc/os-release');
  const pretty = (rel.match(/PRETTY_NAME="?([^"\n]+)"?/) || [])[1] || os.type();
  const brand = (readFile('/proc/cpuinfo').match(/model name\s*:\s*(.+)/) || [])[1] || '';
  return {
    hostname: os.hostname(), distro: pretty, kernel: os.release(), arch: os.arch(),
    uptime: os.uptime(), load: os.loadavg(), cpuBrand: brand.trim(), cores: os.cpus().length,
  };
}

function gpus() {
  try {
    const nv = sh('nvidia-smi --query-gpu=name,utilization.gpu,memory.total,memory.used --format=csv,noheader,nounits 2>/dev/null');
    if (nv.trim()) {
      return nv.trim().split('\n').map((l) => {
        const p = l.split(',').map((s) => s.trim());
        return { name: p[0], vendor: 'nvidia', utilizationPct: parseFloat(p[1]) || 0, vramTotalMb: parseInt(p[2]) || null, vramUsedMb: parseInt(p[3]) || null };
      });
    }
    const cards = sh('ls /sys/class/drm/ 2>/dev/null').split(/\s+/).filter((d) => /^card\d+$/.test(d));
    for (const card of cards.slice(0, 2)) {
      const base = `/sys/class/drm/${card}/device`;
      const busy = sh(`cat ${base}/gpu_busy_percent 2>/dev/null`).trim();
      if (!busy) continue;
      const name = (sh('lspci 2>/dev/null | grep -iE "VGA|3D|Display" | head -1').replace(/^\S+\s+[^:]+:\s*/, '').trim()) || 'GPU';
      return [{ name, vendor: 'amd', utilizationPct: parseInt(busy) || 0, vramTotalMb: null, vramUsedMb: null }];
    }
  } catch (_) { /* */ }
  return [];
}

module.exports.register = function register(fastify, ctx) {
  const guard = async (req, reply) => {
    try { await req.jwtVerify(); } catch (_) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
    return true;
  };
  fastify.get('/app/dashboard/api/stats', async (req, reply) => {
    if (!(await guard(req, reply))) return;
    try {
      const cpu = cpuUsage();
      const o = osInfo();
      const m = memory();
      const speed = (() => { try { return Math.round((os.cpus()[0].speed / 1000) * 10) / 10 || 0; } catch (_) { return 0; } })();
      reply.send({
        cpu: { usage: cpu.usage, cores: o.cores, brand: o.cpuBrand, speed, perCore: cpu.perCore },
        memory: {
          total: m.total, used: m.used, free: m.free, available: m.free, percent: m.percent,
          breakdown: { system: m.used, docker: 0, vm: 0, free: m.breakdown.free },
        },
        disk: disks().map((d) => ({ ...d, type: '' })),
        network: network(),
        os: { hostname: o.hostname, platform: 'linux', distro: o.distro, release: '', kernel: o.kernel, arch: o.arch, uptime: o.uptime },
        gpu: gpus().map((g) => ({ ...g, unified: g.vendor === 'amd' && !g.vramTotalMb })),
      });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'stats error' });
    }
  });
  void ctx;
};
