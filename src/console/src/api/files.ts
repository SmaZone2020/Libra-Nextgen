import { api, getToken, apiBase } from './client';

export interface FileListResult {
  path: string;
  entries: FileEntry[];
  total?: number;
  offset?: number;
}

export interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
  modified: string;
  attributes?: string;
}

export interface DriveInfo {
  path: string;
  /** local | removable | network | cdrom | ram | unknown */
  kind: string;
  /** total capacity in bytes */
  total: number;
  /** free space in bytes */
  free: number;
}

export interface SpecialDir {
  /** desktop | downloads | documents | pictures | music | videos | user */
  name: string;
  path: string;
}

export interface DrivesResult {
  drives: DriveInfo[];
  special: SpecialDir[];
}

export interface FileOpResult {
  path: string;
  status: string;
  size?: number;
  error?: string;
}

export function listFiles(agentId: string, path: string, offset = 0, limit = 200): Promise<FileListResult> {
  return api.post<FileListResult>(`/files/${agentId}/list`, { path, offset, limit });
}

export interface ReadFileResult {
  path: string;
  size: number;
  content: string;
  error?: string;
}

export function readFile(agentId: string, path: string): Promise<ReadFileResult> {
  return api.post<ReadFileResult>(`/files/${agentId}/read`, { path });
}

export function openFile(agentId: string, path: string): Promise<FileOpResult> {
  return api.post<FileOpResult>(`/files/${agentId}/open`, { path });
}

export function listArchive(agentId: string, path: string): Promise<FileListResult> {
  return api.post<FileListResult>(`/files/${agentId}/archive/list`, { path });
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

export interface DownloadProgress {
  received: number;
  total: number;
  /** bytes per second (smoothed over a sliding window) */
  speed: number;
}

export interface DownloadOptions {
  /** Known file size (from the listing); used when the server sends no Content-Length. */
  total?: number;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
}

/**
 * Download a file from an agent with progress reporting. The response body is
 * consumed as a stream so the UI can render live progress/speed while the
 * browser assembles the blob.
 */
export async function downloadFile(agentId: string, path: string, opts?: DownloadOptions): Promise<void> {
  const token = getToken();
  const res = await fetch(`${apiBase()}/files/${agentId}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path }),
    signal: opts?.signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(err.error || 'Download failed');
  }

  const total = (opts?.total && opts.total > 0) ? opts.total : Number(res.headers.get('Content-Length')) || 0;
  const fileName = path.split(/[/\\]/).pop() || 'download';

  if (!res.body) {
    const blob = await res.blob();
    triggerBlobDownload(blob, fileName);
    opts?.onProgress?.({ received: total || blob.size, total: total || blob.size, speed: 0 });
    return;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let speed = 0;

  // Sliding window for speed: drop samples older than 3s.
  const samples: Array<{ t: number; bytes: number }> = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    const now = performance.now();
    samples.push({ t: now, bytes: received });
    while (samples.length > 1 && now - samples[0]!.t > 3000) samples.shift();
    const first = samples[0]!;
    const span = (now - first.t) / 1000;
    if (span > 0.2) speed = (received - first.bytes) / span;

    opts?.onProgress?.({ received, total, speed });
  }

  opts?.onProgress?.({ received, total, speed: 0 });
  const blob = new Blob(chunks);
  triggerBlobDownload(blob, fileName);
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
