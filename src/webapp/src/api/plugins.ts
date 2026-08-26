import { api, getApiOrigin } from './client';

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

/** One entry of the marketplace index (Libra-Plugins/index.json). */
export interface PluginRegistryEntry {
  pluginId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  file: string;
  size: number;
}

export interface PluginRegistryIndex {
  schemaVersion: number;
  generatedAt: string;
  pluginCount: number;
  plugins: PluginRegistryEntry[];
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
  const res = await fetch(`${getApiOrigin()}/api/plugins/manager/import`, {
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

// ── Plugin marketplace (GitHub raw, fetched directly from the browser) ──

/**
 * Standard GitHub raw base URL of the plugin market repository.
 * The index `file` field is now repo-root-relative (plugins/<id>/<name>.zip),
 * so `${PLUGIN_MARKET_BASE}/${file}` downloads the zip directly:
 *   https://github.com/SmaZone2020/Libra-Plugins/raw/refs/heads/main/plugins/<id>/<name>.zip
 * Override with VITE_PLUGIN_MARKET_BASE at build time if the repo moves.
 */
const PLUGIN_MARKET_BASE =
  import.meta.env.VITE_PLUGIN_MARKET_BASE ||
  'https://raw.githubusercontent.com/SmaZone2020/Libra-Plugins/refs/heads/main/';

const REGISTRY_CACHE_KEY = 'libra.plugin.registry';
const REGISTRY_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Drop the cached market index so the next fetch re-downloads it. */
export function clearPluginRegistryCache(): void {
  try {
    localStorage.removeItem(REGISTRY_CACHE_KEY);
  } catch {
    /* storage blocked — no-op */
  }
}

/**
 * Fetch the marketplace index.json directly from GitHub raw, caching it in
 * localStorage for up to 1 hour so repeated visits don't re-download it.
 */
export async function getPluginRegistry(options?: { force?: boolean }): Promise<PluginRegistryIndex> {
  // Serve from browser cache first (within TTL) unless force-refreshing.
  if (!options?.force) {
    try {
      const cached = localStorage.getItem(REGISTRY_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { ts: number; data: PluginRegistryIndex };
        if (Date.now() - parsed.ts < REGISTRY_TTL_MS && parsed.data?.plugins) {
          return parsed.data;
        }
      }
    } catch {
      /* stale or corrupt cache — fall through to fetch */
    }
  }

  const res = await fetch(`${PLUGIN_MARKET_BASE}/index.json`);
  if (!res.ok) throw new Error(`Failed to fetch plugin index: ${res.status}`);
  const data = (await res.json()) as PluginRegistryIndex;

  try {
    localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* storage full/blocked — cache is best-effort */
  }
  return data;
}

/** Download a marketplace archive from GitHub raw and import it. */
export async function installPluginFromRegistry(file: string): Promise<PluginRecord> {
  // `file` is repo-root-relative (plugins/<id>/<name>.zip) — encode only the
  // path segments so the slash structure survives URL encoding.
const fileUrl = file.split('/').slice(-3).map(encodeURIComponent).join('/');
  const res = await fetch(`${PLUGIN_MARKET_BASE}/${fileUrl}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const fileName = file.split('/').pop() ?? 'plugin.zip';
  const f = new File([blob], fileName, { type: 'application/zip' });
  return importPlugin(f, true);
}

export async function importPluginFromGit(gitUrl: string, enable: boolean): Promise<PluginRecord> {
  return api.post<PluginRecord>('/plugins/manager/git-import', { gitUrl, enable });
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
