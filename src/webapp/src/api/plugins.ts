import { api } from './client';

// ── Types mirroring the server's PluginModels ─────────────────────────

export interface PluginArgProperty {
  type: string;
  title?: string;
}

export interface PluginArgsSchema {
  type: string;
  properties?: Record<string, PluginArgProperty>;
  required?: string[];
}

export interface PluginModuleRef {
  kind: 'script' | 'native';
  name: string;
  op?: string;
  entry?: string;
}

export interface PluginAction {
  action: string;
  label: string;
  method: string;
  argsSchema?: PluginArgsSchema;
  module?: PluginModuleRef;
}

export interface PluginEntry {
  route: string;
  label: string;
  icon: string;
  apiRoot: string;
}

export interface PluginMeta {
  schemaVersion: number;
  pluginId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  entry?: PluginEntry;
  i18n?: Record<string, Record<string, string>>;
  actions: PluginAction[];
}

export interface PluginRecord {
  id: string;
  pluginId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  entry?: PluginEntry;
  i18n?: Record<string, Record<string, string>>;
  actions: PluginAction[];
  enabled: boolean;
  installedAt: string;
  updatedAt?: string;
}

export interface PluginManifest {
  id: string;
  pluginId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  entry?: PluginEntry;
  i18n?: Record<string, Record<string, string>>;
  actions: PluginAction[];
}

// ── Management API ─────────────────────────────────────────────────────

export async function listPlugins(): Promise<PluginRecord[]> {
  return api.get<PluginRecord[]>('/plugins/manager');
}

export async function getPluginManifests(): Promise<PluginManifest[]> {
  return api.get<PluginManifest[]>('/plugins/manager/manifests');
}

export async function getPlugin(id: string): Promise<PluginRecord> {
  return api.get<PluginRecord>(`/plugins/manager/${id}`);
}

export async function importPlugin(file: File, enable: boolean): Promise<PluginRecord> {
  const form = new FormData();
  form.append('file', file);
  form.append('enable', String(enable));
  const res = await fetch(`${import.meta.env.VITE_API_BASE || 'http://127.0.0.1:5270'}/api/plugins/manager/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Import failed: ${res.status}`);
  }
  return res.json();
}

export async function createPlugin(meta: PluginMeta): Promise<PluginRecord> {
  return api.post<PluginRecord>('/plugins/manager', { meta });
}

export async function updatePlugin(id: string, meta: PluginMeta): Promise<PluginRecord> {
  return api.put<PluginRecord>(`/plugins/manager/${id}`, { meta });
}

export async function deletePlugin(id: string): Promise<void> {
  await api.delete<void>(`/plugins/manager/${id}`);
}

export async function togglePlugin(id: string, enabled: boolean): Promise<PluginRecord> {
  return api.post<PluginRecord>(`/plugins/manager/${id}/toggle`, { enabled });
}

// ── Action invocation ──────────────────────────────────────────────────

export async function invokePluginAction(
  pluginId: string,
  action: string,
  agentId: string,
  args?: Record<string, unknown>,
): Promise<{ pluginId: string; action: string; result?: unknown }> {
  return api.post(`/plugins/${pluginId}/${action}`, { agentId, args });
}
