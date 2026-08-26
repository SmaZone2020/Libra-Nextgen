/**
 * API 基址解析（运行时，非编译期）：
 *
 * 优先级（高 → 低）：
 *   1. 首选项 localStorage `api_origin`（用户在 设置 → 首选项 中显式设置）
 *   2. VITE_API_BASE（构建配置文件，.env / vite define）
 *   3. 前端 Host 推导（默认）：取 window.location.hostname，拼后端默认端口 5270；
 *      若前端本身就是后端同源（端口 5270，由后端托管），直接用同源 origin
 *   4. 兜底 http://127.0.0.1:5270
 *
 * 通过 getApiOrigin() 每次调用实时解析，修改首选项后无需刷新即可生效。
 */

const API_ORIGIN_KEY = 'api_origin';
const DEFAULT_BACKEND_PORT = 5270;

const BUILTIN_API_ORIGIN = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || '';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function deriveHostOrigin(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  // 前端本身由后端托管（同源）→ 直接用同源地址
  if (port === String(DEFAULT_BACKEND_PORT)) {
    return window.location.origin;
  }
  // 否则按前端 hostname 推导后端地址（保持协议一致，如 https 部署）
  return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
}

export function getApiOrigin(): string {
  const stored = localStorage.getItem(API_ORIGIN_KEY)?.trim();
  if (stored) return stripTrailingSlash(stored);
  if (BUILTIN_API_ORIGIN) return stripTrailingSlash(BUILTIN_API_ORIGIN);
  const derived = deriveHostOrigin();
  if (derived) return derived;
  return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
}

/** 用户在首选项中设置自定义后端地址；传空/null 清除 → 恢复默认解析。 */
export function setApiOrigin(url: string | null | undefined): void {
  const value = url?.trim();
  if (value) localStorage.setItem(API_ORIGIN_KEY, stripTrailingSlash(value));
  else localStorage.removeItem(API_ORIGIN_KEY);
}

/** 当前是否被首选项覆盖（区别于默认解析）。 */
export function hasCustomApiOrigin(): boolean {
  return Boolean(localStorage.getItem(API_ORIGIN_KEY)?.trim());
}

export function apiBase(): string {
  return `${getApiOrigin()}/api`;
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
