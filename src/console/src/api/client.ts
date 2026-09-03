
const DEFAULT_BACKEND_PORT = 5270;

/** Build-time base override; read lazily so tests can stub it per-case. */
function builtinApiOrigin(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || '';
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
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
 *   1. build-time VITE_API_BASE
 *   2. derive from the page location (same-origin when served by the backend)
 *   3. fallback http://127.0.0.1:5270
 *
 * Exported so tests can pass a deterministic window regardless of whether
 * the test runner exposes the jsdom global to the module scope (this differs
 * across platforms/versions).
 */
export function resolveApiOrigin(win?: Window | undefined): string {
  const builtin = builtinApiOrigin();
  if (builtin) return stripTrailingSlash(builtin);
  if (win) {
    const derived = deriveHostOrigin(win.location);
    if (derived) return derived;
  }
  return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
}

export function getApiOrigin(): string {
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

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
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
