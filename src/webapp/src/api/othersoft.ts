import { api } from './client';
import type { WeChatResult, QQResult, QQPortrait, BrowserDataType, BrowserPagedResult, BrowserSearchResult, AITokenResult, SSHResult, QQClientKeyResult } from '../types/models';

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

export function searchBrowser<T>(agentId: string, type: BrowserDataType, keyword: string): Promise<BrowserSearchResult<T>> {
  return api.post<BrowserSearchResult<T>>(`/othersoft/${agentId}/browser/search`, { type, keyword });
}

export function getAI(agentId: string): Promise<AITokenResult> {
  return api.post<AITokenResult>(`/othersoft/${agentId}/ai`);
}

export function getSSH(agentId: string): Promise<SSHResult> {
  return api.post<SSHResult>(`/othersoft/${agentId}/ssh`);
}

export function getQQClientKey(agentId: string): Promise<QQClientKeyResult> {
  return api.post<QQClientKeyResult>(`/othersoft/${agentId}/qq/clientkey`);
}
