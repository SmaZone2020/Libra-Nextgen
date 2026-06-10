export type AgentStatus = 'Online' | 'Offline' | 'Sleeping' | 'Compromised';
export type TaskStatus = 'Pending' | 'Sent' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';
export type UserRole = 'Operator' | 'Admin';
export type CommandType = 'Shell' | 'Upload' | 'Download' | 'Screenshot' | 'Webcam' | 'WifiScan' | 'Kill' | 'Sleep' | 'Proxy';

export interface AgentListItem {
  id: string;
  hostname: string;
  userName: string;
  ipAddress: string;
  osVersion: string;
  status: AgentStatus;
  lastSeen: string;
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
