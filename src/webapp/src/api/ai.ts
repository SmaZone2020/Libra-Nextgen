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
  | { type: 'approval'; toolCall: { id: string; toolName: string; argsText: string } }
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

export async function createAiSession(providerId: string, model: string): Promise<AiSession> {
  return api.post<AiSession>('/ai/sessions', { providerId, model });
}

export async function deleteAiSession(id: string): Promise<void> {
  await api.delete<void>(`/ai/sessions/${id}`);
}

export async function renameAiSession(id: string, title: string): Promise<void> {
  await api.put<void>(`/ai/sessions/${id}/rename`, { title });
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
 */
export async function streamAiChat(
  sessionId: string,
  content: string,
  onEvent: (evt: AiSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`${apiBase()}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken() ?? ''}`,
    },
    body: JSON.stringify({ sessionId, content }),
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

/** 审批/拒绝工具调用（同样返回 SSE 流）。 */
export async function streamAiAction(
  sessionId: string,
  toolCallId: string,
  approved: boolean,
  onEvent: (evt: AiSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`${apiBase()}/ai/chat/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken() ?? ''}`,
    },
    body: JSON.stringify({ sessionId, toolCallId, approved }),
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
          /* skip */
        }
      }
    }
  }
}

export async function stopAiChat(sessionId: string): Promise<void> {
  try {
    await api.post<void>('/ai/chat/stop', { sessionId });
  } catch {
    /* ignore */
  }
}
