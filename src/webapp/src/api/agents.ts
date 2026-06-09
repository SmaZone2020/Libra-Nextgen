import { api } from './client';
import type { AgentListItem, AgentDetail } from '../types/models';

interface AgentListResponse {
  agents: AgentListItem[];
  total: number;
  online: number;
  page: number;
  pageSize: number;
}

export async function getAgents(page = 1, pageSize = 50): Promise<AgentListResponse> {
  return api.get<AgentListResponse>(`/agents?page=${page}&pageSize=${pageSize}`);
}

export async function getAgent(id: string): Promise<AgentDetail> {
  return api.get<AgentDetail>(`/agents/${id}`);
}

export async function deleteAgent(id: string): Promise<void> {
  return api.delete(`/agents/${id}`);
}
