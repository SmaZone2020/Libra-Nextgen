import { API_ORIGIN, getToken } from './client';

export const API_BASE = `${API_ORIGIN}/api`;

export function buildProxyUrl(agentId: string, url: string): string {
  const token = getToken() ?? '';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    u = new URL(`http://${url}`);
  }
  const scheme = u.protocol.replace(':', '');
  const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  const path = u.pathname.replace(/^\/+/, '');
  let result = `${API_ORIGIN}/api/proxy/${agentId}/${token}/p/${scheme}/${host}`;
  if (path) result += `/${path}`;
  result += u.search;
  return result;
}
