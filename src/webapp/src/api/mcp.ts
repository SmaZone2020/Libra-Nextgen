import { api } from './client';

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpInfo {
  enabled: boolean;
  endpoint: string;
  transport: string;
  auth: string;
  tools: McpToolInfo[];
}

export async function getMcpInfo(): Promise<McpInfo> {
  return api.get<McpInfo>('/mcp/info');
}

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await api.post<void>('/mcp/toggle', { enabled });
}
