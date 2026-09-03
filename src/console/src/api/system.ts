import { api } from './client';
import type { ProcessListResult, WindowListResult, EnvVarsResult, NetworkResult, LanScanResult, PackagesResult, DockerResult } from '../types/models';
import type { AgentTask } from '../types/models';

export function getProcesses(agentId: string, lastHash?: string): Promise<ProcessListResult> {
  return api.post<ProcessListResult>(`/system/${agentId}/processes`, { lastHash: lastHash ?? null });
}

export function killProcess(agentId: string, pid: number): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/system/${agentId}/processes/kill`, { pid });
}

export function getWindows(agentId: string): Promise<WindowListResult> {
  return api.post<WindowListResult>(`/system/${agentId}/windows`);
}

export function closeWindow(agentId: string, hwnd: number): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/system/${agentId}/windows/close`, { hwnd });
}

export function minimizeWindow(agentId: string, hwnd: number): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/system/${agentId}/windows/minimize`, { hwnd });
}

export function maximizeWindow(agentId: string, hwnd: number): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/system/${agentId}/windows/maximize`, { hwnd });
}

export function setWindowTopmost(agentId: string, hwnd: number): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/system/${agentId}/windows/topmost`, { hwnd });
}

export function setWindowBottom(agentId: string, hwnd: number): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/system/${agentId}/windows/bottom`, { hwnd });
}

export function setWindowTitle(agentId: string, hwnd: number, title: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/system/${agentId}/windows/settitle`, { hwnd, title });
}

export function getEnvVars(agentId: string): Promise<EnvVarsResult> {
  return api.post<EnvVarsResult>(`/system/${agentId}/env`);
}

export function setEnvVar(agentId: string, name: string, value: string, scope: string): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/system/${agentId}/env/set`, { name, value, scope });
}

export function deleteEnvVar(agentId: string, name: string, scope: string): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/system/${agentId}/env/delete`, { name, scope });
}

export function getNetwork(agentId: string): Promise<NetworkResult> {
  return api.post<NetworkResult>(`/system/${agentId}/network`);
}

export function getNetworkWan(agentId: string): Promise<Pick<NetworkResult, 'wan'>> {
  return api.post(`/system/${agentId}/network/wan`);
}

export function getNetworkWifi(agentId: string): Promise<Pick<NetworkResult, 'wifi'>> {
  return api.post(`/system/${agentId}/network/wifi`);
}

export function getNetworkNearby(agentId: string): Promise<Pick<NetworkResult, 'nearbyWifi'>> {
  return api.post(`/system/${agentId}/network/nearby`);
}

export function getNetworkProxy(agentId: string): Promise<Pick<NetworkResult, 'proxy' | 'dnsSuffix'>> {
  return api.post(`/system/${agentId}/network/proxy`);
}

export async function startLanScan(agentId: string): Promise<{ taskId: string }> {
  const task = await api.post<AgentTask>('/tasks', {
    agentId,
    commandType: 'Generic',
    command: 'recon',
    arguments: [JSON.stringify({ op: 'lanscan' })],
    timeoutSeconds: 180,
  });
  return { taskId: task.id };
}

export function getLanScanTask(taskId: string): Promise<AgentTask> {
  return api.get<AgentTask>(`/tasks/${taskId}`);
}

export function parseLanScanResult(task: AgentTask): LanScanResult | null {
  if (task.status !== 'Completed' || !task.output) return null;
  try {
    const parsed = JSON.parse(task.output) as LanScanResult;
    if (!Array.isArray(parsed.devices) || !Array.isArray(parsed.subnets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getPackages(agentId: string): Promise<PackagesResult> {
  return api.post<PackagesResult>(`/system/${agentId}/packages`);
}

export function getDocker(agentId: string): Promise<DockerResult> {
  return api.post<DockerResult>(`/system/${agentId}/docker`);
}


export interface ListenerInfo {
  host: string;
  port: number;
  bindLoopbackOnly: boolean;
  listenUrl: string;
}

export interface SecurityInfo {
  openLan: boolean;
  allowedOrigins: string[];
}

export function getListener(): Promise<ListenerInfo> {
  return api.get<ListenerInfo>('/settings/listener');
}

export function updateListener(req: { port: number; bindLoopbackOnly?: boolean }): Promise<ListenerInfo> {
  return api.put<ListenerInfo>('/settings/listener', req);
}

export function getSecurity(): Promise<SecurityInfo> {
  return api.get<SecurityInfo>('/settings/security');
}

export function updateSecurity(req: { openLan?: boolean; allowedOrigins?: string[] }): Promise<SecurityInfo> {
  return api.put<SecurityInfo>('/settings/security', req);
}
