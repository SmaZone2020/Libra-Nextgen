
const DEFAULT_BACKEND_PORT = 5270;

/** localStorage key for a user-set backend origin (set from the disconnect page). */
export const API_ORIGIN_OVERRIDE_KEY = 'libra.api.origin';

export function getApiOriginOverride(): string {
  try {
    return (localStorage.getItem(API_ORIGIN_OVERRIDE_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function setApiOriginOverride(origin: string): void {
  const value = stripTrailingSlash(origin.trim());
  try {
    if (value) localStorage.setItem(API_ORIGIN_OVERRIDE_KEY, value);
    else localStorage.removeItem(API_ORIGIN_OVERRIDE_KEY);
  } catch { /* storage unavailable */ }
}

/** Build-time base override; read lazily so tests can stub it per-case. */
function builtinApiOrigin(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || '';
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Build-time markers that make the API mirror the page origin exactly. */
const SAME_ORIGIN_MARKERS = ['same-origin', 'http://*:*'];

function isSameOriginMarker(value: string): boolean {
  return SAME_ORIGIN_MARKERS.includes(value.trim().toLowerCase());
}

function pageOrigin(location: { protocol: string; hostname: string; port: string }): string {
  const host = location.port ? `${location.hostname}:${location.port}` : location.hostname;
  return `${location.protocol}//${host}`;
}

/**
 * Derive the backend origin from the frontend page location.
 * Pure function (no global access) so it is unit-testable.
 */
export function deriveHostOrigin(location: { protocol: string; hostname: string; port: string }): string {
  if (location.port === String(DEFAULT_BACKEND_PORT)) {
    return `${location.protocol}//${location.hostname}:${location.port}`;
  }
  return `${location.protocol}//${location.hostname}:${DEFAULT_BACKEND_PORT}`;
}

/**
 * Resolve the API origin with an explicit window handle.
 *
 * Priority (high → low):
 *   1. build-time VITE_API_BASE — 'same-origin' (or 'http://*:*') mirrors the page origin;
 *      any other value is used verbatim
 *   2. derive from the page location (same-origin when served by the backend)
 *   3. fallback http://127.0.0.1:5270
 *
 * Exported so tests can pass a deterministic window regardless of whether
 * the test runner exposes the jsdom global to the module scope (this differs
 * across platforms/versions).
 */
export function resolveApiOrigin(win?: Window | undefined): string {
  const builtin = builtinApiOrigin();
  if (builtin) {
    if (isSameOriginMarker(builtin)) {
      // Mirror the page origin: console and API share the nginx entry, so this
      // works for any host/IP/domain without baking the URL at build time.
      if (win) return pageOrigin(win.location);
      return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
    }
    return stripTrailingSlash(builtin);
  }
  if (win) {
    const derived = deriveHostOrigin(win.location);
    if (derived) return derived;
  }
  return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
}

export function getApiOrigin(): string {
  // A user-set origin (from the disconnect page) wins over everything else.
  const override = getApiOriginOverride();
  if (override) return stripTrailingSlash(override);
  return resolveApiOrigin((globalThis as { window?: Window }).window);
}

export function apiBase(): string {
  return `${getApiOrigin()}/api`;
}

export async function pingBackend(origin?: string): Promise<boolean> {
  const target = origin?.trim() ? stripTrailingSlash(origin.trim()) : getApiOrigin();
  try {
    const resp = await fetch(`${target}/api/auth/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    return resp.ok || resp.status === 401 || resp.status === 500;
  } catch {
    return false;
  }
}

let authToken: string | null = localStorage.getItem('token');
let onAuthFailed: (() => void) | null = null;
let onNetworkError: (() => void) | null = null;
let onNetworkRecovered: (() => void) | null = null;
let isOffline = false;

export function setOnAuthFailed(cb: (() => void) | null) {
  onAuthFailed = cb;
}

export function setOnNetworkError(cb: (() => void) | null) {
  onNetworkError = cb;
}

export function setOnNetworkRecovered(cb: (() => void) | null) {
  onNetworkRecovered = cb;
}

export function setToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

export function getToken(): string | null {
  return authToken;
}

// ── Cross-node routing (workspace mesh) ────────────────────────────────────
//
// While a remote node agent is selected (AgentContext.remote), console
// feature calls that target agents are transparently forwarded through the
// hub relay (`/api/mesh/nodes/{id}/relay/{path}`). Only the agent-operation
// surface relays; everything else (mesh, plugins, ai, settings, audit, …)
// always stays on the home service. Hub-local polling (the agent list in
// AgentContext, dashboard traffic) uses `apiHome` to never follow the relay.

let apiNodeTarget: string | null = null;

export function setApiNodeTarget(nodeId: string | null) {
  apiNodeTarget = nodeId;
}

export function getApiNodeTarget(): string | null {
  return apiNodeTarget;
}

const RELAY_ALLOWED_FIRST = new Set([
  'agents', 'tasks', 'files', 'othersoft', 'proxy', 'token', 'system',
]);

/** Hub-local system administration never relays, even under /system. */
const SYSTEM_LOCAL_SEGMENTS = new Set(['storage', 'listener']);

function shouldRelay(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  const first = segments[0]?.toLowerCase();
  if (!first || !RELAY_ALLOWED_FIRST.has(first)) return false;
  if (first === 'system') {
    const second = segments[1]?.toLowerCase();
    if (!second || SYSTEM_LOCAL_SEGMENTS.has(second)) return false;
  }
  return true;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  preferHome = false,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Feature calls follow the selected remote node; home-pinned callers
  // (agent polling, dashboard traffic) pass preferHome.
  const target = !preferHome && apiNodeTarget && shouldRelay(path)
    ? `/mesh/nodes/${apiNodeTarget}/relay/${path.replace(/^\//, '')}`
    : path;

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${target}`, {
      ...options,
      headers,
    });
  } catch {
    // Network error (ERR_CONNECTION_REFUSED etc.)
    if (!isOffline) {
      isOffline = true;
      onNetworkError?.();
    }
    throw new Error('Network unreachable');
  }

  // Network recovered
  if (isOffline) {
    isOffline = false;
    onNetworkRecovered?.();
  }

  if (response.status === 401) {
    onAuthFailed?.();
    throw new Error('Authentication failed. Please log in again.');
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
};

/** Always hits the home service, bypassing any active remote-node relay. */
export const apiHome = {
  get: <T>(path: string) => request<T>(path, {}, true),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }, true),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }, true),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }, true),
};
