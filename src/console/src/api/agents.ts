import { api, apiForNode } from './client';
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

/** `nodeId` fetches the agent from that mesh node instead of the home service
 *  (used before a remote device is connected). */
export async function getAgent(id: string, nodeId?: string): Promise<AgentDetail> {
  const client = nodeId ? apiForNode(nodeId) : api;
  return client.get<AgentDetail>(`/agents/${id}`);
}

export async function getAgentTraffic(minutes = 30): Promise<TrafficResponse> {
  return api.get<TrafficResponse>(`/agents/traffic?minutes=${minutes}`);
}

export async function deleteAgent(id: string, nodeId?: string): Promise<void> {
  const client = nodeId ? apiForNode(nodeId) : api;
  return client.delete(`/agents/${id}`);
}
