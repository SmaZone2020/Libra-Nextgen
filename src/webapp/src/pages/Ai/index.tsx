'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Chip,
  ListBox,
  Popover,
  Select,
} from '@heroui/react';
import { ArrowLeft, ChevronDown, PaperPlane, Sparkles } from '@gravity-ui/icons';
import {
  createAiSession,
  getAiProviders,
  getAiSession,
  getAiSessions,
  streamAiAction,
  streamAiChat,
  stopAiChat,
  type AiMessage,
  type AiProvider,
  type AiSession,
  type AiSseEvent,
  type AiToolCall,
} from '../../api/ai';
import {
  ChatConversation,
  ChatMessage as ChatMessagePrimitive,
  PromptInput,
  PromptSuggestion,
} from '../../vendor/ui-pro';
import { AiSidebar } from './AiSidebar';
import { AiThreadMessage } from './AiThreadMessage';

type StreamingState = 'idle' | 'streaming' | 'approval';

/** 解析模型名显示信息：`deepseek/deepseek-v4-flash:free` → 厂商/名称/是否免费。
 *  仅影响显示；选中值仍使用原始模型 id（含 / 与 :free 后缀）。 */
function parseModelLabel(raw: string): { vendor?: string; name: string; isFree: boolean } {
  let s = raw;
  let isFree = false;
  if (s.endsWith(':free')) {
    isFree = true;
    s = s.slice(0, -':free'.length);
  }
  const slash = s.indexOf('/');
  if (slash > 0) {
    return { vendor: s.slice(0, slash), name: s.slice(slash + 1), isFree };
  }
  return { name: s, isFree };
}

/** 触发器中展示的模型名：隐藏厂商前缀与 :free 后缀。 */
function formatModelDisplay(raw: string): string {
  const { name } = parseModelLabel(raw);
  return name || raw;
}

export default function AiPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [session, setSession] = useState<AiSession | null>(null);
  const [loading, setLoading] = useState(true);

  const [streaming, setStreaming] = useState<StreamingState>('idle');
  const [streamingText, setStreamingText] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState<string[]>([]);
  const [streamingTools, setStreamingTools] = useState<AiToolCall[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AiToolCall | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  // 新建会话偏好（浏览器持久化）：供应商与模型默认值。
  const [prefProviderId, setPrefProviderId] = useState<string | null>(() =>
    localStorage.getItem('ai.prefProviderId'),
  );
  const [prefModel, setPrefModel] = useState<string | null>(() =>
    localStorage.getItem('ai.prefModel'),
  );

  const abortRef = useRef<AbortController | null>(null);
  const pendingSessionIdRef = useRef<string | null>(null);
  const sidebarRefreshKeyRef = useRef(0);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  // 顶层状态：把选中的会话 id 映射到路由。
  const activeId = sessionId ?? null;

  const loadMeta = useCallback(async () => {
    const [ps, ss] = await Promise.all([getAiProviders(), getAiSessions()]);
    setProviders(ps);
    setSessions(ss);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await loadMeta();
        if (activeId) {
          const s = await getAiSession(activeId);
          setSession(s);
        } else {
          setSession(null);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [activeId, loadMeta]);

  // 路由离开时停止流。
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.models.length > 0),
    [providers],
  );
  // 有会话时用会话的供应商/模型；空态（新消息）时用浏览器偏好，回退第一个可用供应商。
  const activeProvider = useMemo(() => {
    const id = session?.providerId ?? prefProviderId ?? enabledProviders[0]?.id ?? null;
    return providers.find((p) => p.id === id) ?? enabledProviders[0] ?? null;
  }, [providers, session, prefProviderId, enabledProviders]);
  const activeModel = useMemo(() => {
    if (session?.model) return session.model;
    const provider = activeProvider;
    if (!provider) return '';
    if (prefModel && provider.models.includes(prefModel)) return prefModel;
    return provider.defaultModel || provider.models[0] || '';
  }, [session, activeProvider, prefModel]);

  const selectSession = useCallback(
    (id: string) => {
      abortRef.current?.abort();
      setStreaming('idle');
      setStreamingText('');
      setStreamingReasoning([]);
      setStreamingTools([]);
      setPendingApproval(null);
      setStreamError(null);
      if (id) {
        navigate(`/ai/${id}`);
      } else {
        navigate('/ai');
      }
    },
    [navigate],
  );

  const handleNewSession = useCallback(() => {
    // 点击新建：不直接创建会话，仅跳转到 /ai 空态（已在则无动作）。
    // 只有用户发出第一条消息并发送时，才会真正创建会话。
    if (activeId || location.pathname !== '/ai') {
      abortRef.current?.abort();
      setStreaming('idle');
      setStreamingText('');
      setStreamingReasoning([]);
      setStreamingTools([]);
      setPendingApproval(null);
      setStreamError(null);
    }
    navigate('/ai');
  }, [activeId, navigate]);

  const handleSelectProvider = (providerId: string) => {
    const p = providers.find((x) => x.id === providerId);
    if (!p) return;
    const defaultModel = p.defaultModel || p.models[0] || '';
    // 持久化偏好，供下次新建会话读取。
    setPrefProviderId(providerId);
    localStorage.setItem('ai.prefProviderId', providerId);
    setPrefModel(defaultModel || null);
    if (defaultModel) localStorage.setItem('ai.prefModel', defaultModel);
    else localStorage.removeItem('ai.prefModel');
    if (session) {
      setSession((prev) => prev ? { ...prev, providerId, model: defaultModel } : prev);
    }
  };

  const handleSelectModel = (model: string) => {
    setPrefModel(model);
    localStorage.setItem('ai.prefModel', model);
    if (session) {
      setSession((prev) => prev ? { ...prev, model } : prev);
    }
  };

  const handleStreamEvent = useCallback(
    (evt: AiSseEvent, sessionId: string) => {
      switch (evt.type) {
        case 'reasoning':
          setStreamingReasoning((prev) => [...prev, evt.content]);
          break;
        case 'message':
          setStreamingText((prev) => prev + evt.delta);
          break;
        case 'tool_call': {
          const tc: AiToolCall = {
            id: evt.toolCall.id,
            toolName: evt.toolCall.toolName,
            argsText: evt.toolCall.argsText,
            state: evt.toolCall.state,
          };
          setStreamingTools((prev) => {
            const idx = prev.findIndex((x) => x.id === tc.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = tc;
              return next;
            }
            return [...prev, tc];
          });
          break;
        }
        case 'tool_result': {
          const state = evt.state;
          setStreamingTools((prev) =>
            prev.map((x) =>
              x.id === evt.toolCallId
                ? { ...x, state, output: evt.output, error: state === 'error' ? evt.output : undefined }
                : x,
            ),
          );
          break;
        }
        case 'approval': {
          setStreaming('approval');
          setPendingApproval({
            id: evt.toolCall.id,
            toolName: evt.toolCall.toolName,
            argsText: evt.toolCall.argsText,
            state: 'requires-action',
          });
          break;
        }
        case 'done': {
          setStreaming('idle');
          setPendingApproval(null);
          setStreamingReasoning([]);
          void getAiSession(sessionId)
            .then((s) => {
              setSession(s);
              setSessions((prev) => {
                const rest = prev.filter((x) => x.id !== sessionId);
                return [s, ...rest];
              });
            })
            .catch(() => undefined);
          break;
        }
        case 'error':
          setStreaming('idle');
          setPendingApproval(null);
          // 以红色错误块渲染（不再拼进流式文本）。
          setStreamError((prev) => (prev ? `${prev}\n${evt.message}` : evt.message));
          break;
      }
    },
    [],
  );

  const send = useCallback(
    async (content: string, opts?: { sessionIdOverride?: string; forceNew?: boolean }) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      if (streaming !== 'idle') return;

      let targetId = opts?.sessionIdOverride ?? activeId;
      let target = session;

      if (!target && !targetId) {
        // 空态首条消息：此时才真正创建会话（用浏览器偏好的供应商/模型）。
        const provider = activeProvider ?? enabledProviders[0];
        if (!provider) {
          navigate('/settings/ai');
          return;
        }
        try {
          const s = await createAiSession(provider.id, activeModel || provider.defaultModel || provider.models[0] || '');
          target = s;
          targetId = s.id;
          setSessions((prev) => [s, ...prev]);
          navigate(`/ai/${s.id}`);
          // 新会话入列后，让侧边栏重新拉取会话列表。
          sidebarRefreshKeyRef.current += 1;
          setSidebarRefreshKey(sidebarRefreshKeyRef.current);
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
          return;
        }
      }

      if (!targetId || !target) return;

      // 本地先追加用户消息（乐观 UI）。
      const userMsg: AiMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setSession((prev) => (prev && prev.id === targetId ? { ...prev, messages: [...prev.messages, userMsg] } : prev));
      setStreamingText('');
      setStreamingReasoning([]);
      setStreamingTools([]);
      setPendingApproval(null);
      setStreamError(null);
      setStreaming('streaming');
      pendingSessionIdRef.current = targetId;

      const abort = new AbortController();
      abortRef.current = abort;
      try {
        await streamAiChat(targetId, trimmed, (evt) => handleStreamEvent(evt, targetId), abort.signal);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setStreaming('idle');
          setStreamError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
        setStreaming((s) => (s === 'approval' ? s : 'idle'));
      }
    },
    [activeId, activeModel, activeProvider, handleStreamEvent, navigate, session, streaming],
  );

  const handleStop = useCallback(() => {
    if (activeId) void stopAiChat(activeId);
    abortRef.current?.abort();
    setStreaming('idle');
    setStreamingText('');
    setStreamingTools([]);
    setStreamingReasoning([]);
    setPendingApproval(null);
    setStreamError(null);
  }, [activeId]);

  const handleApprove = useCallback(
    async (toolCallId: string, approved: boolean) => {
      if (!pendingApproval || !activeId) return;
      const id = activeId;
      setStreaming('streaming');
      setPendingApproval((prev) => (prev && prev.id === toolCallId ? { ...prev, state: approved ? 'running' : 'error' } : prev));
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        await streamAiAction(id, toolCallId, approved, (evt) => handleStreamEvent(evt, id), abort.signal);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setStreaming('idle');
          setStreamingText((prev) => prev + `\n\n> ⚠️ ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
        setStreaming((s) => (s === 'approval' ? s : 'idle'));
      }
    },
    [activeId, handleStreamEvent, pendingApproval],
  );

  const handleFeedback = useCallback((_good: boolean) => {
    // 反馈落库（服务端暂无存储，先本地提示）。
  }, []);

  const handleRegenerate = useCallback(() => {
    if (!session || session.messages.length < 2) return;
    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
    if (lastUser) void send(lastUser.content);
  }, [session, send]);

  const handleEditMessage = useCallback(() => {
    if (!session || session.messages.length === 0) return;
    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const el = document.querySelector('[data-slot="prompt-input-textarea"]') as HTMLTextAreaElement | null;
    if (el) {
      el.focus();
      el.value = lastUser.content;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, [session]);

  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }, []);

  const suggestedPrompts = useMemo(
    () => [
      t('ai.suggestListAgents'),
      t('ai.suggestAnalyzeAgent'),
      t('ai.suggestExplainTool'),
      t('ai.suggestSummarize'),
    ],
    [t],
  );

  const showEmptyState = !session || session.messages.length === 0;
  const canSend = streaming === 'idle';
  const isGenerating = streaming === 'streaming';
  const approvalPending = streaming === 'approval';

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col md:flex-row">
      {/* 桌面端会话列表（自身滚动，不随消息容器滚动） */}
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-default-200 md:block dark:border-default-800">
        <AiSidebar
          activeSessionId={activeId}
          refreshKey={sidebarRefreshKey}
          onSelectSession={selectSession}
          onNewSession={() => void handleNewSession()}
        />
      </aside>

      {/* 主区域：消息滚动 + 底部输入固定在剩余空间底部 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 移动端顶栏 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-default-200 px-3 py-2 md:hidden dark:border-default-800">
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('ai.back')} onPress={() => navigate('/')}>
            <ArrowLeft className="size-4" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {session?.title || t('ai.title')}
          </span>
          <span className="shrink-0 rounded-full bg-default/60 px-2.5 py-0.5 text-xs text-foreground">
            {activeProvider?.name ?? t('ai.unknownProvider')}
          </span>
        </div>

        <ChatConversation className="min-h-0 flex-1">
          <ChatConversation.Content className={`flex flex-col ${!session?.messages.length ? 'h-full' : ''}`}>
            <div className="m-auto flex w-full sm:w-[80%] flex-col gap-6 px-4 pt-6 pb-4">
              {showEmptyState ? (
                <div className="flex min-h-full flex-1 flex-col items-center justify-center">
                  <PromptSuggestion>
                    <PromptSuggestion.Header>
                      <PromptSuggestion.Title className='text-center'>
                        {t('ai.heroTitle')}
                      </PromptSuggestion.Title>
                    </PromptSuggestion.Header>
                    <PromptSuggestion.Items>
                      {suggestedPrompts.map((prompt) => (
                        <PromptSuggestion.Item
                          key={prompt}
                          onPress={() => canSend && void send(prompt)}
                        >
                          {prompt}
                        </PromptSuggestion.Item>
                      ))}
                    </PromptSuggestion.Items>
                  </PromptSuggestion>
                </div>
              ) : (
                session?.messages.map((message) => (
                  <AiThreadMessage
                    key={message.id}
                    message={message}
                    isStreaming={false}
                    onCopy={handleCopy}
                    onRegenerate={() => void handleRegenerate()}
                    onEdit={handleEditMessage}
                    onFeedback={handleFeedback}
                    onApprove={(id) => void handleApprove(id, true)}
                    onReject={(id) => void handleApprove(id, false)}
                  />
                ))
              )}

              {(streaming === 'streaming' || streaming === 'approval') && (
                <AiThreadMessage
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: '',
                    reasoning: streamingReasoning.length > 0
                      ? streamingReasoning.map((c, i) => ({ label: t('ai.thinking'), content: c }))
                      : undefined,
                    toolCalls: streamingTools.length > 0 ? streamingTools : undefined,
                    createdAt: new Date().toISOString(),
                  }}
                  streamingText={streamingText}
                  isStreaming
                  pendingApproval={pendingApproval}
                  onCopy={handleCopy}
                  onRegenerate={() => undefined}
                  onEdit={() => undefined}
                  onFeedback={() => undefined}
                  onApprove={(id) => void handleApprove(id, true)}
                  onReject={(id) => void handleApprove(id, false)}
                />
              )}

              {streamError && (
                <div
                  className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
                  role="alert"
                >
                  {streamError.split('\n').map((line, i) => (
                    <p key={i} className={i > 0 ? 'mt-1' : ''}>{line}</p>
                  ))}
                </div>
              )}
            </div>
            <ChatConversation.ScrollAnchor />
          </ChatConversation.Content>
          <ChatConversation.ScrollButton
            aria-label={t('ai.scrollToBottom')}
            tooltip={t('ai.scrollToBottom')}
          />
        </ChatConversation>

        {/* 底部输入区：shrink-0，固定于主区域底部 */}
        <div className="shrink-0 px-4 pt-3 pb-4 sm:pb-8 ">
          <div className="mx-auto w-full sm:w-[80%]">
            <AiComposer
              providers={enabledProviders}
              activeProviderId={activeProvider?.id ?? null}
              activeModel={activeModel}
              isGenerating={isGenerating || approvalPending}
              canSend={canSend}
              onSend={(text) => void send(text)}
              onStop={handleStop}
              onSelectProvider={handleSelectProvider}
              onSelectModel={handleSelectModel}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AiComposer({
  providers,
  activeProviderId,
  activeModel,
  isGenerating,
  canSend,
  onSend,
  onStop,
  onSelectProvider,
  onSelectModel,
}: {
  providers: AiProvider[];
  activeProviderId: string | null;
  activeModel: string;
  isGenerating: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onSelectProvider: (id: string) => void;
  onSelectModel: (model: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [vendorKey, setVendorKey] = useState<string>('');
  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? providers[0];

  // 模型按厂商分组（vendor/model 前缀；无前缀归「全部」）。
  const modelGroups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of activeProvider?.models ?? []) {
      const vendor = parseModelLabel(m).vendor ?? '';
      const list = map.get(vendor) ?? [];
      list.push(m);
      map.set(vendor, list);
    }
    return map;
  }, [activeProvider]);

  const vendors = useMemo(() => [...modelGroups.keys()], [modelGroups]);
  // 当前厂商：手动选择优先，否则从当前模型推断。
  const currentVendor = vendors.includes(vendorKey)
    ? vendorKey
    : (parseModelLabel(activeModel).vendor ?? '');
  const vendorModels = modelGroups.get(currentVendor) ?? [];

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isGenerating) return;
    setValue('');
    onSend(trimmed);
  };

  return (
    <PromptInput
      status={isGenerating ? 'streaming' : 'ready'}
      variant="primary"
      value={value}
      onValueChange={setValue}
      onStop={onStop}
      onSubmit={handleSubmit}
    >
      <PromptInput.Shell>
        <PromptInput.Content>
          <PromptInput.TextArea
            placeholder={t('ai.inputPlaceholder')}
            aria-label={t('ai.inputPlaceholder')}
          />
        </PromptInput.Content>
        <PromptInput.Toolbar>
          <PromptInput.ToolbarStart>
            <Select
              aria-label={t('ai.provider')}
              selectedKey={activeProvider?.id}
              onSelectionChange={(key) => {
                if (key) onSelectProvider(String(key));
              }}
              isDisabled={isGenerating}
              placeholder={t('ai.provider')}
              variant="secondary"
              className="min-w-0 max-w-[110px] sm:max-w-[140px]"
            >
              <Select.Trigger className="flex w-full items-center gap-1 overflow-hidden">
                <Select.Value className="min-w-0 flex-1 truncate" />
                <Select.Indicator className="shrink-0" />
              </Select.Trigger>
              <Select.Popover>
                <ListBox items={providers} className="max-h-[200px] overflow-y-auto">
                  {(item) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={item.name} className="truncate">
                      {item.name}
                    </ListBox.Item>
                  )}
                </ListBox>
              </Select.Popover>
            </Select>
            <Popover
              isOpen={modelMenuOpen}
              onOpenChange={setModelMenuOpen}
            >
              <Popover.Trigger>
                <Button
                  aria-label={t('ai.model')}
                  variant="secondary"
                  isDisabled={isGenerating || !activeProvider}
                  className="h-9 min-w-0 max-w-[120px] shrink-0 gap-1 rounded-field border border-default-200 px-2 sm:max-w-[160px] dark:border-default-800"
                >
                  <Sparkles className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {activeModel ? formatModelDisplay(activeModel) : t('ai.model')}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted" />
                </Button>
              </Popover.Trigger>
              <Popover.Content className="min-w-[240px] p-0">
                <Popover.Dialog>
                  <div className="flex max-h-[280px] overflow-hidden">
                    {/* 左列：厂商 */}
                    <div className="w-28 shrink-0 overflow-y-auto border-r border-default-200 py-1 dark:border-default-800">
                      {vendors.map((vendor) => {
                        const active = vendor === currentVendor;
                        return (
                          <button
                            key={vendor || '(all)'}
                            type="button"
                            onClick={() => {
                              setVendorKey(vendor);
                            }}
                            className={`block w-full truncate px-3 py-1.5 text-left text-sm transition-colors ${
                              active
                                ? 'bg-accent font-medium text-white'
                                : 'text-foreground hover:bg-default/60'
                            }`}
                          >
                            {vendor || t('ai.vendorAll')}
                          </button>
                        );
                      })}
                    </div>
                    {/* 右列：该厂商的模型 */}
                    <div className="min-w-0 flex-1 overflow-y-auto py-1">
                      {vendorModels.map((m) => {
                        const parsed = parseModelLabel(m);
                        const selected = m === activeModel;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              onSelectModel(m);
                              setModelMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                              selected
                                ? 'bg-accent font-medium text-white'
                                : 'text-foreground hover:bg-default/60'
                            }`}
                          >
                            <span className="truncate">{parsed.name}</span>
                            {parsed.isFree && (
                              <Chip
                                color="success"
                                variant="primary"
                                size="sm"
                                className="shrink-0 text-white"
                              >
                                <Chip.Label>Free/免费</Chip.Label>
                              </Chip>
                            )}
                          </button>
                        );
                      })}
                      {vendorModels.length === 0 && (
                        <div className="px-3 py-6 text-center text-xs text-muted">
                          {t('ai.noModels')}
                        </div>
                      )}
                    </div>
                  </div>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          </PromptInput.ToolbarStart>
          <PromptInput.ToolbarEnd>
            <PromptInput.Send
              aria-label={isGenerating ? t('ai.stop') : t('ai.send')}
              isDisabled={!isGenerating && !value.trim()}
            >
              <PaperPlane/>
            </PromptInput.Send>
          </PromptInput.ToolbarEnd>
        </PromptInput.Toolbar>
      </PromptInput.Shell>
    </PromptInput>
  );
}
