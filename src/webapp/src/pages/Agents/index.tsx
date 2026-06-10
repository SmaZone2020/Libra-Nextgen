import { useState, useEffect, useRef, useCallback } from 'react';
import { Tabs } from '@heroui/react';
import { getAgents, getAgent, deleteAgent } from '../../api/agents';
import { AgentTable } from './AgentTable';
import { AgentDetailModal } from './AgentDetailModal';
import { useAgent } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';
import type { AgentListItem, AgentDetail } from '../../types/models';

export default function AgentsPage() {
  const { agentId, selectAgent, disconnect: disconnectAgent } = useAgent();
  const { confirm, DialogComponent } = useDialog();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>('online');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAgent, setModalAgent] = useState<AgentDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const contextAgentRef = useRef<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const statusParam = tab === 'all' ? undefined : tab;
      const res = await getAgents(1, 100, statusParam);
      setAgents(res.agents);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => {
    loadAgents();
    const timer = setInterval(loadAgents, 10000);
    return () => clearInterval(timer);
  }, [loadAgents]);

  const handleTabChange = useCallback((key: string) => {
    setTab(key);
    setLoading(true);
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[role="row"][data-key]');
    contextAgentRef.current = row ? row.getAttribute('data-key') : null;
  };

  const handleConnect = () => {
    const id = contextAgentRef.current;
    if (id) selectAgent(id);
  };

  const handleDisconnect = () => {
    disconnectAgent();
  };

  const handleViewDetails = async () => {
    const id = contextAgentRef.current;
    if (!id) return;
    setModalOpen(true);
    setModalLoading(true);
    setModalAgent(null);
    try {
      const detail = await getAgent(id);
      setModalAgent(detail);
    } catch { /* ignore */ }
    finally { setModalLoading(false); }
  };

  const handleRemove = async () => {
    const id = contextAgentRef.current;
    if (!id) return;
    const { confirmed } = await confirm('Remove this agent?');
    if (!confirmed) return;
    await deleteAgent(id);
    loadAgents();
  };

  return (
    <div className="space-y-3">
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => handleTabChange(String(key))}
      >
        <Tabs.ListContainer className="flex justify-center">
          <Tabs.List aria-label="Agent filters" className="mx-auto w-md">
            <Tabs.Tab id="all">All<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="online">Online<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="offline">Offline<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="all">
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} />
        </Tabs.Panel>
        <Tabs.Panel id="online">
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} />
        </Tabs.Panel>
        <Tabs.Panel id="offline">
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} />
        </Tabs.Panel>
      </Tabs>

      <AgentDetailModal
        isOpen={modalOpen}
        onOpenChange={setModalOpen}
        agent={modalAgent}
        loading={modalLoading}
      />

      {DialogComponent}
    </div>
  );
}
