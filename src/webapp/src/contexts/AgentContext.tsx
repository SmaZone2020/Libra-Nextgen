import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
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

const AgentContext = createContext<AgentContextValue>({
  agents: [],
  agentId: '',
  selectedAgent: null,
  selectAgent: () => {},
  disconnect: () => {},
});

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentId, setAgentId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await getAgents(1, 100, 'online');
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

  // Real-time agent status updates via WebSocket
  useEffect(() => {
    const handler = (msg: WsMessage) => {
      const data = msg.data as { agentId: string; status: string } | null;
      if (!data?.agentId) return;

      if (data.status === 'Offline') {
        setAgents((prev) => prev.map(a =>
          a.id === data.agentId ? { ...a, status: 'Offline' as const } : a
        ));
        setAgentId((prev) => prev === data.agentId ? '' : prev);
      } else if (data.status === 'Online') {
        setAgents((prev) => prev.map(a =>
          a.id === data.agentId ? { ...a, status: 'Online' as const } : a
        ));
      }
    };
    const unsub = consoleWs.on('agent.status', handler);
    return unsub;
  }, []);

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
