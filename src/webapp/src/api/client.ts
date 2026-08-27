/**
 * API 基址解析（运行时，非编译期）：
 *
 * 优先级（高 → 低）：
 *   1. VITE_API_BASE（构建配置文件，.env / vite define）
 *   2. 前端 Host 推导（默认）：取 window.location.host（host + port），
 *      若前端本身就是后端同源（端口 5270，由后端托管），直接用同源 origin；
 *      否则用 window.location.host 的主机名拼后端默认端口 5270
 *   3. 兜底 http://127.0.0.1:5270
 *
 * 后端监听端口由 设置 → 安全 修改（服务端设置，非前端可改的请求地址）。
 * 通过 getApiOrigin() 每次调用实时解析。
 */

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
  // 前端本身由后端托管（同源）→ 直接用同源地址
  if (location.port === String(DEFAULT_BACKEND_PORT)) {
    return `${location.protocol}//${location.hostname}:${location.port}`;
  }
  // 否则按前端 hostname 推导后端地址（保持协议一致，如 https 部署）
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

/** 探测后端是否可达（fetch 到 auth/status 或任意端点，返回是否收到响应）。 */
export async function pingBackend(origin?: string): Promise<boolean> {
  const target = origin?.trim() ? stripTrailingSlash(origin.trim()) : getApiOrigin();
  try {
    const resp = await fetch(`${target}/api/auth/status`, {
      method: 'GET',
      // 短超时：离线时快速失败，避免断线重连页卡住
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
