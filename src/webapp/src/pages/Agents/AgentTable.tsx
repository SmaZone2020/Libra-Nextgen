import { useTranslation } from 'react-i18next';
import { Spinner } from '@heroui/react';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import { StatusChip } from './StatusChip';
import { PlugConnection, CircleXmark, Eye, TrashBin, ArrowRotateRight, Flame } from '@gravity-ui/icons';
import type { DataGridColumn } from '../../components/data-grid';
import type { AgentListItem } from '../../types/models';

interface AgentTableProps {
  agents: AgentListItem[];
  loading: boolean;
  contextAgentId: string | null;
  connectedAgentId: string;
  onContextMenu: (e: React.MouseEvent) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onViewDetails: () => void;
  onRemove: () => void;
  onRestart: () => void;
  onDestroy: () => void;
}

export function AgentTable({ agents, loading, contextAgentId, connectedAgentId, onContextMenu, onConnect, onDisconnect, onViewDetails, onRemove, onRestart, onDestroy }: AgentTableProps) {
  const { t } = useTranslation();

  const columns: DataGridColumn<AgentListItem>[] = [
    {
      id: 'hostname', header: t('agents.hostname'),
      cell: (item) => <span className="font-mono">{item.hostname}</span>,
    },
    {
      id: 'ipAddress', header: t('agents.ip'),
      cell: (item) => <span className="font-mono text-default-500">{item.geo?.publicIp || item.ipAddress}</span>,
    },
    { id: 'osVersion', header: t('agents.os'),
      cell: (item) => <span className="text-default-500">{item.osVersion}</span>,
    },
    {
      id: 'status', header: t('agents.status'),
      cell: (item) => <StatusChip status={item.status} />,
    },
    {
      id: 'lastSeen', header: t('agents.lastSeen'),
      cell: (item) => <span className="text-default-500 text-sm">{new Date(item.lastSeen).toLocaleString()}</span>,
    },
  ];

  const isContextAgentConnected = contextAgentId === connectedAgentId && !!connectedAgentId;
  const contextAgent = agents.find(a => a.id === contextAgentId);
  const canConnect = contextAgent?.status === 'Online' && !isContextAgentConnected;
  // 重启/销毁只对在线设备有意义（任务需由 Agent 心跳领取）
  const canOperate = contextAgent?.status === 'Online';

  return (
    <ContextMenu>
      <ContextMenu.Trigger className="w-full">
        <div onContextMenu={onContextMenu}>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner color="accent" />
            </div>
          ) : (
            <DataGrid
              aria-label="Agent list"
              columns={columns}
              data={agents}
              getRowId={(a) => a.id}
              renderEmptyState={() => (
                <div className="flex justify-center py-8 text-default-500 text-sm">
                  {t('agents.noAgents')}
                </div>
              )}
            />
          )}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Popover>
        <ContextMenu.Menu>
          {canConnect && (
            <ContextMenu.Item id="connect" textValue={t('common.connect')} onAction={onConnect}>
              <PlugConnection className="w-4 h-4" /> {t('common.connect')}
            </ContextMenu.Item>
          )}
          {isContextAgentConnected && (
            <ContextMenu.Item id="disconnect" textValue={t('common.disconnect')} onAction={onDisconnect}>
              <CircleXmark className="w-4 h-4" /> {t('common.disconnect')}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item id="view-details" textValue={t('agents.viewDetails')} onAction={onViewDetails}>
            <Eye className="w-4 h-4" /> {t('agents.viewDetails')}
          </ContextMenu.Item>
          {canOperate && (
            <>
              <ContextMenu.Item id="restart" textValue={t('agents.restart')} onAction={onRestart}>
                <ArrowRotateRight className="w-4 h-4" /> {t('agents.restart')}
              </ContextMenu.Item>
              <ContextMenu.Item id="destroy" textValue={t('agents.destroy')} onAction={onDestroy} className="text-danger">
                <Flame className="w-4 h-4" /> {t('agents.destroy')}
              </ContextMenu.Item>
            </>
          )}
          <ContextMenu.Separator />
          <ContextMenu.Item id="remove" textValue={t('agents.remove')} onAction={onRemove}>
            <TrashBin className="w-4 h-4" /> {t('agents.remove')}
          </ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Popover>
    </ContextMenu>
  );
}
