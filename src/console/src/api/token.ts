import { api } from './client';

export interface TokenItem {
  id: number;
  pid: number;
  username: string;
}

export interface TokenListResult {
  success: boolean;
  tokens: TokenItem[];
  error?: string;
}

export interface TokenActionResult {
  success: boolean;
  username?: string;
  token?: TokenItem;
  error?: string;
}

export function listTokens(agentId: string): Promise<TokenListResult> {
  return api.post<TokenListResult>(`/token/${agentId}/list`);
}

export function stealToken(agentId: string, pid: number): Promise<TokenActionResult> {
  return api.post<TokenActionResult>(`/token/${agentId}/steal`, { pid });
}

export function makeToken(agentId: string, username: string, password: string, domain: string): Promise<TokenActionResult> {
  return api.post<TokenActionResult>(`/token/${agentId}/make`, { username, password, domain });
}

export function impersonateToken(agentId: string, id: number, pid: number): Promise<TokenActionResult> {
  return api.post<TokenActionResult>(`/token/${agentId}/impersonate`, { id, pid });
}

export function revertToken(agentId: string): Promise<TokenActionResult> {
  return api.post<TokenActionResult>(`/token/${agentId}/revert`);
}
