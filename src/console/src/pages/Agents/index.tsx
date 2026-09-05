import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@components/context-menu';
import {
  ArrowRotateRight,
  CircleXmark,
  Eye,
  Flame,
  PlugConnection,
  TrashBin,
} from '@gravity-ui/icons';
import { AgentBrowser } from './AgentBrowser';
import { AgentDetailModal } from './AgentDetailModal';
import { MobileBuilderEntry } from './MobileBuilderEntry';
import { RemoteNodeAgents, useRemoteAgentSegments, type RemoteAgentSegment } from './RemoteNodeAgents';
import { useAgent, type RemoteAgentSelection } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';
import { getAgent, deleteAgent } from '../../api/agents';
import { createTask } from '../../api/tasks';
import type { AgentListLayout } from './AgentCardList';
import type { AgentDetail, AgentListItem } from '../../types/models';

const AGENTS_LAYOUT_KEY = 'agents_layout';

function readLayout(): AgentListLayout {
  try {
    return localStorage.getItem(AGENTS_LAYOUT_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

export default function AgentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, agentId, remote, selectAgent, selectNodeAgent, clearRemote, disconnect: disconnectAgent } = useAgent();
  const { confirm, alert, DialogComponent } = useDialog();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAgent, setModalAgent] = useState<AgentDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [layout, setLayout] = useState<AgentListLayout>(readLayout);
  const contextAgentRef = useRef<string | null>(null);

  const segments = useRemoteAgentSegments();

  const toggleLayout = () => {
    setLayout((prev) => {
      const next: AgentListLayout = prev === 'list' ? 'grid' : 'list';
      try { localStorage.setItem(AGENTS_LAYOUT_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  // If the node of the currently selected remote agent disappears from the
  // connected set, drop the remote selection so pages don't relay to a dead node.
  useEffect(() => {
    if (remote && !segments.some((s) => s.nodeId === remote.nodeId)) clearRemote();
  }, [segments, remote, clearRemote]);

  const openDetail = (id: string) => {
    setModalOpen(true);
    setModalLoading(true);
    setModalAgent(null);
    getAgent(id)
      .then((detail) => setModalAgent(detail))
      .catch(() => setModalAgent(null))
      .finally(() => setModalLoading(false));
  };

  // Desktop shows the detail modal in place; mobile keeps the dedicated page.
  const handleOpen = (id: string) => {
    // Opening a local card while a remote agent is selected switches back to
    // the local service for its detail fetch.
    const isLocal = agents.some((a) => a.id === id);
    if (remote && isLocal) clearRemote();

    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches) {
      openDetail(id);
      return;
    }
    navigate(`/agents/${id}`);
  };

  // A remote-device click selects that node agent (hub relay) and opens its
  // details; subsequent terminal/files/etc. operate through the relay.
  const handleOpenRemote = (segment: RemoteAgentSegment, agent: AgentListItem) => {
    const selection: RemoteAgentSelection = {
      nodeId: segment.nodeId,
      nodeName: segment.nodeName,
      origin: segment.origin,
      agent,
    };
    selectNodeAgent(selection);

    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches) {
      openDetail(agent.id);
      return;
    }
    navigate(`/agents/${agent.id}`);
  };

  // Right-click on a card remembers the target agent for the context menu.
  const handleCardContextMenu = useCallback((id: string) => {
    contextAgentRef.current = id;
  }, []);

  const handleConnect = () => {
    const id = contextAgentRef.current;
    if (remote) clearRemote(); // local context-menu actions always target home
    if (id) selectAgent(id);
  };

  const handleDisconnect = () => {
    disconnectAgent();
  };

  const handleViewDetails = async () => {
    const id = contextAgentRef.current;
    if (remote) clearRemote();
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
    if (remote) clearRemote();
    if (!id) return;
    const { confirmed } = await confirm(t('agents.removeConfirm'));
    if (!confirmed) return;
    await deleteAgent(id);
  };

  const handleRestart = async () => {
    const id = contextAgentRef.current;
    if (remote) clearRemote();
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
    if (remote) clearRemote();
    if (!id) return;
    const { confirmed } = await confirm(t('agents.destroyConfirm'));
    if (!confirmed) return;
    try {
      await createTask({ agentId: id, commandType: 'KillAndClean', command: 'kill_and_clean', timeoutSeconds: 5 });
    } catch (e) {
      await alert(`${t('agents.destroyFailed')}\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const contextAgent = agents.find((a) => a.id === contextAgentRef.current) ?? null;
  const isContextAgentConnected =
    !!contextAgentRef.current && contextAgentRef.current === agentId && !!agentId;
  const canConnect = contextAgent?.status === 'Online' && !isContextAgentConnected;
  const canOperate = contextAgent?.status === 'Online';

  return (
    <div className="space-y-3">
      <MobileBuilderEntry />
      <ContextMenu>
        <ContextMenu.Trigger className="block w-full">
          <div>
            <AgentBrowser
              agents={agents}
              connectedId={agentId}
              layout={layout}
              onLayoutToggle={toggleLayout}
              onOpen={handleOpen}
              onCardContextMenu={handleCardContextMenu}
            />
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Popover>
          <ContextMenu.Menu aria-label={t('agents.agentFilters')}>
            {canConnect && (
              <ContextMenu.Item id="connect" textValue={t('common.connect')} onAction={handleConnect}>
                <PlugConnection className="size-4" /> {t('common.connect')}
              </ContextMenu.Item>
            )}
            {isContextAgentConnected && (
              <ContextMenu.Item id="disconnect" textValue={t('common.disconnect')} onAction={handleDisconnect}>
                <CircleXmark className="size-4" /> {t('common.disconnect')}
              </ContextMenu.Item>
            )}
            <ContextMenu.Item id="view-details" textValue={t('agents.viewDetails')} onAction={handleViewDetails}>
              <Eye className="size-4" /> {t('agents.viewDetails')}
            </ContextMenu.Item>
            {canOperate && (
              <>
                <ContextMenu.Item id="restart" textValue={t('agents.restart')} onAction={handleRestart}>
                  <ArrowRotateRight className="size-4" /> {t('agents.restart')}
                </ContextMenu.Item>
                <ContextMenu.Item id="destroy" textValue={t('agents.destroy')} onAction={handleDestroy} className="text-danger">
                  <Flame className="size-4" /> {t('agents.destroy')}
                </ContextMenu.Item>
              </>
            )}
            <ContextMenu.Separator />
            <ContextMenu.Item id="remove" textValue={t('agents.remove')} onAction={handleRemove}>
              <TrashBin className="size-4" /> {t('agents.remove')}
            </ContextMenu.Item>
          </ContextMenu.Menu>
        </ContextMenu.Popover>
      </ContextMenu>

      {/* Devices on connected remote nodes — selectable segments (admin). */}
      <RemoteNodeAgents segments={segments} layout={layout} onOpenAgent={handleOpenRemote} />

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
