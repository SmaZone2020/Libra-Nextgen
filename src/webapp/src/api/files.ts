import { api, getToken } from './client';

const API_BASE = 'http://127.0.0.1:5270/api';

export interface FileListResult {
  path: string;
  entries: FileEntry[];
}

export interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
  modified: string;
  attributes?: string;
}

export interface DrivesResult {
  drives: string[];
}

export interface FileOpResult {
  path: string;
  status: string;
  size?: number;
  error?: string;
}

export function listFiles(agentId: string, path: string): Promise<FileListResult> {
  return api.post<FileListResult>(`/files/${agentId}/list`, { path });
}

export function getDrives(agentId: string): Promise<DrivesResult> {
  return api.post<DrivesResult>(`/files/${agentId}/drives`);
}

export function deleteFile(agentId: string, path: string): Promise<FileOpResult> {
  return api.delete<FileOpResult>(`/files/${agentId}`, { path });
}

export function createDirectory(agentId: string, path: string): Promise<FileOpResult> {
  return api.post<FileOpResult>(`/files/${agentId}/mkdir`, { path });
}

export function renameFile(agentId: string, path: string, newName: string): Promise<FileOpResult> {
  return api.post<FileOpResult>(`/files/${agentId}/rename`, { path, newName });
}

export function moveFile(agentId: string, source: string, destination: string): Promise<FileOpResult> {
  return api.post<FileOpResult>(`/files/${agentId}/move`, { source, destination });
}

export function copyFile(agentId: string, source: string, destination: string): Promise<FileOpResult> {
  return api.post<FileOpResult>(`/files/${agentId}/copy`, { source, destination });
}

export function compressFile(agentId: string, path: string): Promise<FileOpResult> {
  return api.post<FileOpResult>(`/files/${agentId}/compress`, { path });
}

export function decompressFile(agentId: string, path: string, destination?: string): Promise<FileOpResult> {
  return api.post<FileOpResult>(`/files/${agentId}/decompress`, { path, destination });
}

export function createShortcut(agentId: string, path: string): Promise<FileOpResult> {
  return api.post<FileOpResult>(`/files/${agentId}/shortcut`, { path });
}

export async function downloadFile(agentId: string, path: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/files/${agentId}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || 'Download failed');
  }

  const blob = await res.blob();
  const fileName = path.split(/[/\\]/).pop() || 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
