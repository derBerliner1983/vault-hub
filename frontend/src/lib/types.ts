// Vault-Hub-Kern-Typen. Feature-spezifische Typen bringen Plugins selbst mit.

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
  totpEnabled?: boolean;
}

export interface GpuStat {
  name: string;
  vendor: 'nvidia' | 'amd' | 'unknown';
  utilizationPct: number | null;
  vramTotalMb: number | null;
  vramUsedMb: number | null;
  unified: boolean;
}

export interface ProcessInfo {
  pid: number; name: string; cpu: number; mem: number; memRss: number; user: string; state: string; command: string;
}

export interface SystemService {
  name: string; load: string; active: string; sub: string; description: string; enabled?: boolean;
}

export interface SystemStats {
  cpu: { usage: number; cores: number; brand: string; speed: number; perCore: number[] };
  memory: {
    total: number; used: number; free: number; available: number; percent: number;
    breakdown: { system: number; docker: number; vm: number; free: number };
  };
  disk: { fs: string; type: string; size: number; used: number; available: number; percent: number; mount: string }[];
  network: { iface: string; rx_bytes: number; tx_bytes: number; rx_sec: number; tx_sec: number; operstate: string }[];
  os: { hostname: string; platform: string; distro: string; release: string; kernel: string; arch: string; uptime: number };
  gpu?: GpuStat[];
}
