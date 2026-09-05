import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { toast } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { apiHome, setApiNodeTarget } from '../api/client';
import { consoleWs } from '../ws/consoleWs';
import type { AgentListItem, WsMessage } from '../types/models';

/** An agent selected on a connected remote node (workspace mesh). While a
 *  remote agent is selected, agent-feature API calls relay through the hub to
 *  that node (see api/client node targeting). */
export interface RemoteAgentSelection {
  nodeId: string;
  nodeName: string;
  origin: string;
  agent: AgentListItem;
}

interface AgentContextValue {
  agents: AgentListItem[];
  /** Effective agent id: remote selection wins over the local one. */
  agentId: string;
  /** Effective selected agent: remote selection wins over the local one. */
  selectedAgent: AgentListItem | null;
  remote: RemoteAgentSelection | null;
  selectAgent: (id: string) => void;
  selectNodeAgent: (selection: RemoteAgentSelection) => void;
  clearRemote: () => void;
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
  remote: null,
  selectAgent: () => {},
  selectNodeAgent: () => {},
  clearRemote: () => {},
  disconnect: () => {},
});

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentId, setAgentId] = useState<string>(readStoredAgentId);
  const [remote, setRemote] = useState<RemoteAgentSelection | null>(null);
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Home-pinned: this is the LOCAL node's agent list, never the relay.
        const res = await apiHome.get<{ agents: AgentListItem[] }>(
          '/agents?page=1&pageSize=100',
        );
        if (cancelled) return;
        setAgents((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(res.agents)) return prev;
          return res.agents;
        });

        if (!autoSelectedRef.current) {
          if (res.agents.length === 0) return;
          autoSelectedRef.current = true;

          const stored = readStoredAgentId();
          if (stored) {
            const storedAgent = res.agents.find((a) => a.id === stored);
            if (storedAgent?.status === 'Online') {
              setAgentId(stored);
              return;
            }
          }
          if (res.agents.length === 1) {
            const only = res.agents[0]!.id;
            setAgentId(only);
            try { localStorage.setItem(SELECTED_AGENT_KEY, only); } catch { /* ignore */ }
            return;
          }
          setAgentId('');
        } else {
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

  // Real-time agent status updates via WebSocket (local node only — remote
  // nodes refresh through the mesh pollers).
  useEffect(() => {
    const handler = (msg: WsMessage) => {
      const data = msg.data as { agentId: string; status: string } | null;
      if (!data?.agentId) return;

      const shortId = data.agentId.slice(0, 8);

      if (data.status === 'Offline') {
        const wasOnline = onlineIdsRef.current.has(data.agentId);
        setAgents((prev) => {
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
    // Selecting the agent that is already the remote selection keeps the
    // remote context (detail/action pages call selectAgent with their id).
    if (remote && remote.agent.id === id) return;
    if (remote) {
      setRemote(null);
      setApiNodeTarget(null);
    }
    if (id) {
      setAgentId(id);
      try { localStorage.setItem(SELECTED_AGENT_KEY, id); } catch { /* ignore */ }
    }
  }, [remote]);

  const selectNodeAgent = useCallback((selection: RemoteAgentSelection) => {
    setRemote(selection);
    setAgentId('');
    try { localStorage.removeItem(SELECTED_AGENT_KEY); } catch { /* ignore */ }
    setApiNodeTarget(selection.nodeId);
  }, []);

  const clearRemote = useCallback(() => {
    if (remote) {
      setRemote(null);
      setApiNodeTarget(null);
    }
  }, [remote]);

  const disconnect = useCallback(() => {
    if (remote) {
      setRemote(null);
      setApiNodeTarget(null);
      return;
    }
    setAgentId('');
    try { localStorage.removeItem(SELECTED_AGENT_KEY); } catch { /* ignore */ }
  }, [remote]);

  const selectedAgent = useMemo(() => {
    if (remote) return remote.agent;
    return agents.find(a => a.id === agentId) ?? null;
  }, [agents, agentId, remote]);

  const effectiveAgentId = remote ? remote.agent.id : agentId;

  const value = useMemo<AgentContextValue>(
    () => ({
      agents,
      agentId: effectiveAgentId,
      selectedAgent,
      remote,
      selectAgent,
      selectNodeAgent,
      clearRemote,
      disconnect,
    }),
    [agents, effectiveAgentId, selectedAgent, remote, selectAgent, selectNodeAgent, clearRemote, disconnect],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export const useAgent = () => useContext(AgentContext);
