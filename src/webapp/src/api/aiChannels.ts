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
  /** 频道消息中是否显示工具调用标记（🔧/⚠️）。 */
  showToolCalls: boolean;
  /** 流式输出：AI 生成时实时发送/编辑，而非完成后一次性输出。 */
  streamOutput: boolean;
  /** 允许在群组中调用（仅 @提及 bot + 已绑定账户；未绑定仅 /bind）。 */
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
  /** Telegram 深链绑定链接（t.me/{bot}?start=CODE），点击即触发绑定。 */
  bindUrl?: string | null;
}

/** 微信 iLink 扫码登录：get_bot_qrcode 响应。 */
export interface AiChannelWechatQrCode {
  /** 二维码轮询令牌（传给状态轮询接口）。 */
  qrcode: string;
  /** 可直接渲染的二维码图片 URL（微信 liteapp 链接）。 */
  imageUrl: string;
}

/** 微信 iLink 扫码状态轮询结果。 */
export interface AiChannelQrStatus {
  /** wait | scaned | confirmed | expired。 */
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | string;
  /** confirmed 时返回的 bot_token（仅该次响应可见一次）。 */
  botToken?: string | null;
  ilinkBotId?: string | null;
  baseUrl?: string | null;
}

/** 绑定码记录（列表展示；仅尾号可见）。 */
export interface AiBindCodeInfo {
  id: string;
  boundUserId: string;
  boundUserName: string;
  /** 绑定码明文尾 4 位（非敏感，仅用于识别）。 */
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

/** 微信 iLink 授权：申请登录二维码（登录接口匿名，无需频道已存在；返回 qrcode 令牌 + 二维码图片 URL）。 */
export async function getAiChannelWechatQrCode(): Promise<AiChannelWechatQrCode> {
  return api.post<AiChannelWechatQrCode>('/ai/channels/wechat/qrcode');
}

/** 微信 iLink 授权：轮询扫码状态；confirmed 时返回 bot_token（仅该次响应可见一次）。 */
export async function getAiChannelQrStatus(qrcode: string): Promise<AiChannelQrStatus> {
  return api.post<AiChannelQrStatus>('/ai/channels/wechat/qrcode/status', { qrcode });
}

/** 把扫码确认得到的 bot_token 写入频道配置（服务端加密存储；baseUrl/ilinkBotId 来自 confirmed 响应，按官方协议一并持久化）。 */
export async function setAiChannelWechatToken(
  channelId: string,
  token: string,
  baseUrl?: string | null,
  ilinkBotId?: string | null,
): Promise<void> {
  await api.post<void>(`/ai/channels/${channelId}/token`, { token, baseUrl, ilinkBotId });
}

/** 生成一次性绑定码（15 分钟有效，仅本次响应可见）。 */
export async function createAiBindCode(channelId: string, userId: string): Promise<AiBindCode> {
  return api.post<AiBindCode>(`/ai/channels/${channelId}/bind-codes`, { userId });
}

export async function getAiChannelUsers(channelId: string): Promise<AiChannelUser[]> {
  return api.get<AiChannelUser[]>(`/ai/channels/${channelId}/users`);
}

/** 列出频道的全部绑定码（含状态）。 */
export async function getAiChannelBindCodes(channelId: string): Promise<AiBindCodeInfo[]> {
  return api.get<AiBindCodeInfo[]>(`/ai/channels/${channelId}/bind-codes`);
}

/** 作废一个未使用的绑定码。 */
export async function revokeAiBindCode(channelId: string, codeId: string): Promise<void> {
  await api.delete<void>(`/ai/channels/${channelId}/bind-codes/${codeId}`);
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
