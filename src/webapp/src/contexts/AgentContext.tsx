import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { getAgents } from '../api/agents';
import type { AgentListItem } from '../types/models';

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
        if (!cancelled) setAgents(res.agents);
      } catch { /* ignore */ }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
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
