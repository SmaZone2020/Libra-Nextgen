import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiBase,
  deriveHostOrigin,
  getApiOrigin,
  pingBackend,
  resolveApiOrigin,
  setOnAuthFailed,
  setOnNetworkError,
  setOnNetworkRecovered,
  setToken,
} from './client';

const CONSOLE_WINDOW = {
  location: { protocol: 'http:', hostname: 'console.local', port: '5173' },
} as Window;

describe('deriveHostOrigin (pure)', () => {
  it('derives backend origin from a frontend host', () => {
    expect(deriveHostOrigin({ protocol: 'http:', hostname: 'console.local', port: '5173' }))
      .toBe('http://console.local:5270');
  });

  it('keeps the scheme for https deployments', () => {
    expect(deriveHostOrigin({ protocol: 'https:', hostname: 'c2.example.com', port: '443' }))
      .toBe('https://c2.example.com:5270');
  });

  it('returns the same origin when served by the backend itself', () => {
    expect(deriveHostOrigin({ protocol: 'http:', hostname: 'console.local', port: '5270' }))
      .toBe('http://console.local:5270');
  });
});

describe('resolveApiOrigin (deterministic, explicit window)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Neutralize the build-time override so tests control the resolution path.
    vi.stubEnv('VITE_API_BASE', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses the build-time VITE_API_BASE when set', () => {
    vi.stubEnv('VITE_API_BASE', 'https://builtin.example.com/');
    expect(resolveApiOrigin(CONSOLE_WINDOW)).toBe('https://builtin.example.com');
  });

  it('falls back to localhost when window is unavailable', () => {
    expect(resolveApiOrigin(undefined)).toBe('http://127.0.0.1:5270');
  });

  it('derives from the window location when present', () => {
    expect(resolveApiOrigin(CONSOLE_WINDOW)).toBe('http://console.local:5270');
    expect(`${resolveApiOrigin(CONSOLE_WINDOW)}/api`).toBe('http://console.local:5270/api');
  });

  it('no longer honors a stored custom api_origin', () => {
    localStorage.setItem('api_origin', 'https://c2.example.com:8443');
    expect(resolveApiOrigin(CONSOLE_WINDOW)).toBe('http://console.local:5270');
  });
});

describe('api/client — getApiOrigin (global window path)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_API_BASE', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('falls back to localhost when the global window is unavailable', () => {
    vi.stubGlobal('window', undefined);
    expect(getApiOrigin()).toBe('http://127.0.0.1:5270');
  });
});

describe('api/client — pingBackend', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_API_BASE', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns true when the backend answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(pingBackend()).resolves.toBe(true);
  });

  it('returns true for 401 (backend reachable, auth required)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(pingBackend()).resolves.toBe(true);
  });

  it('returns false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(pingBackend()).resolves.toBe(false);
  });
});

describe('api/client — auth and error callbacks', () => {
  beforeEach(() => {
    localStorage.clear();
    setToken(null);
    vi.stubEnv('VITE_API_BASE', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('attaches the bearer token and fires onAuthFailed on 401', async () => {
    const onAuthFailed = vi.fn();
    setOnAuthFailed(onAuthFailed);

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    setToken('tok-123');

    const api = (await import('./client')).api;
    await expect(api.get('/agents')).rejects.toThrow('Authentication failed');
    expect(onAuthFailed).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The origin is environment-dependent (jsdom global visibility differs
    // across platforms); assert the stable parts: API path + bearer header.
    expect(url.endsWith('/api/agents')).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('fires network error callback and recovers on the next success', async () => {
    const onNetworkError = vi.fn();
    const onNetworkRecovered = vi.fn();
    setOnNetworkError(onNetworkError);
    setOnNetworkRecovered(onNetworkRecovered);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('refused')));
    const api = (await import('./client')).api;
    await expect(api.get('/agents')).rejects.toThrow('Network unreachable');
    expect(onNetworkError).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    await expect(api.get('/agents')).resolves.toEqual([]);
    expect(onNetworkRecovered).toHaveBeenCalledTimes(1);
  });
});
