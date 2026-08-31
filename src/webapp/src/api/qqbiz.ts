import { api } from './client';

export interface QQBizParams {
  uin: string;
  clientkey: string;
  text?: string;
  nickname?: string;
  company?: string;
  qunn?: string;
  busId?: string;
  fileId?: string;
  targetUin?: string;
  careAction?: number;
  geqian?: boolean;
}

export interface QQBizResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export function qqBiz(action: string, params: QQBizParams): Promise<QQBizResult> {
  return api.post<QQBizResult>(`/plugin/com.libra.qqkey/${action}`, params);
}