export interface User {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
  totpEnabled?: boolean;
}

export interface BackupSchedule {
  id: number;
  type: 'container' | 'directory' | 'vm';
  source: string;
  label: string;
  schedule: string;
  retention: number;
  stop_container: number;
  enabled: number;
  last_run: string | null;
  last_status: string | null;
  last_message: string | null;
  created_at: string;
}

export interface AppTemplateEnv { key: string; label: string; default?: string; required?: boolean; secret?: boolean }
export interface AppTemplatePort { container: number; host: number; proto?: 'tcp' | 'udp' }

export interface AppTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  image: string;
  ports: AppTemplatePort[];
  volumes?: { name: string; path: string }[];
  env?: AppTemplateEnv[];
  restart?: string;
  note?: string;
  installed: boolean;
}

export interface StoreItem {
  id: string;
  name: string;
  image: string;
  icon: string;
  description: string;
  category: string;
  ports: { container: number; host: number; proto: 'tcp' | 'udp' }[];
  volumes: { name: string; path: string }[];
  env: { key: string; label: string; default: string; required: boolean; secret: boolean }[];
  restart: string;
  source: 'unraid' | 'dockerhub';
  stars?: number;
  installed?: boolean;
}

export interface StoreSearchResult {
  results: StoreItem[];
  total: number;
  source: string;
  cached: boolean;
  warming?: boolean;
  page?: number;
  limit?: number;
  categories?: string[];
}

export interface StoreStatus {
  cached: boolean;
  warming: boolean;
  appCount: number;
  fetchedAt: string | null;
}

export interface NotificationItem {
  id: number;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string | null;
  event: string | null;
  read: number;
  created_at: string;
}

export interface NotificationConfig {
  webhookUrl: string;
  emailTo: string;
  onBackup: boolean;
  onSecurity: boolean;
  onContainer: boolean;
  onAntivirus: boolean;
  // Nur Anzeige (vom GET geliefert) – beim Speichern via saveSmtp separat
  smtpHost?: string;
  smtpPort?: number | null;
  smtpUser?: string;
  smtpFrom?: string;
  smtpSecure?: boolean;
  smtpConfigured?: boolean;
}

export interface SmtpConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  smtpSecure: boolean;
}

export interface OptimizeSuggestion {
  id: string;
  severity: 'info' | 'warn';
  title: string;
  detail: string;
  actionType?: 'process' | 'container' | 'link';
  actionTarget?: string;
  actionLabel?: string;
}

export interface AlertRule {
  id: number;
  name: string;
  kind: 'predefined' | 'metric';
  ruleKey: string | null;
  metric: string | null;
  threshold: number | null;
  durationMin: number;
  recipients: string;
  enabled: boolean;
  lastTriggered: string | null;
}

export interface PredefinedAlert {
  key: string;
  name: string;
  description: string;
  hasThreshold?: boolean;
  thresholdLabel?: string;
  defaultThreshold?: number;
}

export interface AlertMetric {
  key: string;
  name: string;
  unit: string;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  behind?: number;
  method?: string;
  releaseUrl: string | null;
  repo: string;
  checkedAt: string;
  error?: string;
}

export interface Container {
  id: string;
  shortId: string;
  name: string;
  image: string;
  imageId: string;
  status: string;
  state: string;
  ports: string[];
  created: number;
  labels: Record<string, string>;
  category: string | null;
  icon?: string | null;
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

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  memRss: number;
  user: string;
  state: string;
  command: string;
}

export interface CronJob {
  id: number;
  schedule: string;
  command: string;
  comment: string;
  enabled: boolean;
  raw: string;
}

export interface VM {
  id: string;
  name: string;
  state: string;
  vcpus: number;
  memory: number;
  autostart: boolean;
}

export interface AutostartUnit {
  name: string;
  state: string;
}

export interface PackageUpdate {
  name: string;
  currentVersion: string;
  newVersion: string;
  repo: string;
}

export interface InstalledPackage {
  name: string;
  version: string;
  size: number;
  summary: string;
  auto: boolean;
}

export interface PackageSearchResult {
  name: string;
  summary: string;
  installed: boolean;
}

export interface Backup {
  id: number;
  type: string;
  name: string;
  source: string | null;
  path: string;
  size: number;
  status: string;
  created_at: string;
  exists: boolean;
}

export interface BackupSource {
  id: string;
  name: string;
  state: string;
  volumes: number;
}

export interface Share {
  name: string;
  path: string;
  readOnly: boolean;
  guestOk: boolean;
  browseable: boolean;
}

export interface LinuxUser {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  groups: string[];
  system: boolean;
}

export interface ProxyHost {
  id: number;
  containerId: string | null;
  name: string;
  hostname: string;
  targetHost: string;
  targetPort: number;
  https: boolean;
  enabled: boolean;
  url: string;
}

export interface ProxyCandidate {
  id: string;
  name: string;
  port: number;
  alreadyProxied: boolean;
  reachableHost?: string;   // host-erreichbare Bridge-IP (als Ziel-Host nutzbar)
  ownIps?: string[];        // eigene Macvlan/ipvlan-IPs (vom Host nicht erreichbar)
}

export interface NetEndpoint {
  container: string;
  name: string;
  ipv4: string;
  mac: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnet: string;
  gateway: string;
  parent: string;
  vlan: string;
  containers: NetEndpoint[];
  builtin: boolean;
}

export interface HostInterface {
  iface: string;
  ip4: string;
  mac: string;
  type: string;
  operstate: string;
}

export interface FirewallRule {
  num: number;
  raw: string;
  to: string;
  action: string;
  direction?: string; // IN | OUT | ''
  from: string;
  comment?: string;
}

export interface FirewallDisabledRule {
  id: number;
  action: string;
  direction: string;
  port: string;
  proto: string;
  from: string;
  to: string;
  comment: string;
}

export interface FirewallLogEntry {
  ts: string;
  action: string;     // BLOCK | ALLOW | AUDIT | LIMIT
  direction: string;  // IN | OUT
  iface: string;
  src: string;
  dst: string;
  proto: string;
  spt: string;
  dpt: string;
}

export interface FirewallAction {
  id: string;
  kind: 'allow-lan' | 'allow-any' | 'delete' | 'disable' | 'restrict-lan' | 'ignore';
  label: string;
  port?: string;
  proto?: string;
  ruleNum?: number;
}

export interface FirewallFinding {
  id: string;
  severity: 'critical' | 'warn' | 'info' | 'ok';
  title: string;
  detail: string;
  recommendation: string;
  ruleNum?: number;
  port?: string;
  fix?: 'disable' | 'delete' | 'restrict-lan';
  fixLabel?: string;
  actions?: FirewallAction[];
}

export interface FirewallAnalysis {
  available: boolean;
  active: boolean;
  ruleCount: number;
  defaultIncoming?: string;
  listeningCount?: number;
  findings: FirewallFinding[];
  counts: { critical: number; warn: number; info: number };
}

export type SecurityStatus = 'ok' | 'warn' | 'critical' | 'info';

export interface SecurityFinding {
  id: string;
  category: string;
  title: string;
  status: SecurityStatus;
  detail: string;
  recommendation: string;
  fix?: string;
  fixLabel?: string;
  link?: string;
  linkLabel?: string;
  accessZone?: 'lan-only' | 'internet-ok' | 'internet-conditional';
  port?: string;
  lan?: boolean;
  internet?: boolean;
  subnet?: string;
}

export interface OllamaModelDetails {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: OllamaModelDetails;
}

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  port: number;
}

export interface OllamaPsModel {
  name: string;
  model: string;
  size: number;        // Gesamtgröße im Speicher (Bytes)
  size_vram: number;   // davon im GPU-VRAM (Bytes); 0 = komplett RAM/CPU
  digest: string;
  details: OllamaModelDetails;
  expires_at: string;  // ISO-Zeitpunkt, ab dem das Modell entladen wird
  context_length?: number;
}

export interface OllamaModelShow {
  details: OllamaModelDetails;
  model_info: Record<string, number | string | boolean | null>;
  parameters?: string;
  template?: string;
}

export interface VoiceOpt { id: string; label: string; installed: boolean }

export interface VoiceConfig {
  enabled: boolean;
  wakeword: string;
  lang: 'de' | 'en' | 'th';
  tts: boolean;
  whisperModel: string;
  whisperModels?: string[];
  voices: { de?: string; en?: string; th?: string };
  model: string | null;
  available: { daemon: boolean; stt: boolean; tts: boolean; model?: string; loaded?: string[]; catalog?: Record<string, VoiceOpt[]>; kokoro?: boolean; qwen?: boolean; qwenLoading?: boolean; qwenReady?: boolean; qwenBytes?: number; qwenTotal?: number; qwenError?: string };
  install?: { running: boolean; error: string | null; log: string };
}

export interface ObsidianStatus {
  enabled: boolean;
  vault: string;
  exists: boolean;
  connected: boolean;
  files: number;
  chunks: number;
  lastIndexed: string | null;
}

export interface NetscanJob {
  id: string;
  label: string;
  via: 'local' | 'exec' | 'ssh';
  host: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  done: number;
  total: number;
  open: number[];
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

export interface HFSearchResult {
  id: string;
  author: string;
  downloads: number;
  likes: number;
  lastModified?: string | null;
  pipeline_tag?: string;
  tags?: string[];
}

export interface GpuStat {
  name: string;
  vendor: 'nvidia' | 'amd' | 'unknown';
  utilizationPct: number | null;
  vramTotalMb: number | null;
  vramUsedMb: number | null;
  unified: boolean;
}

export interface KiHardware {
  totalRamGb: number;
  gpus: Array<{ name: string; vramMb: number; unified: boolean }>;
  recommendation: string;
  explanation: string;
  maxModelGb: number;
}

export interface KiAccess {
  mode: 'local' | 'lan';
  host: string;
  port: string;
  hostname: string;
  lanIps: string[];
  httpsUrls: string[];
  httpsProxyId: number | null;
  caddyAvailable: boolean;
}

export interface HFGgufFile {
  filename: string;
  quant: string;
  size: number;
  ollamaTag: string;
}

export interface SecurityScan {
  score: number;
  grade: string;
  counts: { ok: number; warn: number; critical: number; info: number };
  findings: SecurityFinding[];
  scannedAt: string;
  firewallActive?: boolean;
}

export interface SshStatus {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  unit: string;
  port: string;
}

export interface VmNetwork {
  name: string;
  active: boolean;
  autostart: boolean;
  persistent: boolean;
  bridge: string;
  forward: string;
}

export interface AntivirusStatus {
  installed: boolean;
  daemonActive: boolean;
  freshclamActive: boolean;
  version: string;
  defsAgeDays: number | null;
  message?: string;
  scan: {
    running: boolean;
    path: string;
    startedAt?: string;
    finishedAt?: string;
    scanned: number;
    infectedCount: number;
    infected: { file: string; virus: string }[];
    error?: string;
  };
}

export interface DockerImage {
  id: string;
  tags: string[];
  size: number;
  created: number;
}

export interface SystemService {
  name: string;
  load: string;
  active: string;
  sub: string;
  description: string;
  enabled?: boolean;
}

export interface UserPublic {
  id: number;
  username: string;
  role: string;
  totp_enabled: number;
  totp_required: number;
  created_at: string;
}

export interface DeviceSession {
  id: number;
  user_id: number;
  username?: string;
  device_token: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen: string;
  revoked: number;
}

export interface ContainerNetworkEntry {
  containerId: string;
  containerName: string;
  networkId: string;
  networkName: string;
  driver: string;
  ipv4: string;
  mac: string;
}

export interface VmIpEntry {
  vmName: string;
  ipv4: string;
  mac: string;
  networkName: string;
}

export interface CreateContainerData {
  image: string;
  name?: string;
  ports?: Record<string, string>;
  env?: string[];
  volumes?: string[];
  category?: string;
  restart?: string;
  icon?: string;
  networks?: { id: string; ip?: string }[];
}
