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

export interface PackageUpdate {
  name: string; currentVersion: string; newVersion: string; repo: string;
}
export interface InstalledPackage {
  name: string; version: string; size: number; summary: string; auto: boolean;
}
export interface PackageSearchResult {
  name: string; summary: string; installed: boolean;
}

export interface UserPublic {
  id: number; username: string; role: string;
  totp_enabled?: number; totp_required?: number; created_at?: string;
}
export interface LinuxUser {
  username: string; uid: number; gid: number; home: string; shell: string; groups: string[]; system: boolean;
}

export interface AntivirusScan {
  running: boolean; path: string; startedAt?: string; finishedAt?: string;
  scanned: number; infectedCount: number; infected: { file: string; virus: string }[]; error?: string;
}
export interface AntivirusStatus {
  installed: boolean; daemonActive: boolean; freshclamActive: boolean;
  version: string; defsAgeDays: number | null; message?: string; scan: AntivirusScan;
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
