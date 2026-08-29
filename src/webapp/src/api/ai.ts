import { api, apiBase, getToken } from './client';

// ── 类型（与服务端 AiModels.cs / AiController.cs 对齐）─────────────────────

export interface AiProvider {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  /** 服务端永不回传密文；创建/更新时作为明文 API Key 提交。 */
  apiKeyEnc: string;
  models: string[];
  defaultModel: string;
  enabled: boolean;
  requireApproval: boolean;
  createdAt: string;
}

export interface AiReasoningStep {
  label: string;
  content: string;
}

export type AiToolState =
  | 'running'
  | 'output-available'
  | 'error'
  | 'requires-action'
  | 'input-streaming';

export interface AiToolCall {
  id: string;
  toolName: string;
  argsText: string;
  state: AiToolState;
  output?: string;
  error?: string;
  /** 该工具调用发生时已输出的助手文本（用于把工具调用穿插在文本流中）。 */
  textBefore?: string;
}

export interface AiSource {
  title: string;
  sourceType: 'url' | 'document';
  url?: string;
  description?: string;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  reasoning?: AiReasoningStep[];
  toolCalls?: AiToolCall[];
  sources?: AiSource[];
  createdAt: string;
}

export interface AiSession {
  id: string;
  userId: string;
  userName: string;
  title: string;
  providerId: string;
  model: string;
  messages: AiMessage[];
  createdAt: string;
  updatedAt: string;
  /** 频道会话标记：null = 控制台会话；非 null = IM 频道会话。 */
  channelId?: string | null;
  channelType?: 'telegram' | 'lark' | 'wechat-claw' | null;
  channelExternalId?: string | null;
  channelExternalName?: string | null;
}

export interface AiToolDescriptor {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
}

export interface AiMcpInfo {
  toolsEnabled: boolean;
  allowedTools: string[];
  tools: AiToolDescriptor[];
}

// ── SSE 事件（POST /api/ai/chat 响应流）───────────────────────────────────

export type AiSseEvent =
  | { type: 'reasoning'; label: string; content: string }
  | { type: 'message'; delta: string }
  | { type: 'tool_call'; toolCall: { id: string; toolName: string; argsText: string; state: AiToolState } }
  | { type: 'tool_result'; toolCallId: string; toolName: string; output: string; state: AiToolState }
  | {
      type: 'approval';
      toolCall: {
        id: string;
        toolName: string;
        argsText: string;
        reason?: string;
        /** approval = 供应商审批；escalation = Justitia 档位提升请求。 */
        kind?: 'approval' | 'escalation';
        requiredTier?: number;
        currentTier?: number;
      };
    }
  | { type: 'done'; sessionId: string; messageId: string }
  | { type: 'error'; message: string };

export interface AiProviderInput {
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  defaultModel: string;
  enabled: boolean;
  requireApproval: boolean;
}

export interface AiMcpInput {
  toolsEnabled: boolean;
  allowedTools: string[];
}

// ── API ──────────────────────────────────────────────────────────────────

export async function getAiProviders(): Promise<AiProvider[]> {
  return api.get<AiProvider[]>('/ai/providers');
}

export async function createAiProvider(input: AiProviderInput): Promise<AiProvider> {
  return api.post<AiProvider>('/ai/providers', input);
}

export async function updateAiProvider(id: string, input: AiProviderInput): Promise<void> {
  await api.put<void>(`/ai/providers/${id}`, input);
}

export async function deleteAiProvider(id: string): Promise<void> {
  await api.delete<void>(`/ai/providers/${id}`);
}

export async function testAiProvider(input: AiProviderInput): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  return api.post<{ ok: boolean; error?: string; models?: string[] }>('/ai/providers/test', input);
}

export async function getAiSessions(): Promise<AiSession[]> {
  return api.get<AiSession[]>('/ai/sessions');
}

export async function getAiSession(id: string): Promise<AiSession> {
  return api.get<AiSession>(`/ai/sessions/${id}`);
}

/**
 * 会话当前是否有挂起的审批（控制台打开会话时恢复审批模态框，含频道会话）。
 * 返回 null 表示无挂起审批。
 */
export async function getPendingAiApproval(
  id: string,
): Promise<AiToolCall | null> {
  const pending = await api.get<AiToolCall | null>(`/ai/sessions/${id}/pending-approval`);
  return pending && pending.id ? pending : null;
}

export async function createAiSession(providerId: string, model: string): Promise<AiSession> {
  return api.post<AiSession>('/ai/sessions', { providerId, model });
}

export async function deleteAiSession(id: string): Promise<void> {
  await api.delete<void>(`/ai/sessions/${id}`);
}

export async function renameAiSession(id: string, title: string): Promise<void> {
  await api.put<void>(`/ai/sessions/${id}/rename`, { title });
}

/** 编辑会话中的一条用户消息内容（仅限 user 消息）。 */
export async function editAiMessage(id: string, messageId: string, content: string): Promise<void> {
  await api.put<void>(`/ai/sessions/${id}/messages/${messageId}`, { content });
}

/** 删除会话中的一条消息（用户消息或 AI 消息）。 */
export async function deleteAiMessage(id: string, messageId: string): Promise<void> {
  await api.delete<void>(`/ai/sessions/${id}/messages/${messageId}`);
}

/** 分支会话：复制为带 -fork 后缀的新会话（含完整消息历史）。 */
export async function forkAiSession(id: string): Promise<AiSession> {
  return api.post<AiSession>(`/ai/sessions/${id}/fork`);
}

export async function getAiMcp(): Promise<AiMcpInfo> {
  return api.get<AiMcpInfo>('/ai/mcp');
}

export async function setAiMcp(input: AiMcpInput): Promise<void> {
  await api.put<void>('/ai/mcp', input);
}

/**
 * 发起流式聊天。以 fetch + ReadableStream 解析 SSE（POST，方便携带长文）。
 * onEvent 依次收到 reasoning/message/tool_call/tool_result/approval/done/error。
 * @param tier Justitia 档位 key（cognitio/arbitrium/imperium/dictatura），后端强制校验。
 */
export async function streamAiChat(
  sessionId: string,
  content: string,
  onEvent: (evt: AiSseEvent) => void,
  signal?: AbortSignal,
  tier?: string,
): Promise<void> {
  const resp = await fetch(`${apiBase()}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken() ?? ''}`,
    },
    body: JSON.stringify({ sessionId, content, tier }),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(err.error || `Request failed: ${resp.status}`);
  }
  if (!resp.body) return;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          onEvent(JSON.parse(payload) as AiSseEvent);
        } catch {
          /* skip malformed frames */
        }
      }
    }
  }
}

/** 审批/拒绝/临时批准挂起的工具调用（纯 POST，不返回 SSE）。
 * 后端收到决策后写入门闩，由原 SSE 流（streamAiChat）继续推送
 * tool_result / message / done——本函数仅返回是否接受。 */
export async function resolveAiApproval(
  sessionId: string,
  toolCallId: string,
  approved: boolean,
  permit: 'one-time' | '5min' | '20min' = 'one-time',
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`${apiBase()}/ai/chat/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken() ?? ''}`,
    },
    body: JSON.stringify({ sessionId, toolCallId, approved, permit }),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(err.error || `Request failed: ${resp.status}`);
  }
}

export async function stopAiChat(sessionId: string): Promise<void> {
  try {
    await api.post<void>('/ai/chat/stop', { sessionId });
  } catch {
    /* ignore */
  }
}
