'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Tooltip } from '@heroui/react';
import { ArrowLeft, BarsDescendingAlignLeft, ChevronLeft, ChevronRight } from '@gravity-ui/icons';
import {
  createAiSession,
  deleteAiMessage,
  editAiMessage,
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
import { ChatConversation, PromptSuggestion } from '../../vendor/ui-pro';
import { AiSidebar, AiSidebarDrawer } from './AiSidebar';
import { AiThreadMessage } from './AiThreadMessage';
import { AiComposer } from './AiComposer';
import { AiApprovalModal, type AiPermit } from './AiApprovalModal';
import { loadJustitiaTier, saveJustitiaTier, type JustitiaTierKey } from './justitia';

type StreamingState = 'idle' | 'streaming' | 'approval';
export default function AiPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [session, setSession] = useState<AiSession | null>(null);
  const [loading, setLoading] = useState(true);

  const [streaming, setStreaming] = useState<StreamingState>('idle');
  // 移动端会话列表 Drawer 开关。
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // 桌面端会话列表伸缩（收起后仅剩右缘按钮）。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Justitia 档位（浏览器持久化，随 SSE 请求提交）。
  const [justitiaTier, setJustitiaTier] = useState<JustitiaTierKey>(() => loadJustitiaTier());
  const [streamingText, setStreamingText] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingTools, setStreamingTools] = useState<AiToolCall[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AiToolCall | null>(null);
  // 审批模态框：可关闭留痕，对话流中稍后可再次批准/拒绝。
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // 鏂板缓浼氳瘽鍋忓ソ锛堟祻瑙堝櫒鎸佷箙鍖栵級锛氫緵搴斿晢涓庢ā鍨嬮粯璁ゅ€笺€?
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.models.length > 0),
    [providers],
  );
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
      setStreamingReasoning('');
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
    if (activeId || location.pathname !== '/ai') {
      abortRef.current?.abort();
      setStreaming('idle');
      setStreamingText('');
      setStreamingReasoning('');
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
          // 拼接成一段连续思考文本，避免每个增量片段渲染成独立"思考中…"。
          setStreamingReasoning((prev) => prev + evt.content);
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
            ...(evt.toolCall.kind ? { kind: evt.toolCall.kind } : {}),
            ...(evt.toolCall.reason ? { error: evt.toolCall.reason } : {}),
            ...(evt.toolCall.requiredTier !== undefined ? { requiredTier: evt.toolCall.requiredTier } : {}),
            ...(evt.toolCall.currentTier !== undefined ? { currentTier: evt.toolCall.currentTier } : {}),
          });
          setApprovalModalOpen(true);
          break;
        }
        case 'done': {
          setStreaming('idle');
          setPendingApproval(null);
          setApprovalModalOpen(false);
          setStreamingReasoning('');
          void getAiSession(sessionId)
            .then((s) => {
              setSession(s);
              setSessions((prev) => {
                const rest = prev.filter((x) => x.id !== sessionId);
                return [s, ...rest];
              });
            })
            .catch(() => undefined);
          setStreamingText('');
          setStreamingTools([]);
          break;
        }
        case 'error':
          setStreaming('idle');
          setPendingApproval(null);
          setApprovalModalOpen(false);
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
          sidebarRefreshKeyRef.current += 1;
          setSidebarRefreshKey(sidebarRefreshKeyRef.current);
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
          return;
        }
      }

      if (!targetId || !target) return;

      const userMsg: AiMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setSession((prev) => (prev && prev.id === targetId ? { ...prev, messages: [...prev.messages, userMsg] } : prev));
      setStreamingText('');
      setStreamingReasoning('');
      setStreamingTools([]);
      setPendingApproval(null);
      setStreamError(null);
      setStreaming('streaming');
      pendingSessionIdRef.current = targetId;

      const abort = new AbortController();
      abortRef.current = abort;
      try {
        await streamAiChat(targetId, trimmed, (evt) => handleStreamEvent(evt, targetId), abort.signal, justitiaTier);
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
    // 保留已输出的内容：把本次流式文本固定为一条助手消息（若确实有输出）。
    setSession((prev) => {
      if (!prev) return prev;
      const text = streamingText.trim();
      if (!text) return prev;
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: `local-stop-${Date.now()}`,
            role: 'assistant',
            content: text,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    });
    setStreaming('idle');
    setStreamingText('');
    setStreamingTools([]);
    setStreamingReasoning('');
    setPendingApproval(null);
    setStreamError(null);
  }, [activeId, streamingText]);

  const handleApprove = useCallback(
    async (toolCallId: string, permit: AiPermit) => {
      if (!pendingApproval || !activeId) return;
      const id = activeId;
      setApprovalModalOpen(false);
      setStreaming('streaming');
      setPendingApproval((prev) => (prev && prev.id === toolCallId ? { ...prev, state: 'running' } : prev));
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        await streamAiAction(id, toolCallId, true, (evt) => handleStreamEvent(evt, id), abort.signal, permit);
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

  const handleReject = useCallback(
    async (toolCallId: string) => {
      if (!pendingApproval || !activeId) return;
      const id = activeId;
      setApprovalModalOpen(false);
      setStreaming('streaming');
      setPendingApproval((prev) => (prev && prev.id === toolCallId ? { ...prev, state: 'error' } : prev));
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        await streamAiAction(id, toolCallId, false, (evt) => handleStreamEvent(evt, id), abort.signal);
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
  }, []);

  const handleRegenerate = useCallback(() => {
    if (!session || session.messages.length < 2) return;
    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
    if (lastUser) void send(lastUser.content);
  }, [session, send]);

  const handleEditMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!activeId || !session) return;
      const id = activeId;
      const prev = session;
      setSession((s) =>
        s
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === messageId ? { ...m, content } : m,
              ),
            }
          : s,
      );
      try {
        await editAiMessage(id, messageId, content);
        setSessions((list) =>
          list.map((s) =>
            s.id === id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === messageId ? { ...m, content } : m,
                  ),
                }
              : s,
          ),
        );
      } catch (e) {
        setSession(prev);
        alert(e instanceof Error ? e.message : String(e));
      }
    },
    [activeId, session],
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!activeId || !session) return;
      const id = activeId;
      const prev = session;
      setSession((s) =>
        s ? { ...s, messages: s.messages.filter((m) => m.id !== messageId) } : s,
      );
      try {
        await deleteAiMessage(id, messageId);
        setSessions((list) =>
          list.map((s) =>
            s.id === id
              ? { ...s, messages: s.messages.filter((m) => m.id !== messageId) }
              : s,
          ),
        );
      } catch (e) {
        setSession(prev);
        alert(e instanceof Error ? e.message : String(e));
      }
    },
    [activeId, session],
  );

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
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col md:flex-row">
      <aside
        className={`hidden shrink-0 overflow-hidden border-r border-default-200 transition-[width] duration-200 md:block dark:border-default-800 ${
          sidebarCollapsed ? 'w-0 border-r-0' : 'w-64'
        }`}
      >
        <AiSidebar
          activeSessionId={activeId}
          refreshKey={sidebarRefreshKey}
          onSelectSession={selectSession}
          onNewSession={() => void handleNewSession()}
        />
      </aside>

      {/* 伸缩按钮：会话列表容器右侧、垂直居中 */}
      <Tooltip delay={0}>
        <Tooltip.Trigger>
          <Button
            isIconOnly
            variant="secondary"
            size="sm"
            aria-label={sidebarCollapsed ? t('ai.expandSidebar') : t('ai.collapseSidebar')}
            onPress={() => setSidebarCollapsed((v) => !v)}
            className="absolute top-1/2 -translate-y-1/2 z-20 hidden size-6 rounded-full border border-default-200 shadow-md md:inline-flex dark:border-default-800"
            style={{
              left: sidebarCollapsed ? 2 : 244,
              transition: 'left 200ms ease',
            }}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronLeft className="size-3.5" />
            )}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="right">
          {sidebarCollapsed ? t('ai.expandSidebar') : t('ai.collapseSidebar')}
        </Tooltip.Content>
      </Tooltip>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-default-200 px-3 py-2 md:hidden dark:border-default-800">

          <Button
            isIconOnly
            variant="ghost"
            aria-label={t('ai.sessions')}
            onPress={() => setMobileSidebarOpen(true)}
          >
            <BarsDescendingAlignLeft className="size-4" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-base font-medium">
            {session?.title || t('ai.title')}
          </span>
        </div>

        <ChatConversation className="min-h-0 flex-1">
          <ChatConversation.Content className={`flex flex-col ${!session?.messages.length ? 'h-full' : ''}`}>
            <div className="m-auto flex w-full sm:w-[80%] flex-col gap-6 px-4 pt-6 pb-4">
              {showEmptyState ? (
                <div className="flex h-[80vh] flex-1 flex-col items-center justify-center">
                  <PromptSuggestion>
                    <PromptSuggestion.Header>
                      <PromptSuggestion.Title className='text-center'>
                        <img
                          alt="icon"
                          className="w-50 h-50 mx-auto object-cover dark:invert select-none pointer-events-none"
                          loading="lazy"
                          src="/images/icon2.webp"
                        />
                        {t("ai.heroTitle")}
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
                    onEdit={(messageId, content) => void handleEditMessage(messageId, content)}
                    onDelete={(messageId) => void handleDeleteMessage(messageId)}
                    onFeedback={handleFeedback}
                    onApprove={(id) => {
                      // 对话流中批准：先重新打开模态框选择许可时长。
                      setApprovalModalOpen(true);
                    }}
                    onReject={(id) => void handleReject(id)}
                  />
                ))
              )}

              {(streaming === 'streaming' || streaming === 'approval') && (
                <AiThreadMessage
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: '',
                    reasoning: streamingReasoning
                      ? [{ label: t('ai.thinking'), content: streamingReasoning }]
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
                  onDelete={() => undefined}
                  onFeedback={() => undefined}
                  onApprove={(id) => {
                    // 对话流中批准：重新打开模态框选择许可时长。
                    setApprovalModalOpen(true);
                  }}
                  onReject={(id) => void handleReject(id)}
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

        <div className="shrink-0 px-4 pt-3 pb-4 sm:pb-8 ">
          <div className="mx-auto w-full sm:w-[80%]">
            <AiComposer
              providers={enabledProviders}
              activeProviderId={activeProvider?.id ?? null}
              activeModel={activeModel}
              isGenerating={isGenerating || approvalPending}
              canSend={canSend}
              justitiaTier={justitiaTier}
              onTierChange={(tier) => {
                setJustitiaTier(tier);
                saveJustitiaTier(tier);
              }}
              onSend={(text) => void send(text)}
              onStop={handleStop}
              onSelectProvider={handleSelectProvider}
              onSelectModel={handleSelectModel}
            />
          </div>
        </div>
      </div>

      {/* 移动端会话列表 Drawer（左侧按钮打开） */}
      <AiSidebarDrawer
        open={mobileSidebarOpen}
        onOpenChange={setMobileSidebarOpen}
        activeSessionId={activeId}
        refreshKey={sidebarRefreshKey}
        onSelectSession={selectSession}
        onNewSession={() => void handleNewSession()}
      />

      {/* 档位提升审批模态框：可关闭留痕，对话流中稍后可再次批准/拒绝 */}
      <AiApprovalModal
        tool={pendingApproval}
        open={approvalModalOpen}
        onOpenChange={setApprovalModalOpen}
        onApprove={(permit) => {
          if (pendingApproval) void handleApprove(pendingApproval.id, permit);
        }}
        onReject={() => {
          if (pendingApproval) void handleReject(pendingApproval.id);
        }}
      />
    </div>
  );
}

