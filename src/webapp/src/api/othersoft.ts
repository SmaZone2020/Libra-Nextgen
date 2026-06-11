import { api } from './client';
import type { WeChatResult, QQResult, QQUserInfo } from '../types/models';

export function getWeChat(agentId: string): Promise<WeChatResult> {
  return api.post<WeChatResult>(`/othersoft/${agentId}/wechat`);
}

export function getQQ(agentId: string): Promise<QQResult> {
  return api.post<QQResult>(`/othersoft/${agentId}/qq`);
}

export function getQQInfo(qq: string): Promise<QQUserInfo> {
  return api.get<QQUserInfo>(`/othersoft/qqinfo/${qq}`);
}
