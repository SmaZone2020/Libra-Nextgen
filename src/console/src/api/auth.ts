import { api, setToken } from './client';
import type { LoginRequest, LoginResponse, SetupRequest } from '../types/models';

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>('/auth/login', req);
  setToken(res.token);
  return res;
}

export async function checkSetupStatus(): Promise<boolean> {
  const res = await api.get<{ needsSetup: boolean }>('/auth/status');
  return res.needsSetup;
}

export async function setup(req: SetupRequest): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>('/auth/setup', req);
  setToken(res.token);
  return res;
}

export function logout() {
  setToken(null);
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem('token');
}

export function getStoredUser(): { username: string; role: string } | null {
  const token = localStorage.getItem('token');
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1]!));
    return {
      username: payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']
        || payload['unique_name'] || payload['sub'] || 'unknown',
      role: payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
        || payload['role'] || 'Operator',
    };
  } catch {
    return null;
  }
}
