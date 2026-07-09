import type {
  User, Container, SystemStats, DockerImage, SystemService, UserPublic, CreateContainerData, DeviceSession,
  ProcessInfo, CronJob, VM, AutostartUnit, PackageUpdate, Backup, BackupSource, Share, LinuxUser,
  ProxyHost, ProxyCandidate, DockerNetwork, HostInterface, FirewallRule, FirewallDisabledRule, FirewallLogEntry, FirewallAnalysis, SecurityScan, SshStatus, VmNetwork,
  AntivirusStatus, BackupSchedule, AppTemplate, NotificationItem, NotificationConfig, VersionInfo,
  OptimizeSuggestion, SmtpConfig, AlertRule, PredefinedAlert, AlertMetric,
  InstalledPackage, PackageSearchResult,
  StoreSearchResult, StoreStatus, OllamaStatus, OllamaModel,
  OllamaModelShow, HFSearchResult, KiHardware, KiAccess, HFGgufFile, OllamaPsModel, NetscanJob,
} from './types';

import { tt } from './i18n';

const getToken = () => localStorage.getItem('token');

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  // Content-Type nur setzen, wenn ein Body mitgeschickt wird – sonst lehnt
  // Fastify einen leeren JSON-Body mit 400 "Bad Request" ab.
  if (init?.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; errorKey?: string; errorVars?: Record<string, string | number> };
    const rawMsg = body.error ?? `HTTP ${res.status}`;
    // Übersetzte Meldung: bevorzugt strukturierter Schlüssel + Variablen
    // (dynamische Texte), sonst der deutsche Quelltext als Schlüssel.
    // Fallback bleibt immer der deutsche Originaltext.
    const msg = body.errorKey ? tt(body.errorKey, body.errorVars) : tt(rawMsg);
    const err = new Error(msg) as Error & { data?: unknown; status?: number; raw?: string };
    err.raw = rawMsg;         // Originaltext (z.B. für substring-Prüfungen)
    err.data = body;          // Zusatzdaten (z.B. Port-Konflikt-Vorschläge) erhalten
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    login: (username: string, password: string, token?: string) =>
      req<{ user?: User; token?: string; totpRequired?: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, token }) }),
    logout: () => req('/api/auth/logout', { method: 'POST' }),
    me: () => req<{ user: User }>('/api/auth/me'),
    changePassword: (currentPassword: string, newPassword: string) =>
      req('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
    twoFactor: {
      status: () => req<{ enabled: boolean }>('/api/auth/2fa/status'),
      setup: () => req<{ secret: string; otpauth: string }>('/api/auth/2fa/setup', { method: 'POST' }),
      enable: (token: string) => req('/api/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ token }) }),
      disable: (password: string) => req('/api/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password }) }),
    },
  },

  containers: {
    list: () => req<{ containers: Container[] }>('/api/containers'),
    get: (id: string) => req<{ container: unknown }>(`/api/containers/${id}`),
    start: (id: string) => req(`/api/containers/${id}/start`, { method: 'POST' }),
    stop: (id: string) => req(`/api/containers/${id}/stop`, { method: 'POST' }),
    restart: (id: string) => req(`/api/containers/${id}/restart`, { method: 'POST' }),
    remove: (id: string) => req(`/api/containers/${id}`, { method: 'DELETE' }),
    logs: (id: string, tail = 200) => req<{ logs: string[] }>(`/api/containers/${id}/logs?tail=${tail}`),
    logsSince: (id: string, since: number) => req<{ logs: string[] }>(`/api/containers/${id}/logs?tail=200&since=${since}`),
    stats: (id: string) =>
      req<{ cpu: number; memory: { used: number; limit: number; percent: number } }>(`/api/containers/${id}/stats`),
    create: (data: CreateContainerData) =>
      req<{ id: string }>('/api/containers/create', { method: 'POST', body: JSON.stringify(data) }),
    recreate: (id: string, data: {
      name?: string; image: string;
      ports?: { host: number; container: number; proto?: string }[];
      env?: string[]; volumes?: string[]; restart?: string; category?: string;
      networks?: { id: string; ip?: string }[];
    }) => req<{ ok: boolean; id: string }>(`/api/containers/${id}/recreate`, { method: 'POST', body: JSON.stringify(data) }),
    virtualIps: () => req<{ entries: import('./types').ContainerNetworkEntry[]; vmEntries: import('./types').VmIpEntry[] }>('/api/containers/virtual-ips'),
    pull: (id: string) => req(`/api/containers/${id}/pull`, { method: 'POST' }),
    setCategory: (id: string, category: string) =>
      req(`/api/containers/${id}/category`, { method: 'POST', body: JSON.stringify({ category }) }),
    setIcon: (id: string, icon: string) =>
      req(`/api/containers/${id}/icon`, { method: 'POST', body: JSON.stringify({ icon }) }),
    updates: () => req<{ updates: Record<string, { hasUpdate: boolean | null; image: string }> }>('/api/containers/updates'),
  },

  images: {
    list: () => req<{ images: DockerImage[] }>('/api/images'),
  },

  system: {
    stats: () => req<SystemStats>('/api/system/stats'),
    dockerVersion: () => req<{ version: string }>('/api/system/docker-version'),
    services: () => req<{ services: SystemService[] }>('/api/system/services'),
    controlService: (service: string, action: string) =>
      req('/api/system/services/control', { method: 'POST', body: JSON.stringify({ service, action }) }),
    processes: () => req<{ processes: ProcessInfo[]; total: number; running: number }>('/api/system/processes'),
    killProcess: (pid: number, signal: 'TERM' | 'KILL' = 'TERM') =>
      req(`/api/system/processes/${pid}/kill`, { method: 'POST', body: JSON.stringify({ signal }) }),
    autostart: () => req<{ units: AutostartUnit[] }>('/api/system/autostart'),
    updates: () => req<{ available: boolean; manager: string | null; updates: PackageUpdate[]; count: number; rebootRequired: boolean; message?: string }>('/api/system/updates'),
    checkUpdates: () => req('/api/system/updates/check', { method: 'POST' }),
    applyUpdates: (packages?: string[]) =>
      req<{ ok: boolean; output: string }>('/api/system/updates/apply', { method: 'POST', body: JSON.stringify({ packages }) }),
    optimize: () => req<{ suggestions: OptimizeSuggestion[]; checkedAt: string }>('/api/system/optimize'),
  },

  packages: {
    list: () => req<{ available: boolean; manager: string | null; packages: InstalledPackage[]; count: number }>('/api/system/packages'),
    search: (q: string) => req<{ results: PackageSearchResult[] }>(`/api/system/packages/search?q=${encodeURIComponent(q)}`),
    install: (packages: string[]) =>
      req<{ ok: boolean; output: string }>('/api/system/packages/install', { method: 'POST', body: JSON.stringify({ packages }) }),
    remove: (packages: string[], purge = false) =>
      req<{ ok: boolean; output: string }>('/api/system/packages/remove', { method: 'POST', body: JSON.stringify({ packages, purge }) }),
  },

  backups: {
    list: () => req<{ backups: Backup[]; dir: string }>('/api/backups'),
    sources: () => req<{ containers: BackupSource[] }>('/api/backups/sources'),
    backupContainer: (containerId: string, stop: boolean) =>
      req('/api/backups/container', { method: 'POST', body: JSON.stringify({ containerId, stop }) }),
    backupDirectory: (dir: string, label?: string) =>
      req('/api/backups/directory', { method: 'POST', body: JSON.stringify({ dir, label }) }),
    backupVm: (vm: string) => req('/api/backups/vm', { method: 'POST', body: JSON.stringify({ vm }) }),
    remove: (id: number) => req(`/api/backups/${id}`, { method: 'DELETE' }),
    downloadUrl: (id: number) => `/api/backups/${id}/download`,
    schedules: () => req<{ schedules: BackupSchedule[] }>('/api/backups/schedules'),
    createSchedule: (data: { type: string; source: string; label?: string; schedule: string; retention?: number; stop?: boolean }) =>
      req('/api/backups/schedules', { method: 'POST', body: JSON.stringify(data) }),
    toggleSchedule: (id: number, enabled: boolean) =>
      req(`/api/backups/schedules/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    runSchedule: (id: number) => req<{ ok: boolean; file: string }>(`/api/backups/schedules/${id}/run`, { method: 'POST' }),
    removeSchedule: (id: number) => req(`/api/backups/schedules/${id}`, { method: 'DELETE' }),
  },

  appTemplates: {
    list: () => req<{ templates: AppTemplate[] }>('/api/app-templates'),
    install: (id: string, data: { name?: string; env?: Record<string, string>; ports?: Record<string, number> }) =>
      req<{ ok: boolean; id: string; name: string }>(`/api/app-templates/${id}/install`, { method: 'POST', body: JSON.stringify(data) }),
  },

  store: {
    status: () => req<StoreStatus>('/api/app-templates/store/status'),
    warm: () => req<{ ok: boolean }>('/api/app-templates/store/warm', { method: 'POST' }),
    search: (q: string, source: 'unraid' | 'dockerhub', page = 1, category = '') =>
      req<StoreSearchResult>(
        `/api/app-templates/store/search?q=${encodeURIComponent(q)}&source=${source}&page=${page}` +
        (category ? `&category=${encodeURIComponent(category)}` : ''),
      ),
    install: (data: {
      name?: string; image: string;
      ports?: { container: number; host: number; proto?: string }[];
      volumes?: { name: string; path: string }[];
      env?: Record<string, string>;
      restart?: string; templateId?: string; category?: string; icon?: string;
      networkMode?: string; staticIp?: string;
    }) => req<{ ok: boolean; id: string; name: string }>('/api/app-templates/store/install', { method: 'POST', body: JSON.stringify(data) }),
  },

  prefs: {
    get: () => req<{ prefs: Record<string, unknown> }>('/api/prefs'),
    update: (prefs: Record<string, unknown>) =>
      req<{ ok: boolean; prefs: Record<string, unknown> }>('/api/prefs', { method: 'PUT', body: JSON.stringify({ prefs }) }),
  },

  notifications: {
    list: () => req<{ notifications: NotificationItem[]; unread: number; config: NotificationConfig }>('/api/notifications'),
    markRead: () => req('/api/notifications/read', { method: 'POST' }),
    clear: () => req('/api/notifications', { method: 'DELETE' }),
    saveConfig: (config: NotificationConfig) => req('/api/notifications/config', { method: 'POST', body: JSON.stringify(config) }),
    test: () => req('/api/notifications/test', { method: 'POST' }),
    saveSmtp: (data: SmtpConfig) => req('/api/notifications/smtp', { method: 'POST', body: JSON.stringify(data) }),
    testSmtp: (to?: string) => req('/api/notifications/smtp/test', { method: 'POST', body: JSON.stringify({ to }) }),
  },

  alerts: {
    list: () => req<{ rules: AlertRule[]; predefined: PredefinedAlert[]; metrics: AlertMetric[] }>('/api/alerts'),
    create: (data: { name?: string; kind: 'predefined' | 'metric'; ruleKey?: string; metric?: string; threshold?: number; durationMin?: number; recipients?: string }) =>
      req('/api/alerts', { method: 'POST', body: JSON.stringify(data) }),
    toggle: (id: number, enabled: boolean) =>
      req(`/api/alerts/${id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    remove: (id: number) => req(`/api/alerts/${id}`, { method: 'DELETE' }),
    test: (id: number) => req(`/api/alerts/${id}/test`, { method: 'POST' }),
    checkNow: () => req('/api/alerts/check', { method: 'POST' }),
  },

  shares: {
    list: () => req<{ available: boolean; running: boolean; shares: Share[]; firewallOpen?: boolean; message?: string }>('/api/shares'),
    create: (share: Share) => req('/api/shares', { method: 'POST', body: JSON.stringify(share) }),
    remove: (name: string) => req(`/api/shares/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    service: (action: 'start' | 'stop' | 'restart') =>
      req('/api/shares/service', { method: 'POST', body: JSON.stringify({ action }) }),
    addUser: (username: string, password: string) =>
      req('/api/shares/user', { method: 'POST', body: JSON.stringify({ username, password }) }),
  },

  linuxUsers: {
    list: (showSystem = false) => req<{ users: LinuxUser[] }>(`/api/linux-users${showSystem ? '?system=1' : ''}`),
    groups: () => req<{ groups: string[] }>('/api/linux-groups'),
    create: (data: { username: string; password?: string; groups?: string[]; sudo?: boolean }) =>
      req('/api/linux-users', { method: 'POST', body: JSON.stringify(data) }),
    setPassword: (username: string, password: string) =>
      req(`/api/linux-users/${username}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
    remove: (username: string, removeHome: boolean) =>
      req(`/api/linux-users/${username}${removeHome ? '?removeHome=1' : ''}`, { method: 'DELETE' }),
  },

  proxy: {
    list: () => req<{ available: boolean; running: boolean; caReady: boolean; hosts: ProxyHost[]; message?: string }>('/api/proxy'),
    candidates: () => req<{ candidates: ProxyCandidate[]; macvlanIps: string[] }>('/api/proxy/candidates'),
    create: (data: { containerId?: string; name: string; hostname: string; targetHost?: string; targetPort: number; https?: boolean }) =>
      req('/api/proxy', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { name?: string; hostname: string; targetHost?: string; targetPort: number; https?: boolean }) =>
      req(`/api/proxy/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setHttps: (id: number, https: boolean) =>
      req(`/api/proxy/${id}/https`, { method: 'POST', body: JSON.stringify({ https }) }),
    setHttpsAll: (https: boolean) =>
      req('/api/proxy/https-all', { method: 'POST', body: JSON.stringify({ https }) }),
    remove: (id: number) => req(`/api/proxy/${id}`, { method: 'DELETE' }),
    apply: () => req('/api/proxy/apply', { method: 'POST' }),
    caUrl: () => '/api/proxy/ca',
  },

  networks: {
    list: () => req<{ networks: DockerNetwork[] }>('/api/networks'),
    interfaces: () => req<{ interfaces: HostInterface[] }>('/api/networks/interfaces'),
    create: (data: { name: string; driver?: string; subnet?: string; gateway?: string; parent?: string; vlan?: string; internal?: boolean }) =>
      req('/api/networks', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: string) => req(`/api/networks/${id}`, { method: 'DELETE' }),
    connect: (id: string, container: string, ip?: string, aliases?: string[]) =>
      req(`/api/networks/${id}/connect`, { method: 'POST', body: JSON.stringify({ container, ip, aliases }) }),
    disconnect: (id: string, container: string) =>
      req(`/api/networks/${id}/disconnect`, { method: 'POST', body: JSON.stringify({ container }) }),
    link: (a: string, b: string) => req<{ ok: boolean; network: string }>('/api/networks/link', { method: 'POST', body: JSON.stringify({ a, b }) }),
    unlink: (a: string, b: string) => req('/api/networks/unlink', { method: 'POST', body: JSON.stringify({ a, b }) }),
    probe: (host: string, port: number) => req<{ open: boolean; ms: number; error?: string }>('/api/networks/probe', { method: 'POST', body: JSON.stringify({ host, port }) }),
    probeExec: (container: string, host: string, port: number) => req<{ open: boolean; ms: number; error?: string; method?: string }>('/api/networks/probe-exec', { method: 'POST', body: JSON.stringify({ container, host, port }) }),
    routes: () => req<{ routes: string[]; addrs: string[] }>('/api/networks/routes'),
    scan: (host: string, ports?: number[]) => req<{ open: number[] }>('/api/networks/scan', { method: 'POST', body: JSON.stringify({ host, ports }) }),
    scanExec: (container: string, host: string, ports?: number[]) => req<{ open: number[] }>('/api/networks/scan-exec', { method: 'POST', body: JSON.stringify({ container, host, ports }) }),
  },

  ssh: {
    list: () => req<{ targets: { node_id: string; host: string; port: number; username: string; auth_type: 'password' | 'key'; label?: string }[] }>('/api/ssh/targets'),
    save: (data: { nodeId: string; host: string; port?: number; username: string; authType: 'password' | 'key'; password?: string; privateKey?: string; passphrase?: string; label?: string }) =>
      req('/api/ssh/targets', { method: 'POST', body: JSON.stringify(data) }),
    remove: (nodeId: string) => req(`/api/ssh/targets/${encodeURIComponent(nodeId)}`, { method: 'DELETE' }),
    test: (nodeId: string) => req<{ ok: boolean; ms: number; error?: string }>('/api/ssh/test', { method: 'POST', body: JSON.stringify({ nodeId }) }),
    probe: (nodeId: string, host: string, port: number) => req<{ open: boolean; ms: number; error?: string }>('/api/ssh/probe', { method: 'POST', body: JSON.stringify({ nodeId, host, port }) }),
    scan: (nodeId: string, host: string, ports?: number[]) => req<{ open: number[]; ms: number; error?: string }>('/api/ssh/scan', { method: 'POST', body: JSON.stringify({ nodeId, host, ports }) }),
  },

  netscan: {
    create: (data: { via: 'local' | 'exec' | 'ssh'; container?: string; nodeId?: string; host: string; label?: string; ports?: number[]; from?: number; to?: number }) =>
      req<{ id: string }>('/api/netscan/jobs', { method: 'POST', body: JSON.stringify(data) }),
    list: () => req<{ jobs: NetscanJob[]; running: boolean }>('/api/netscan/jobs'),
    remove: (id: string) => req(`/api/netscan/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  security: {
    scan: () => req<SecurityScan>('/api/security/scan'),
    ssh: () => req<SshStatus>('/api/security/ssh'),
    sshControl: (action: 'start' | 'stop' | 'enable' | 'disable') =>
      req('/api/security/ssh', { method: 'POST', body: JSON.stringify({ action }) }),
    fix: (action: string) => req<{ ok: boolean; output: string }>('/api/security/action', { method: 'POST', body: JSON.stringify({ action }) }),
  },

  antivirus: {
    status: () => req<AntivirusStatus>('/api/antivirus'),
    install: () => req('/api/antivirus/install', { method: 'POST' }),
    update: () => req<{ ok: boolean; defsAgeDays: number | null }>('/api/antivirus/update', { method: 'POST' }),
    scan: (path: string, exclude?: string) => req('/api/antivirus/scan', { method: 'POST', body: JSON.stringify({ path, exclude }) }),
    daemon: (service: 'daemon' | 'freshclam', enable: boolean) =>
      req('/api/antivirus/daemon', { method: 'POST', body: JSON.stringify({ service, enable }) }),
  },

  vmNetworks: {
    list: () => req<{ available: boolean; networks: VmNetwork[]; message?: string }>('/api/vm-networks'),
    create: (data: { name: string; mode?: string; subnet?: string; bridge?: string; vlan?: string }) =>
      req('/api/vm-networks', { method: 'POST', body: JSON.stringify(data) }),
    start: (name: string) => req(`/api/vm-networks/${name}/start`, { method: 'POST' }),
    stop: (name: string) => req(`/api/vm-networks/${name}/stop`, { method: 'POST' }),
    autostart: (name: string) => req(`/api/vm-networks/${name}/autostart`, { method: 'POST' }),
    remove: (name: string) => req(`/api/vm-networks/${name}`, { method: 'DELETE' }),
    attach: (name: string, vm: string) => req(`/api/vm-networks/${name}/attach`, { method: 'POST', body: JSON.stringify({ vm }) }),
  },

  firewall: {
    list: () => req<{ available: boolean; active: boolean; logging: boolean; rules: FirewallRule[]; disabled?: FirewallDisabledRule[]; message?: string; listening?: string }>('/api/firewall'),
    add: (data: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string; comment?: string }) =>
      req('/api/firewall', { method: 'POST', body: JSON.stringify(data) }),
    update: (num: number, data: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string; comment?: string }) =>
      req(`/api/firewall/${num}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (num: number) => req(`/api/firewall/${num}`, { method: 'DELETE' }),
    disable: (num: number, data: { action?: string; port?: string; proto?: string; from?: string; direction?: string; comment?: string; profile?: string }) =>
      req(`/api/firewall/${num}/disable`, { method: 'POST', body: JSON.stringify(data) }),
    enableDisabled: (id: number) => req(`/api/firewall/disabled/${id}/enable`, { method: 'POST' }),
    removeDisabled: (id: number) => req(`/api/firewall/disabled/${id}`, { method: 'DELETE' }),
    toggle: (enable: boolean) => req('/api/firewall/toggle', { method: 'POST', body: JSON.stringify({ enable }) }),
    reset: () => req<{ ok: boolean }>('/api/firewall/reset', { method: 'POST' }),
    setLogging: (enable: boolean, level?: string) => req<{ ok: boolean; logging: boolean; level?: string }>('/api/firewall/logging', { method: 'POST', body: JSON.stringify({ enable, level }) }),
    log: (limit = 500) => req<{ available: boolean; logging: boolean; level?: string; source?: string; entries: FirewallLogEntry[]; total?: number; blocked?: number; message?: string }>(`/api/firewall/log?limit=${limit}`),
    clearLog: () => req('/api/firewall/log', { method: 'DELETE' }),
    analyze: () => req<FirewallAnalysis>('/api/firewall/analyze'),
    restrictLan: (num: number) => req(`/api/firewall/${num}/restrict-lan`, { method: 'POST' }),
    ignorePort: (port: string) => req('/api/firewall/ignore-port', { method: 'POST', body: JSON.stringify({ port }) }),
    unignorePort: (port: string) => req(`/api/firewall/ignore-port/${port}`, { method: 'DELETE' }),
  },

  settings: {
    info: () => req<{ version: string; hostname: string; platform: string; dataDir: string; node: string; uptime: number; features: Record<string, boolean> }>('/api/settings/info'),
    version: (refresh = false) => req<VersionInfo>(`/api/settings/version${refresh ? '?refresh=1' : ''}`),
    exportUrl: () => '/api/settings/export',
    restart: () => req<{ ok: boolean; note: string }>('/api/settings/restart', { method: 'POST' }),
    getIpv6: () => req<{ enabled: boolean; kernelEnabled?: boolean; configured: boolean }>('/api/settings/ipv6'),
    setIpv6: (enable: boolean) => req<{ ok: boolean; enabled: boolean }>('/api/settings/ipv6', { method: 'POST', body: JSON.stringify({ enable }) }),
    getProxyVisibility: () => req<{ enabled: boolean; backend: string }>('/api/settings/proxy-visibility'),
    setProxyVisibility: (enabled: boolean, backend: string) => req<{ ok: boolean; enabled: boolean; backend: string }>('/api/settings/proxy-visibility', { method: 'POST', body: JSON.stringify({ enabled, backend }) }),
    import: async (file: File) => {
      const token = localStorage.getItem('token');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/settings/import', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; restored: string[]; note: string }>;
    },
  },

  ki: {
    status: () => req<OllamaStatus>('/api/ki/status'),
    models: () => req<{ models: OllamaModel[] }>('/api/ki/models'),
    pull: (model: string) => req<{ ok: boolean; queued: boolean }>('/api/ki/pull', { method: 'POST', body: JSON.stringify({ model }) }),
    remove: (name: string) => req('/api/ki/models/' + encodeURIComponent(name), { method: 'DELETE' }),
    control: (action: 'start' | 'stop') => req('/api/ki/control', { method: 'POST', body: JSON.stringify({ action }) }),
    show: (name: string) => req<OllamaModelShow>('/api/ki/show', { method: 'POST', body: JSON.stringify({ name }) }),
    hfSearch: (q: string) => req<{ models: HFSearchResult[] }>(`/api/ki/hf-search?q=${encodeURIComponent(q)}`),
    hardware: () => req<KiHardware>('/api/ki/hardware'),
    access: () => req<KiAccess>('/api/ki/access'),
    setAccess: (mode: 'local' | 'lan') => req<{ ok: boolean; mode: string; host: string }>('/api/ki/access', { method: 'POST', body: JSON.stringify({ mode }) }),
    enableHttps: () => req<{ ok: boolean }>('/api/ki/https', { method: 'POST' }),
    disableHttps: () => req<{ ok: boolean }>('/api/ki/https', { method: 'DELETE' }),
    hfFiles: (id: string) => req<{ files: HFGgufFile[] }>(`/api/ki/hf-files?id=${encodeURIComponent(id)}`),
    ps: () => req<{ models: OllamaPsModel[] }>('/api/ki/ps'),
    load: (model: string, numCtx?: number, keepAlive?: number) =>
      req<{ ok: boolean }>('/api/ki/load', { method: 'POST', body: JSON.stringify({ model, numCtx, keepAlive }) }),
    unload: (model: string) =>
      req<{ ok: boolean }>('/api/ki/unload', { method: 'POST', body: JSON.stringify({ model }) }),
  },

  voice: {
    config: () => req<import('./types').VoiceConfig>('/api/voice/config'),
    setConfig: (data: Partial<Pick<import('./types').VoiceConfig, 'enabled' | 'wakeword' | 'lang' | 'tts' | 'whisperModel' | 'voices'>>) =>
      req<import('./types').VoiceConfig>('/api/voice/config', { method: 'POST', body: JSON.stringify(data) }),
    install: () => req<{ ok: boolean; running: boolean }>('/api/voice/install', { method: 'POST' }),
    installQwen: () => req<{ ok: boolean; running: boolean }>('/api/voice/install-qwen', { method: 'POST' }),
    rebuildPython: (version = '3.12') => req<{ ok: boolean; running: boolean }>('/api/voice/rebuild-python', { method: 'POST', body: JSON.stringify({ version }) }),
    qwenLoad: () => req<{ ok: boolean; loading: boolean; ready: boolean }>('/api/voice/qwen-load', { method: 'POST' }),
    logs: () => req<{ lines: string[] }>('/api/voice/logs'),
    restart: () => req<{ ok: boolean; daemon: boolean }>('/api/voice/restart', { method: 'POST' }),
    installStatus: () => req<{ running: boolean; error: string | null; log: string; daemon: boolean }>('/api/voice/install/status'),
    clone: (name: string, text: string, pcm: ArrayBuffer) => {
      const bytes = new Uint8Array(pcm); let s = ''; const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
      return req<{ id: string }>('/api/voice/clone', { method: 'POST', body: JSON.stringify({ name, text, pcmB64: btoa(s) }) });
    },
    deleteClone: (id: string) => req<{ ok: boolean }>(`/api/voice/clone/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    previewUrl: (voice: string, lang: string) => `/api/voice/preview?voice=${encodeURIComponent(voice)}&lang=${encodeURIComponent(lang)}`,
    ask: (text: string, lang: string, history?: { role: 'user' | 'assistant'; text: string }[]) => req<{ answer: string; audio?: string }>('/api/voice/ask', { method: 'POST', body: JSON.stringify({ text, lang, history }) }),
    cache: () => req<{ items: { id: string; label: string; kind: string; bytes: number }[] }>('/api/voice/cache'),
    deleteCache: (id: string) => req<{ ok: boolean }>(`/api/voice/cache?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    sttOnce: async (pcm: ArrayBuffer, lang: string): Promise<{ text: string }> => {
      const res = await fetch(`/api/voice/stt-once?lang=${encodeURIComponent(lang)}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream' }, body: pcm,
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})) as { error?: string }; throw new Error(b.error || `HTTP ${res.status}`); }
      return res.json() as Promise<{ text: string }>;
    },
  },

  obsidian: {
    status: () => req<import('./types').ObsidianStatus>('/api/obsidian/status'),
    setConfig: (data: { vault?: string; enabled?: boolean }) =>
      req<import('./types').ObsidianStatus>('/api/obsidian/config', { method: 'POST', body: JSON.stringify(data) }),
    reindex: () => req<import('./types').ObsidianStatus>('/api/obsidian/reindex', { method: 'POST' }),
    search: (q: string) => req<{ hits: { path: string; title: string; body: string }[] }>(`/api/obsidian/search?q=${encodeURIComponent(q)}`),
  },

  websearch: {
    status: () => req<{ enabled: boolean; maxResults: number }>('/api/websearch/status'),
    setConfig: (data: { enabled?: boolean; maxResults?: number }) =>
      req<{ enabled: boolean; maxResults: number }>('/api/websearch/config', { method: 'POST', body: JSON.stringify(data) }),
    test: (q: string) => req<{ results: { title: string; url: string; snippet: string }[] }>(`/api/websearch/test?q=${encodeURIComponent(q)}`),
  },

  cron: {
    list: () => req<{ jobs: CronJob[]; raw: string }>('/api/cron'),
    add: (schedule: string, command: string, comment?: string) =>
      req('/api/cron', { method: 'POST', body: JSON.stringify({ schedule, command, comment }) }),
    remove: (id: number) => req(`/api/cron/${id}`, { method: 'DELETE' }),
    saveRaw: (raw: string) => req('/api/cron/raw', { method: 'PUT', body: JSON.stringify({ raw }) }),
  },

  vms: {
    list: () => req<{ available: boolean; vms: VM[]; message?: string }>('/api/vms'),
    start: (name: string) => req(`/api/vms/${name}/start`, { method: 'POST' }),
    shutdown: (name: string) => req(`/api/vms/${name}/shutdown`, { method: 'POST' }),
    stop: (name: string) => req(`/api/vms/${name}/stop`, { method: 'POST' }),
    reboot: (name: string) => req(`/api/vms/${name}/reboot`, { method: 'POST' }),
    toggleAutostart: (name: string) => req(`/api/vms/${name}/autostart`, { method: 'POST' }),
    snapshot: (name: string) => req(`/api/vms/${name}/snapshot`, { method: 'POST' }),
    remove: (name: string) => req(`/api/vms/${name}`, { method: 'DELETE' }),
    create: (data: { name: string; memory: number; vcpus: number; diskSize: number; iso?: string; osVariant?: string }) =>
      req('/api/vms/create', { method: 'POST', body: JSON.stringify(data) }),
  },

  users: {
    list: () => req<{ users: UserPublic[] }>('/api/users'),
    create: (data: { username: string; password: string; role: string }) =>
      req('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: number) => req(`/api/users/${id}`, { method: 'DELETE' }),
    require2fa: (id: number, required: boolean) =>
      req(`/api/users/${id}/2fa/require`, { method: 'POST', body: JSON.stringify({ required }) }),
    reset2fa: (id: number) =>
      req(`/api/users/${id}/2fa/reset`, { method: 'POST' }),
    revokeSessions: (id: number) =>
      req(`/api/users/${id}/sessions`, { method: 'DELETE' }),
  },

  sessions: {
    list: (userId?: number) =>
      req<{ sessions: DeviceSession[] }>(`/api/auth/sessions${userId != null ? `?userId=${userId}` : ''}`),
    listAll: () => req<{ sessions: DeviceSession[] }>('/api/auth/sessions/all'),
    revoke: (id: number) => req(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  },
};
