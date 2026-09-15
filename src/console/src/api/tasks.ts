import { api, apiForNode } from './client';
import type { AgentTask, TaskCreateRequest } from '../types/models';

interface TaskListResponse {
  tasks: AgentTask[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getTasks(
  agentId?: string,
  status?: string,
  page = 1,
  pageSize = 50
): Promise<TaskListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (agentId) params.set('agentId', agentId);
  if (status) params.set('status', status);
  return api.get<TaskListResponse>(`/tasks?${params}`);
}

export async function getTask(id: string): Promise<AgentTask> {
  return api.get<AgentTask>(`/tasks/${id}`);
}

/** `nodeId` targets the agent on that mesh node instead of the home service
 *  (used before a remote device is connected). */
export async function createTask(req: TaskCreateRequest, nodeId?: string): Promise<AgentTask> {
  const client = nodeId ? apiForNode(nodeId) : api;
  return client.post<AgentTask>('/tasks', req);
}

export async function deleteTask(id: string): Promise<void> {
  return api.delete(`/tasks/${id}`);
}
