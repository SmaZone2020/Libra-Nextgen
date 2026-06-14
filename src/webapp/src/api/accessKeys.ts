import { api } from './client';

export interface AccessKeyItem {
  id: string;
  name: string;
  keyPreview: string;
  createdByUserName: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  isActive: boolean;
}

export interface AccessKeyCreateResponse {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  expiresAt?: string;
}

export async function listAccessKeys(): Promise<AccessKeyItem[]> {
  return api.get<AccessKeyItem[]>('/access-keys');
}

export async function createAccessKey(data: { name: string; expiresAt?: string }): Promise<AccessKeyCreateResponse> {
  return api.post<AccessKeyCreateResponse>('/access-keys', data);
}

export async function deleteAccessKey(id: string): Promise<void> {
  return api.delete<void>(`/access-keys/${id}`);
}
