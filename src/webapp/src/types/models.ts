export type AgentStatus = 'Online' | 'Offline' | 'Sleeping' | 'Compromised';
export type TaskStatus = 'Pending' | 'Sent' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';
export type UserRole = 'Operator' | 'Admin';
export type CommandType = 'Shell' | 'Upload' | 'Download' | 'Screenshot' | 'Webcam' | 'WifiScan' | 'Kill' | 'Sleep' | 'Proxy';

export interface AgentListItem {
  id: string;
  hostname: string;
  ipAddress: string;
  osVersion: string;
  status: AgentStatus;
  lastSeen: string;
}

export interface AgentDetail extends AgentListItem {
  arch: string;
  userName: string;
  processName: string;
  pid: number;
  isElevated: boolean;
  firstSeen: string;
  heartbeatInterval: number;
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
