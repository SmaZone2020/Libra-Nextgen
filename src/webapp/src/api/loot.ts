import { api, API_ORIGIN, getToken } from './client';

export interface LootItem {
  id: string;
  agentId: string;
  kind: 'screenshot' | 'download';
  name: string;
  size: number;
  createdAt: string;
}

export interface LootPage {
  items: LootItem[];
  total: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function getLoot(
  agentId?: string,
  kind?: string,
  page = 1,
  pageSize = 60,
): Promise<LootPage> {
  return api.get<LootPage>(`/loot${qs({ agentId, kind, page, pageSize })}`);
}

/**
 * 拉取 loot 内容为 blob URL（带 Authorization header，供 <img> 使用）。
 */
export async function fetchLootContent(id: string): Promise<string> {
  const token = getToken();
  const resp = await fetch(`${API_ORIGIN}/api/loot/${id}/content`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`load failed: ${resp.status}`);
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
