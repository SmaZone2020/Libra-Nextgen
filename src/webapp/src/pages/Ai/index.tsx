'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@heroui/react';
import { ArrowLeft, BarsDescendingAlignLeft } from '@gravity-ui/icons';
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
import { ChatConversation, PromptSuggestion } from '../../vendor/ui-pro';
import { AiSidebar, AiSidebarDrawer } from './AiSidebar';
import { AiThreadMessage } from './AiThreadMessage';
import { AiComposer } from './AiComposer';
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
  // Justitia 档位（浏览器持久化，随 SSE 请求提交）。
  const [justitiaTier, setJustitiaTier] = useState<JustitiaTierKey>(() => loadJustitiaTier());
  const [streamingText, setStreamingText] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState<string[]>([]);
  const [streamingTools, setStreamingTools] = useState<AiToolCall[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AiToolCall | null>(null);
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

  // 椤跺眰鐘舵€侊細鎶婇€変腑鐨勪細璇?id 鏄犲皠鍒拌矾鐢便€?
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

  // 璺敱绂诲紑鏃跺仠姝㈡祦銆?
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.models.length > 0),
    [providers],
  );
  // 鏈変細璇濇椂鐢ㄤ細璇濈殑渚涘簲鍟?妯″瀷锛涚┖鎬侊紙鏂版秷鎭級鏃剁敤娴忚鍣ㄥ亸濂斤紝鍥為€€绗竴涓彲鐢ㄤ緵搴斿晢銆?
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
    // 鐐瑰嚮鏂板缓锛氫笉鐩存帴鍒涘缓浼氳瘽锛屼粎璺宠浆鍒?/ai 绌烘€侊紙宸插湪鍒欐棤鍔ㄤ綔锛夈€?
    // 鍙湁鐢ㄦ埛鍙戝嚭绗竴鏉℃秷鎭苟鍙戦€佹椂锛屾墠浼氱湡姝ｅ垱寤轰細璇濄€?
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
    // 鎸佷箙鍖栧亸濂斤紝渚涗笅娆℃柊寤轰細璇濊鍙栥€?
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
            // 附加审批元数据（kind/reason/档位）供模态框展示。
            ...(evt.toolCall.kind ? { kind: evt.toolCall.kind } : {}),
            ...(evt.toolCall.reason ? { error: evt.toolCall.reason } : {}),
            ...(evt.toolCall.requiredTier !== undefined ? { requiredTier: evt.toolCall.requiredTier } : {}),
            ...(evt.toolCall.currentTier !== undefined ? { currentTier: evt.toolCall.currentTier } : {}),
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
          // 浠ョ孩鑹查敊璇潡娓叉煋锛堜笉鍐嶆嫾杩涙祦寮忔枃鏈級銆?
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
        // 绌烘€侀鏉℃秷鎭細姝ゆ椂鎵嶇湡姝ｅ垱寤轰細璇濓紙鐢ㄦ祻瑙堝櫒鍋忓ソ鐨勪緵搴斿晢/妯″瀷锛夈€?
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
          // 鏂颁細璇濆叆鍒楀悗锛岃渚ц竟鏍忛噸鏂版媺鍙栦細璇濆垪琛ㄣ€?
          sidebarRefreshKeyRef.current += 1;
          setSidebarRefreshKey(sidebarRefreshKeyRef.current);
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
          return;
        }
      }

      if (!targetId || !target) return;

      // 鏈湴鍏堣拷鍔犵敤鎴锋秷鎭紙涔愯 UI锛夈€?
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
          setStreamingText((prev) => prev + `\n\n> 鈿狅笍 ${e instanceof Error ? e.message : String(e)}`);
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
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-default-200 md:block dark:border-default-800">
        <AiSidebar
          activeSessionId={activeId}
          refreshKey={sidebarRefreshKey}
          onSelectSession={selectSession}
          onNewSession={() => void handleNewSession()}
        />
      </aside>

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
    </div>
  );
}

