import { api } from './client';
import type { ProcessListResult, WindowListResult, EnvVarsResult } from '../types/models';

export function getProcesses(agentId: string, lastHash?: string): Promise<ProcessListResult> {
  return api.post<ProcessListResult>(`/system/${agentId}/processes`, { lastHash: lastHash ?? null });
}

export function killProcess(agentId: string, pid: number): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/system/${agentId}/processes/kill`, { pid });
}

export function getWindows(agentId: string): Promise<WindowListResult> {
  return api.post<WindowListResult>(`/system/${agentId}/windows`);
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
