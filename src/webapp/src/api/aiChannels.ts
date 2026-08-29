import { api } from './client';
import type { AiSession } from './ai';

// ── 类型（与服务端 AiModels.cs / AiChannelController.cs 对齐）──────────────

export type AiChannelType = 'telegram' | 'lark' | 'wechat-claw';

export interface AiChannel {
  id: string;
  name: string;
  channelType: AiChannelType;
  enabled: boolean;
  /** 类型相关配置；敏感项（botToken/appSecret/encryptKey）由服务端打码为 ********。 */
  config: Record<string, string>;
  /** Justitia 基准档位：0=Cognitio 1=Arbitrium 2=Imperium 3=Dictatura。 */
  defaultTier: number;
  requireBind: boolean;
  defaultProviderId: string;
  defaultModel: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiChannelUser {
  id: string;
  channelId: string;
  externalId: string;
  externalName: string;
  boundUserId: string;
  boundUserName: string;
  tierOverride: number | null;
  createdAt: string;
  boundAt: string;
  lastSeenAt: string;
}

export interface AiChannelInput {
  name: string;
  channelType: AiChannelType;
  enabled: boolean;
  config: Record<string, string>;
  defaultTier: number;
  requireBind: boolean;
  defaultProviderId: string;
  defaultModel: string;
}

export interface AiBindCode {
  code: string;
  expiresAt: string;
}

// ── API ──────────────────────────────────────────────────────────────────

export async function getAiChannels(): Promise<AiChannel[]> {
  return api.get<AiChannel[]>('/ai/channels');
}

export async function createAiChannel(input: AiChannelInput): Promise<AiChannel> {
  return api.post<AiChannel>('/ai/channels', input);
}

export async function updateAiChannel(id: string, input: AiChannelInput): Promise<void> {
  await api.put<void>(`/ai/channels/${id}`, input);
}

export async function deleteAiChannel(id: string): Promise<void> {
  await api.delete<void>(`/ai/channels/${id}`);
}

export async function testAiChannel(
  id: string,
  input: AiChannelInput,
): Promise<{ ok: boolean; error?: string }> {
  return api.post<{ ok: boolean; error?: string }>(`/ai/channels/${id}/test`, input);
}

/** 生成一次性绑定码（15 分钟有效，仅本次响应可见）。 */
export async function createAiBindCode(channelId: string, userId: string): Promise<AiBindCode> {
  return api.post<AiBindCode>(`/ai/channels/${channelId}/bind-codes`, { userId });
}

export async function getAiChannelUsers(channelId: string): Promise<AiChannelUser[]> {
  return api.get<AiChannelUser[]>(`/ai/channels/${channelId}/users`);
}

/** 设置绑定用户档位覆盖；tier 为 null 时清除覆盖。 */
export async function setAiChannelUserTier(
  channelUserId: string,
  tier: number | null,
): Promise<void> {
  await api.put<void>(`/ai/channels/users/${channelUserId}/tier`, { tier });
}

export async function unbindAiChannelUser(channelUserId: string): Promise<void> {
  await api.delete<void>(`/ai/channels/users/${channelUserId}`);
}

/** 绑定用户自己的频道会话（控制台 AI 页"频道会话"分区）。 */
export async function getMyChannelSessions(): Promise<AiSession[]> {
  return api.get<AiSession[]>('/ai/channels/sessions');
}
