import { api } from './client';
import type { WeChatResult, QQResult, QQPortrait } from '../types/models';

export function getWeChat(agentId: string): Promise<WeChatResult> {
  return api.post<WeChatResult>(`/othersoft/${agentId}/wechat`);
}

export function getQQ(agentId: string): Promise<QQResult> {
  return api.post<QQResult>(`/othersoft/${agentId}/qq`);
}

export function getQQPortrait(qqNumbers: string[]): Promise<Record<string, QQPortrait>> {
  return api.post<Record<string, QQPortrait>>('/othersoft/qqportrait', { qq: qqNumbers });
}
