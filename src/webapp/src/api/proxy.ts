import { api, getToken } from './client';
import type { ProxyResponse } from '../types/models';

export const API_BASE = 'http://127.0.0.1:5270/api';

export function fetchPage(
  agentId: string,
  url: string,
  method = 'GET',
  headers?: string,
  body?: string
): Promise<ProxyResponse> {
  return api.post<ProxyResponse>(`/proxy/${agentId}/fetch`, { url, method, headers, body });
}

export function buildResourceUrl(agentId: string, absoluteUrl: string): string {
  const token = getToken();
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  return `${API_BASE}/proxy/${agentId}/resource?url=${encodeURIComponent(absoluteUrl)}${tokenParam}`;
}
