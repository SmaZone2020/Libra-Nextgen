import { getToken, apiBase, getApiOrigin } from './client';
import type { BuildConfigRequest, BuildRecord, BuildRecordDetail, TemplateInfo } from '../types/models';

export async function uploadIcon(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${apiBase()}/builder/upload-icon`, {
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
  const response = await fetch(`${apiBase()}/builder/build`, {
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
  return `${apiBase()}/builder/stream/${buildId}?token=${encodeURIComponent(getToken() || '')}`;
}

export async function listBuilds(): Promise<BuildRecord[]> {
  const response = await fetch(`${apiBase()}/builder/list`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to list builds (HTTP ${response.status})`);
  }

  return response.json();
}

export async function getBuildInfo(buildId: string): Promise<BuildRecordDetail> {
  const response = await fetch(`${apiBase()}/builder/info/${buildId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get build info (HTTP ${response.status})`);
  }

  return response.json();
}

export function getBuildDownloadUrl(buildId: string): string {
  return `${apiBase()}/builder/download/${buildId}?token=${encodeURIComponent(getToken() || '')}`;
}

/** 鎸夋牸寮忎笅杞芥瀯寤轰骇鐗╋紙iso/img/vhd/lnk锛涚己鐪?= 鍘熷 exe锛夈€?*/
export function getBuildDownloadUrlByFormat(buildId: string, format: string): string {
  const token = encodeURIComponent(getToken() || '');
  return `${apiBase()}/builder/download/${buildId}?token=${token}&format=${encodeURIComponent(format)}`;
}

/** 鍖垮悕涓嬭浇 URL锛堟棤闇€閴存潈锛屼緵涓€閿懡浠?/ LNK 鍐呭祵浣跨敤锛涘垹闄ゆ瀯寤哄嵆澶辨晥锛夈€?*/
export function getArtifactUrl(buildId: string): string {
  return `${getApiOrigin()}/api/beacon/artifact/${buildId}`;
}

export async function deleteBuild(buildId: string): Promise<void> {
  const response = await fetch(`${apiBase()}/builder/${buildId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(err.error || `Delete failed (HTTP ${response.status})`);
  }
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const response = await fetch(`${apiBase()}/builder/template`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) throw new Error(`Failed to list templates (HTTP ${response.status})`);
  return response.json();
}

export async function uploadTemplate(file: File, platform: string): Promise<TemplateInfo> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('platform', platform);

  const response = await fetch(`${apiBase()}/builder/template/upload`, {
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
  const response = await fetch(`${apiBase()}/builder/template/${platform}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(err.error || `Delete failed (HTTP ${response.status})`);
  }
}

/** 浠呮瀯寤轰簯妯″潡锛堜笉鏋勫缓 agent锛夈€傝繑鍥?buildId锛堝巻鍙?鏃ュ織娴佺敤锛夈€?*/
export async function buildModules(platform: string, enabledModules: string[]): Promise<string> {
  const response = await fetch(`${apiBase()}/builder/modules`, {
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

/** 鏋氫妇骞冲彴妯″潡锛堟枃浠跺悕椹卞姩锛屽惈鎻掍欢 dll锛夛細{name, enabled}[]銆?*/
export async function listModules(platform: string): Promise<ModuleEntry[]> {
  const response = await fetch(`${apiBase()}/builder/modules?platform=${encodeURIComponent(platform)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) throw new Error(`Failed to list modules (HTTP ${response.status})`);
  const data = await response.json();
  return data.modules ?? [];
}

/** 鍚敤/绂佺敤妯″潡锛堥噸鍛藉悕 .dll 鈫?.dll.disable锛夈€?*/
export async function toggleModule(platform: string, name: string, enabled: boolean): Promise<void> {
  const response = await fetch(`${apiBase()}/builder/modules/toggle`, {
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

// 鈹€鈹€ 娴侀噺浼鎸佷箙鍖栧垪琛?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
  const response = await fetch(`${apiBase()}/builder/lists`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) throw new Error(`Failed to load lists (HTTP ${response.status})`);
  return response.json();
}

export async function addBuildListItem(list: TrafficListName, value: string): Promise<BuildTrafficLists> {
  const response = await fetch(`${apiBase()}/builder/lists/item`, {
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
  const response = await fetch(`${apiBase()}/builder/lists/toggle`, {
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
  const response = await fetch(`${apiBase()}/builder/lists/delete`, {
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
