import { api } from './client';
import type { WeChatResult, QQResult, QQPortrait, BrowserDataType, BrowserPagedResult, AITokenResult } from '../types/models';

export function getWeChat(agentId: string): Promise<WeChatResult> {
  return api.post<WeChatResult>(`/othersoft/${agentId}/wechat`);
}

export function getQQ(agentId: string): Promise<QQResult> {
  return api.post<QQResult>(`/othersoft/${agentId}/qq`);
}

export function getQQPortrait(qqNumbers: string[]): Promise<Record<string, QQPortrait>> {
  return api.post<Record<string, QQPortrait>>('/othersoft/qqportrait', { qq: qqNumbers });
}

export function getBrowser<T>(agentId: string, type: BrowserDataType, offset: number, limit: number): Promise<BrowserPagedResult<T>> {
  return api.post<BrowserPagedResult<T>>(`/othersoft/${agentId}/browser`, { type, offset, limit });
}

export function getAI(agentId: string): Promise<AITokenResult> {
  return api.post<AITokenResult>(`/othersoft/${agentId}/ai`);
}
