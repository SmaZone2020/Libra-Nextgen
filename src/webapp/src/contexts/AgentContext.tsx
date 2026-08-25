import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { toast } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { getAgents } from '../api/agents';
import { consoleWs } from '../ws/consoleWs';
import type { AgentListItem, WsMessage } from '../types/models';

interface AgentContextValue {
  agents: AgentListItem[];
  agentId: string;
  selectedAgent: AgentListItem | null;
  selectAgent: (id: string) => void;
  disconnect: () => void;
}

const NOTICE_SOUND_KEY = 'notice_sound';
const SELECTED_AGENT_KEY = 'selected_agent_id';

function isNoticeSoundEnabled(): boolean {
  return localStorage.getItem(NOTICE_SOUND_KEY) !== 'false';
}

function readStoredAgentId(): string {
  try {
    return localStorage.getItem(SELECTED_AGENT_KEY) ?? '';
  } catch {
    return '';
  }
}

const AgentContext = createContext<AgentContextValue>({
  agents: [],
  agentId: '',
  selectedAgent: null,
  selectAgent: () => {},
  disconnect: () => {},
});

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  // 从浏览器恢复上次选择的 Agent
  const [agentId, setAgentId] = useState<string>(readStoredAgentId);
  // 自动选择只执行一次（首次拿到非空 agent 列表时）
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch all agents (not just online) to keep full list
        const res = await getAgents(1, 100);
        if (cancelled) return;
        // 信息没变则不更新状态（避免下游组件（拓扑图等）无谓重渲染）
        setAgents((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(res.agents)) return prev;
          return res.agents;
        });

        if (!autoSelectedRef.current) {
          // 首次列表为空（后端未就绪）时先不决策，等下次轮询
          if (res.agents.length === 0) return;
          autoSelectedRef.current = true;

          const stored = readStoredAgentId();
          // 1. 上次选择的 Agent 在线 → 自动恢复连接
          if (stored) {
            const storedAgent = res.agents.find((a) => a.id === stored);
            if (storedAgent?.status === 'Online') {
              setAgentId(stored);
              return;
            }
          }
          // 2. 只有一个 Agent → 自动连接
          if (res.agents.length === 1) {
            const only = res.agents[0]!.id;
            setAgentId(only);
            try { localStorage.setItem(SELECTED_AGENT_KEY, only); } catch { /* ignore */ }
            return;
          }
          // 3. 其余情况：不自动选择
          setAgentId('');
        } else {
          // 后续轮询：当前选中的 Agent 从列表消失则清空
          setAgentId((prev) => {
            if (prev && !res.agents.some((a) => a.id === prev)) return '';
            return prev;
          });
        }
      } catch { /* ignore */ }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Lazy-init notification audio
  const noticeRef = useRef<HTMLAudioElement | null>(null);
  const getNotice = useCallback(() => {
    if (!noticeRef.current) noticeRef.current = new Audio('/notice.mp3');
    return noticeRef.current;
  }, []);

  // Known online agent IDs to suppress duplicate notifications
  const onlineIdsRef = useRef(new Set<string>());

  // Real-time agent status updates via WebSocket
  useEffect(() => {
    const handler = (msg: WsMessage) => {
      const data = msg.data as { agentId: string; status: string } | null;
      if (!data?.agentId) return;

      const shortId = data.agentId.slice(0, 8);

      if (data.status === 'Offline') {
        const wasOnline = onlineIdsRef.current.has(data.agentId);
        setAgents((prev) => {
          // 状态没变（已离线）或 agent 不在列表 → 不建新数组，避免下游重渲染
          const target = prev.find((a) => a.id === data.agentId);
          if (!target || target.status === 'Offline') return prev;
          return prev.map((a) =>
            a.id === data.agentId ? { ...a, status: 'Offline' as const } : a
          );
        });
        setAgentId((prev) => {
          if (prev === data.agentId) {
            try { localStorage.removeItem(SELECTED_AGENT_KEY); } catch { /* ignore */ }
            return '';
          }
          return prev;
        });
        onlineIdsRef.current.delete(data.agentId);

        if (wasOnline) {
          if (isNoticeSoundEnabled()) getNotice().play().catch(() => {});
          toast.danger(t('agents.toastOffline'), {
            description: t('agents.toastOfflineDesc', { id: shortId }),
          });
        }
      } else if (data.status === 'Online') {
        const isNew = !onlineIdsRef.current.has(data.agentId);
        onlineIdsRef.current.add(data.agentId);
        setAgents((prev) => {
          // 已在线 → 不建新数组，避免下游重渲染
          if (prev.some((a) => a.id === data.agentId && a.status === 'Online')) return prev;
          return prev.some((a) => a.id === data.agentId)
            ? prev.map((a) => a.id === data.agentId ? { ...a, status: 'Online' as const } : a)
            : prev;
        });
        if (isNew) {
          if (isNoticeSoundEnabled()) getNotice().play().catch(() => {});
          toast.success(t('agents.toastOnline'), {
            description: t('agents.toastOnlineDesc', { id: shortId }),
          });
        }
      }
    };
    const unsub = consoleWs.on('agent.status', handler);
    return unsub;
  }, [getNotice, t]);

  const selectAgent = useCallback((id: string) => {
    if (id) {
      setAgentId(id);
      try { localStorage.setItem(SELECTED_AGENT_KEY, id); } catch { /* ignore */ }
    }
  }, []);

  const disconnect = useCallback(() => {
    setAgentId('');
    try { localStorage.removeItem(SELECTED_AGENT_KEY); } catch { /* ignore */ }
  }, []);

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === agentId) ?? null,
    [agents, agentId]
  );

  const value = useMemo<AgentContextValue>(
    () => ({ agents, agentId, selectedAgent, selectAgent, disconnect }),
    [agents, agentId, selectedAgent, selectAgent, disconnect]
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export const useAgent = () => useContext(AgentContext);
