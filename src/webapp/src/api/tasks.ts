import { api } from './client';
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

export async function createTask(req: TaskCreateRequest): Promise<AgentTask> {
  return api.post<AgentTask>('/tasks', req);
}

export async function deleteTask(id: string): Promise<void> {
  return api.delete(`/tasks/${id}`);
}
