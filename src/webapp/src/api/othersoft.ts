import { api } from './client';
import type { WeChatResult, QQResult } from '../types/models';

export function getWeChat(agentId: string): Promise<WeChatResult> {
  return api.post<WeChatResult>(`/othersoft/${agentId}/wechat`);
}

export function getQQ(agentId: string): Promise<QQResult> {
  return api.post<QQResult>(`/othersoft/${agentId}/qq`);
}
