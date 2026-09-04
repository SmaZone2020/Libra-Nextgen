import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@heroui/react';
import { getAgents, getAgent, deleteAgent } from '../../api/agents';
import { createTask } from '../../api/tasks';
import { AgentTable } from './AgentTable';
import { AgentDetailModal } from './AgentDetailModal';
import { MobileBuilderEntry } from './MobileBuilderEntry';
import { useAgent } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';
import type { AgentListItem, AgentDetail } from '../../types/models';

export default function AgentsPage() {
  const { t } = useTranslation();
  const { agentId, selectAgent, disconnect: disconnectAgent } = useAgent();
  const { confirm, alert, DialogComponent } = useDialog();
  const [tab, setTab] = useState<string>('online');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAgent, setModalAgent] = useState<AgentDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const contextAgentRef = useRef<string | null>(null);

  // Use shared agent context (real-time via WebSocket)
  const { agents: allAgents } = useAgent();
  const [loading, setLoading] = useState(false);

  // Filter by tab
  const agents = tab === 'all'
    ? allAgents
    : allAgents.filter(a => a.status.toLowerCase() === tab);

  const handleTabChange = useCallback((key: string) => {
    setTab(key);
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
  };

  const handleRestart = async () => {
    const id = contextAgentRef.current;
    if (!id) return;
    const { confirmed } = await confirm(t('agents.restartConfirm'));
    if (!confirmed) return;
    try {
      await createTask({ agentId: id, commandType: 'Restart', command: 'restart', timeoutSeconds: 5 });
    } catch (e) {
      await alert(`${t('agents.restartFailed')}\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDestroy = async () => {
    const id = contextAgentRef.current;
    if (!id) return;
    const { confirmed } = await confirm(t('agents.destroyConfirm'));
    if (!confirmed) return;
    try {
      await createTask({ agentId: id, commandType: 'KillAndClean', command: 'kill_and_clean', timeoutSeconds: 5 });
    } catch (e) {
      await alert(`${t('agents.destroyFailed')}\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-3">
      <MobileBuilderEntry />
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
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} onRestart={handleRestart} onDestroy={handleDestroy} />
        </Tabs.Panel>
        <Tabs.Panel id="online">
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} onRestart={handleRestart} onDestroy={handleDestroy} />
        </Tabs.Panel>
        <Tabs.Panel id="offline">
          <AgentTable agents={agents} loading={loading} contextAgentId={contextAgentRef.current} connectedAgentId={agentId} onContextMenu={handleContextMenu} onConnect={handleConnect} onDisconnect={handleDisconnect} onViewDetails={handleViewDetails} onRemove={handleRemove} onRestart={handleRestart} onDestroy={handleDestroy} />
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
