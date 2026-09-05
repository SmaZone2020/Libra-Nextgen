import { api } from './client';
import type { AgentListItem, AgentDetail, TrafficRecord } from '../types/models';

interface AgentListResponse {
  agents: AgentListItem[];
  total: number;
  online: number;
  page: number;
  pageSize: number;
}

export interface TrafficResponse {
  traffic: TrafficRecord[];
}

export async function getAgents(page = 1, pageSize = 50, status?: string): Promise<AgentListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set('status', status);
  return api.get<AgentListResponse>(`/agents?${params.toString()}`);
}

export async function getAgent(id: string): Promise<AgentDetail> {
  return api.get<AgentDetail>(`/agents/${id}`);
}

export async function getAgentTraffic(minutes = 30): Promise<TrafficResponse> {
  return api.get<TrafficResponse>(`/agents/traffic?minutes=${minutes}`);
}

export async function deleteAgent(id: string): Promise<void> {
  return api.delete(`/agents/${id}`);
}
