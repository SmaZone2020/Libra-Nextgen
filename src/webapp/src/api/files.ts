import { api } from './client';

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

export interface FileReadResult {
  path: string;
  size: number;
  content: string; // base64
}

export interface FileWriteResult {
  path: string;
  size: number;
  status: string;
}

export interface FileDeleteResult {
  path: string;
  status: string;
}

export interface FileMkdirResult {
  path: string;
  status: string;
}

export function listFiles(agentId: string, path: string): Promise<FileListResult> {
  return api.post<FileListResult>(`/files/${agentId}/list`, { path });
}

export function getDrives(agentId: string): Promise<DrivesResult> {
  return api.post<DrivesResult>(`/files/${agentId}/drives`);
}

export function readFile(agentId: string, path: string): Promise<FileReadResult> {
  return api.post<FileReadResult>(`/files/${agentId}/read`, { path });
}

export function writeFile(agentId: string, path: string, content: string): Promise<FileWriteResult> {
  return api.post<FileWriteResult>(`/files/${agentId}/write`, { path, content });
}

export function deleteFile(agentId: string, path: string): Promise<FileDeleteResult> {
  return api.delete<FileDeleteResult>(`/files/${agentId}`, { path });
}

export function createDirectory(agentId: string, path: string): Promise<FileMkdirResult> {
  return api.post<FileMkdirResult>(`/files/${agentId}/mkdir`, { path });
}
