import { api, setToken } from './client';
import type { LoginRequest, LoginResponse } from '../types/models';

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>('/auth/login', req);
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
      username: payload['unique_name'] || payload['sub'] || 'unknown',
      role: payload['role'] || 'Operator',
    };
  } catch {
    return null;
  }
}
