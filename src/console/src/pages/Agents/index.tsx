import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@components/context-menu';
import { Tabs } from '@heroui/react';
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
import { RemoteNodeAgents, useRemoteAgentSegments, type RemoteAgentSegment } from './RemoteNodeAgents';
import NodesPage from '../Nodes';
import { useAgent, type RemoteAgentSelection } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';
import { useCanSeeRoute, useIsDesktop } from '../../hooks/useMobileLayout';
import { getAgent, deleteAgent } from '../../api/agents';
import { createTask } from '../../api/tasks';
import type { AgentListLayout } from './AgentCardList';
import type { AgentDetail, AgentListItem } from '../../types/models';

const AGENTS_LAYOUT_KEY = 'agents_layout';
/** Narrow-screen tab choice: 节点 (mesh nodes) or 设备 (device list). */
const AGENTS_MOBILE_TAB_KEY = 'agents_mobile_tab';
type MobileTab = 'nodes' | 'devices';

function readLayout(): AgentListLayout {
  try {
    return localStorage.getItem(AGENTS_LAYOUT_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function readMobileTab(): MobileTab {
  try {
    return localStorage.getItem(AGENTS_MOBILE_TAB_KEY) === 'nodes' ? 'nodes' : 'devices';
  } catch {
    return 'devices';
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
  const [mobileTab, setMobileTab] = useState<MobileTab>(readMobileTab);
  const contextAgentRef = useRef<string | null>(null);
  const isDesktop = useIsDesktop();
  const nodesTabVisible = useCanSeeRoute('/nodes');

  const segments = useRemoteAgentSegments();

  const toggleLayout = () => {
    setLayout((prev) => {
      const next: AgentListLayout = prev === 'list' ? 'grid' : 'list';
      try { localStorage.setItem(AGENTS_LAYOUT_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  const selectMobileTab = (key: string) => {
    const next: MobileTab = key === 'nodes' ? 'nodes' : 'devices';
    setMobileTab(next);
    try { localStorage.setItem(AGENTS_MOBILE_TAB_KEY, next); } catch { /* ignore */ }
  };

  // If the node of the currently selected remote agent disappears from the
  // connected set, drop the remote selection so pages don't relay to a dead node.
  useEffect(() => {
    if (remote && !segments.some((s) => s.nodeId === remote.nodeId)) clearRemote();
  }, [segments, remote, clearRemote]);

  /** remote agent id → owning node name, for the merged narrow-screen list. */
  const remoteNodeOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const segment of segments) {
      for (const agent of segment.agents) {
        if (!map.has(agent.id)) map.set(agent.id, segment.nodeName);
      }
    }
    return map;
  }, [segments]);

  // Local devices first, then remote ones; a local id always shadows the same
  // id seen on a node so a device is never listed twice.
  const mergedAgents = useMemo(() => {
    const localIds = new Set(agents.map((a) => a.id));
    const remoteAgents: AgentListItem[] = [];
    for (const segment of segments) {
      for (const agent of segment.agents) {
        if (!localIds.has(agent.id)) remoteAgents.push(agent);
      }
    }
    return [...agents, ...remoteAgents];
  }, [agents, segments]);

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

    if (isDesktop) {
      openDetail(id);
      return;
    }
    navigate(`/agents/${id}`);
  };

  // A remote-device card body opens its details. On narrow screens a remote
  // card is indistinguishable from a local one (it carries no connect button),
  // so tapping it must never change the active device — the detail page owns
  // the connect action and resolves the node itself.
  const openRemoteDetail = (segment: RemoteAgentSegment, agent: AgentListItem) => {
    if (isDesktop) {
      openDetail(agent.id);
      return;
    }
    navigate(`/agents/${agent.id}`);
  };

  const handleConnectRemote = (segment: RemoteAgentSegment, agent: AgentListItem) => {
    if (agent.status !== 'Online') return;
    const selection: RemoteAgentSelection = {
      nodeId: segment.nodeId,
      nodeName: segment.nodeName,
      origin: segment.origin,
      agent,
    };
    selectNodeAgent(selection);
    openRemoteDetail(segment, agent);
  };

  // Right-click on a card remembers the target agent for the context menu.
  // Context actions are home-service only, so remote cards are left alone.
  const handleCardContextMenu = useCallback((id: string) => {
    if (!mergedAgents.some((a) => a.id === id)) return;
    contextAgentRef.current = id;
  }, [mergedAgents]);

  const handleConnect = () => {
    const id = contextAgentRef.current;
    if (remote) clearRemote(); // local context-menu actions always target home
    if (id) selectAgent(id);
  };

  // Card-level connect: explicit user action, offline cards keep it disabled.
  const handleCardConnect = (id: string) => {
    if (remote) clearRemote(); // local card actions always target home
    selectAgent(id);
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
  const selectedRemoteKey = remote ? `${remote.nodeId}:${remote.agent.id}` : null;
  const isContextAgentConnected =
    !!contextAgentRef.current && contextAgentRef.current === agentId && !!agentId;
  const canConnect = contextAgent?.status === 'Online' && !isContextAgentConnected;
  const canOperate = contextAgent?.status === 'Online';
  // A remote selection must not light up a local card's disconnect button.
  const localConnectedId = agents.some((a) => a.id === agentId) ? agentId : '';

  // Local device list. Narrow screens get the remote devices merged in; wide
  // screens keep the separate node-segmented sections below (RemoteNodeAgents).
  const deviceList = (
    <AgentBrowser
      agents={isDesktop ? agents : mergedAgents}
      connectedId={localConnectedId}
      layout={layout}
      nodeNameOf={isDesktop ? undefined : (id) => remoteNodeOf.get(id)}
      onLayoutToggle={toggleLayout}
      onOpen={handleOpen}
      onConnect={handleCardConnect}
      onDisconnect={handleDisconnect}
      onCardContextMenu={handleCardContextMenu}
      onBuildPayload={isDesktop ? undefined : () => navigate('/builder')}
    />
  );

  // Wide screens: unchanged — local list plus per-node sections, with the
  // device context menu wired to the local (home-service) cards.
  const desktopSurface = (
    <ContextMenu>
      <ContextMenu.Trigger className="block w-full">
        <div>{deviceList}</div>
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

      {/* Devices on connected remote nodes — explicit connect cards. */}
      <RemoteNodeAgents
        segments={segments}
        layout={layout}
        connectedKey={selectedRemoteKey}
        onConnectAgent={handleConnectRemote}
        onOpenAgent={openRemoteDetail}
        onDisconnectAgent={() => clearRemote()}
      />
    </ContextMenu>
  );

  return (
    <div className="space-y-3">
      {isDesktop ? (
        desktopSurface
      ) : nodesTabVisible ? (
        /* Narrow screens: one devices surface with a 节点 / 设备 tab strip; the
           节点 tab disappears entirely when /nodes is not permitted. */
        <div className="space-y-3 sm:hidden">
          <Tabs selectedKey={mobileTab} onSelectionChange={(key) => selectMobileTab(String(key))}>
            <Tabs.List className="w-full">
              <Tabs.Tab id="nodes" className="flex-1">{t('nav.nodes')}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="devices" className="flex-1">{t('nav.agents')}<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs>
          {mobileTab === 'nodes' ? <NodesPage /> : deviceList}
        </div>
      ) : (
        deviceList
      )}

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
