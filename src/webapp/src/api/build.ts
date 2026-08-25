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
