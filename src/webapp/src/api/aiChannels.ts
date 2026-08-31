import { api } from './client';
import type { AiSession } from './ai';


export type AiChannelType = 'telegram' | 'lark' | 'wechat-claw';

export interface AiChannel {
  id: string;
  name: string;
  channelType: AiChannelType;
  enabled: boolean;
  config: Record<string, string>;
  defaultTier: number;
  requireBind: boolean;
  defaultProviderId: string;
  defaultModel: string;
  showToolCalls: boolean;
  streamOutput: boolean;
  allowInGroups: boolean;
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
  showToolCalls: boolean;
  streamOutput: boolean;
  allowInGroups: boolean;
}

export interface AiBindCode {
  code: string;
  expiresAt: string;
  bindUrl?: string | null;
}

export interface AiChannelWechatQrCode {
  qrcode: string;
  imageUrl: string;
}

export interface AiChannelQrStatus {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | string;
  botToken?: string | null;
  ilinkBotId?: string | null;
  baseUrl?: string | null;
}

export interface AiBindCodeInfo {
  id: string;
  boundUserId: string;
  boundUserName: string;
  codeTail: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  usedByExternalName?: string | null;
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

export async function getAiChannelWechatQrCode(): Promise<AiChannelWechatQrCode> {
  return api.post<AiChannelWechatQrCode>('/ai/channels/wechat/qrcode');
}

export async function getAiChannelQrStatus(qrcode: string): Promise<AiChannelQrStatus> {
  return api.post<AiChannelQrStatus>('/ai/channels/wechat/qrcode/status', { qrcode });
}

export async function setAiChannelWechatToken(
  channelId: string,
  token: string,
  baseUrl?: string | null,
  ilinkBotId?: string | null,
): Promise<void> {
  await api.post<void>(`/ai/channels/${channelId}/token`, { token, baseUrl, ilinkBotId });
}

export async function createAiBindCode(channelId: string, userId: string): Promise<AiBindCode> {
  return api.post<AiBindCode>(`/ai/channels/${channelId}/bind-codes`, { userId });
}

export async function getAiChannelUsers(channelId: string): Promise<AiChannelUser[]> {
  return api.get<AiChannelUser[]>(`/ai/channels/${channelId}/users`);
}

export async function getAiChannelBindCodes(channelId: string): Promise<AiBindCodeInfo[]> {
  return api.get<AiBindCodeInfo[]>(`/ai/channels/${channelId}/bind-codes`);
}

export async function revokeAiBindCode(channelId: string, codeId: string): Promise<void> {
  await api.delete<void>(`/ai/channels/${channelId}/bind-codes/${codeId}`);
}

export async function setAiChannelUserTier(
  channelUserId: string,
  tier: number | null,
): Promise<void> {
  await api.put<void>(`/ai/channels/users/${channelUserId}/tier`, { tier });
}

export async function unbindAiChannelUser(channelUserId: string): Promise<void> {
  await api.delete<void>(`/ai/channels/users/${channelUserId}`);
}

export async function getMyChannelSessions(): Promise<AiSession[]> {
  return api.get<AiSession[]>('/ai/channels/sessions');
}
