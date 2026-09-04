'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@heroui/react';
import { AntennaSignal, ChevronLeft, ChevronRight } from '@gravity-ui/icons';
import {
  createAiSession,
  deleteAiMessage,
  editAiMessage,
  getAiProviders,
  getAiSession,
  getAiSessions,
  getPendingAiApproval,
  resolveAiApproval,
  streamAiChat,
  stopAiChat,
  type AiMessage,
  type AiProvider,
  type AiSession,
  type AiSseEvent,
  type AiToolCall,
  mergeSessionLists,
} from '../../api/ai';
import { ChatConversation, PromptSuggestion } from '../../vendor/ui-pro';
import { AiSidebar } from './AiSidebar';
import { AiSidebarDrawer } from './AiSidebarDrawer';
import { AiThreadMessage } from './AiThreadMessage';
import { AiComposer } from './AiComposer';
import { AiApprovalModal, type AiPermit } from './AiApprovalModal';
import { EventSubscriptionModal } from './EventSubscriptionModal';
import { loadJustitiaTier, saveJustitiaTier, type JustitiaTierKey } from './justitia';
import { getMyChannelSessions } from '../../api/aiChannels';
import { useDialog } from '../../hooks/useDialog';
import { consoleWs } from '../../ws/consoleWs';

type StreamingState = 'idle' | 'streaming' | 'approval';
export default function AiPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { alert, DialogComponent } = useDialog();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [channelSessions, setChannelSessions] = useState<AiSession[]>([]);
  const [session, setSession] = useState<AiSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionCounts, setSessionCounts] = useState({ regular: 0, channel: 0 });
  const handleSessionCountChange = useCallback((regular: number, channel: number) => {
    setSessionCounts((prev) => (prev.regular === regular && prev.channel === channel ? prev : { regular, channel }));
  }, []);

  const [streaming, setStreaming] = useState<StreamingState>('idle');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Sidebar collapse state persists across sessions/browsers.
  const SIDEBAR_COLLAPSED_KEY = 'libra.ai.sidebarCollapsed';
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* storage blocked — in-memory only */
    }
  }, [sidebarCollapsed]);
  const [justitiaTier, setJustitiaTier] = useState<JustitiaTierKey>(() => loadJustitiaTier());
  const [streamingText, setStreamingText] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingTools, setStreamingTools] = useState<AiToolCall[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AiToolCall | null>(null);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [eventSubOpen, setEventSubOpen] = useState(false);

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
  const streamingRef = useRef<StreamingState>('idle');
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);

  const activeId = sessionId ?? null;

  const loadMeta = useCallback(async () => {
    const [ps, ss, cs] = await Promise.all([getAiProviders(), getAiSessions(), getMyChannelSessions()]);
    setProviders(ps);
    setSessions(ss);
    setChannelSessions(cs);
    setSessionCounts({ regular: ss.length, channel: cs.length });
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await loadMeta();
        if (activeId) {
          const s = await getAiSession(activeId);
          setSession(s);
          const pending = await getPendingAiApproval(activeId);
          if (pending) {
            setPendingApproval(pending);
            setStreaming('approval');
            setApprovalModalOpen(true);
          }
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

  useEffect(() => {
    // Throttled, merging refresh: ai.session.updated can fire every ~1s while a
    // channel session streams. Coalesce bursts and keep list array references
    // stable so nothing re-renders unless something visible actually changed.
    const listTimer = { current: 0 };
    const detailTimer = { current: 0 };

    const scheduleListRefresh = () => {
      if (listTimer.current) return;
      listTimer.current = window.setTimeout(() => {
        listTimer.current = 0;
        void getMyChannelSessions()
          .then((cs) => setChannelSessions((prev) => mergeSessionLists(prev, cs)))
          .catch(() => undefined);
        sidebarRefreshKeyRef.current += 1;
        setSidebarRefreshKey(sidebarRefreshKeyRef.current);
      }, 1200);
    };

    const scheduleDetailRefresh = () => {
      if (!activeId) return;
      if (detailTimer.current) return;
      detailTimer.current = window.setTimeout(() => {
        detailTimer.current = 0;
        void getAiSession(activeId).then(setSession).catch(() => undefined);
      }, 600);
    };

    const refresh = (msg: { data?: unknown }) => {
      const data = msg?.data as { sessionId?: string } | null | undefined;
      if (data?.sessionId === activeId && streamingRef.current === 'idle') {
        scheduleDetailRefresh();
      }
      scheduleListRefresh();
    };
    const offNotify = consoleWs.on('ai.notify', refresh);
    const offUpdated = consoleWs.on('ai.session.updated', refresh);
    return () => {
      offNotify();
      offUpdated();
      window.clearTimeout(listTimer.current);
      window.clearTimeout(detailTimer.current);
    };
  }, [activeId]);

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
          await alert(e instanceof Error ? e.message : String(e));
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
      setPendingApproval((prev) => (prev && prev.id === toolCallId ? { ...prev, state: 'running' } : prev));
      try {
        await resolveAiApproval(id, toolCallId, true, permit);
        void getAiSession(id).then(setSession).catch(() => undefined);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setStreaming('idle');
          setPendingApproval(null);
          setStreamError(e instanceof Error ? e.message : String(e));
        }
      }
    },
    [activeId, pendingApproval],
  );

  const handleReject = useCallback(
    async (toolCallId: string) => {
      if (!pendingApproval || !activeId) return;
      const id = activeId;
      setApprovalModalOpen(false);
      setPendingApproval((prev) => (prev && prev.id === toolCallId ? { ...prev, state: 'error' } : prev));
      try {
        await resolveAiApproval(id, toolCallId, false);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setStreaming('idle');
          setPendingApproval(null);
          setStreamError(e instanceof Error ? e.message : String(e));
        }
      }
    },
    [activeId, pendingApproval],
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
        await alert(e instanceof Error ? e.message : String(e));
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
        await alert(e instanceof Error ? e.message : String(e));
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
  const noSessions = !loading && sessionCounts.regular + sessionCounts.channel === 0;
  const effectiveSidebarCollapsed = noSessions || sidebarCollapsed;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1">
      <aside
        className={`hidden shrink-0 overflow-hidden border-r border-default-200 transition-[width] duration-200 md:block dark:border-default-800 ${
          effectiveSidebarCollapsed ? 'w-0 border-r-0' : 'w-64'
        }`}
      >
        <AiSidebar
          activeSessionId={activeId}
          refreshKey={sidebarRefreshKey}
          onSelectSession={selectSession}
          onNewSession={() => void handleNewSession()}
          onSessionCountChange={handleSessionCountChange}
        />
      </aside>

      {!noSessions && (
        <Button
          isIconOnly
          variant="secondary"
          size="sm"
          onPress={() => setSidebarCollapsed((v) => !v)}
          className="absolute top-3/7 -translate-y-1/2 z-20 hidden size-5 h-14 rounded-l-none rounded-r-lg border border-default-200 shadow-md md:inline-flex dark:border-default-800"
          style={{
            left: effectiveSidebarCollapsed ? 0 : 256,
            transition: 'left 200ms ease',
          }}
        >
          {effectiveSidebarCollapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronLeft className="size-3.5" />
          )}
        </Button>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!noSessions && (
          <Button
            isIconOnly
            variant="secondary"
            size="sm"
            aria-label={t('ai.sessions')}
            onPress={() => setMobileSidebarOpen(true)}
            className="absolute top-3/7 -translate-y-1/2 left-0 z-20 size-5 h-14 rounded-l-none rounded-r-lg border border-default-200 shadow-md md:hidden dark:border-default-800"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        )}
        <div className="w-full shrink-0 px-4 pt-4 flex" >
          <Button variant='secondary' className="ml-auto text-foreground" onPress={() => setEventSubOpen(true)}>
            <AntennaSignal/>
            Submit
          </Button>
        </div>
        <ChatConversation className="min-h-0 flex-1 pt-4 scrollbar-thin scrollbar-track-default-200 scrollbar-thumb-default-300 dark:scrollbar-track-default-800 dark:scrollbar-thumb-default-600">
          <ChatConversation.Content className={`flex flex-col ${!session?.messages.length ? 'h-full' : ''}`}>
            <div className="m-auto flex w-full sm:w-[80%] flex-col gap-6 px-4 pb-4">
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

      <AiSidebarDrawer
        open={mobileSidebarOpen}
        onOpenChange={setMobileSidebarOpen}
        activeSessionId={activeId}
        refreshKey={sidebarRefreshKey}
        onSelectSession={selectSession}
        onNewSession={() => void handleNewSession()}
      />

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

      <EventSubscriptionModal
        open={eventSubOpen}
        onClose={() => setEventSubOpen(false)}
      />
      {DialogComponent}
    </div>
  );
}

