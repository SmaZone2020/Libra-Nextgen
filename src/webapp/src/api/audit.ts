import { api } from './client';
import type { AuditLogEntry } from '../types/models';

interface AuditListResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

interface AuditQuery {
  page?: number;
  pageSize?: number;
  query?: string;
  from?: string;
  to?: string;
  excludeHeartbeats?: boolean;
}

export async function getAuditLogs(params: AuditQuery = {}): Promise<AuditListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params.query) searchParams.set('query', params.query);
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.excludeHeartbeats !== undefined) searchParams.set('excludeHeartbeats', String(params.excludeHeartbeats));

  const qs = searchParams.toString();
  return api.get<AuditListResponse>(`/audit${qs ? '?' + qs : ''}`);
}
