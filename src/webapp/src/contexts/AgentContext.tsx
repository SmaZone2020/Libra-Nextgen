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

function isNoticeSoundEnabled(): boolean {
  return localStorage.getItem(NOTICE_SOUND_KEY) !== 'false';
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
  const [agentId, setAgentId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch all agents (not just online) to keep full list
        const res = await getAgents(1, 100);
        if (!cancelled) {
          setAgents(res.agents);
          setAgentId((prev) => {
            if (prev && !res.agents.some(a => a.id === prev)) return '';
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
        setAgents((prev) => prev.map(a =>
          a.id === data.agentId ? { ...a, status: 'Offline' as const } : a
        ));
        setAgentId((prev) => prev === data.agentId ? '' : prev);
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
        setAgents((prev) =>
          prev.some(a => a.id === data.agentId)
            ? prev.map(a => a.id === data.agentId ? { ...a, status: 'Online' as const } : a)
            : prev
        );
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
    if (id) setAgentId(id);
  }, []);

  const disconnect = useCallback(() => {
    setAgentId('');
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
