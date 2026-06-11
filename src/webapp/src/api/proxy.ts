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

export function buildResourceUrl(
  agentId: string,
  absoluteUrl: string,
  method?: string,
  body?: string,
  headers?: string
): string {
  const token = getToken();
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  let url = `${API_BASE}/proxy/${agentId}/resource?url=${encodeURIComponent(absoluteUrl)}${tokenParam}`;
  if (method && method !== 'GET') url += `&method=${encodeURIComponent(method)}`;
  if (body) url += `&body=${encodeURIComponent(body)}`;
  if (headers) url += `&headers=${encodeURIComponent(headers)}`;
  return url;
}
