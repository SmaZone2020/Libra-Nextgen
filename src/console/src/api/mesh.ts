import { api } from './client';

export interface MeshNode {
  id: string;
  name: string;
  origin: string;
  authKind: 'password' | 'accessKey';
  username?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  lastConnectedAt?: string | null;
  lastError?: string | null;
  connected: boolean;
  /** SQLite / MongoDB of the node service, known once connected. */
  storageType?: 'sqlite' | 'mongo' | null;
}

export interface MeshAuthInput {
  kind: 'password' | 'accessKey';
  username?: string;
  secret: string;
}

export interface MeshNodeInput {
  name: string;
  origin: string;
  auth: MeshAuthInput;
}

export async function listMeshNodes(): Promise<MeshNode[]> {
  return api.get<MeshNode[]>('/mesh/nodes');
}

export async function createMeshNode(input: MeshNodeInput): Promise<MeshNode> {
  return api.post<MeshNode>('/mesh/nodes', input);
}

export async function deleteMeshNode(id: string): Promise<void> {
  return api.delete(`/mesh/nodes/${id}`);
}

export async function connectMeshNode(id: string): Promise<{
  connected: boolean;
  expiresAt?: string | null;
  storageType?: 'sqlite' | 'mongo' | null;
}> {
  return api.post(`/mesh/nodes/${id}/connect`);
}

export async function disconnectMeshNode(id: string): Promise<{ connected: boolean }> {
  return api.post(`/mesh/nodes/${id}/disconnect`);
}

export interface MeshAgentsResponse {
  agents: unknown[];
  total: number;
  online: number;
  page: number;
  pageSize: number;
}

export async function meshNodeAgents(
  id: string,
  page = 1,
  pageSize = 100,
): Promise<MeshAgentsResponse> {
  return api.get(`/mesh/nodes/${id}/agents?page=${page}&pageSize=${pageSize}`);
}
