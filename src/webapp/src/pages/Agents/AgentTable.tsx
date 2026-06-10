import { Spinner } from '@heroui/react';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import { StatusChip } from './StatusChip';
import { PlugConnection, CircleXmark, Eye, TrashBin } from '@gravity-ui/icons';
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
}

const columns: DataGridColumn<AgentListItem>[] = [
  {
    id: 'hostname', header: 'Hostname',
    cell: (item) => <span className="font-mono">{item.hostname}</span>,
  },
  {
    id: 'ipAddress', header: 'IP',
    cell: (item) => <span className="font-mono text-default-500">{item.ipAddress}</span>,
  },
  { id: 'osVersion', header: 'OS',
    cell: (item) => <span className="text-default-500">{item.osVersion}</span>,
  },
  {
    id: 'status', header: 'Status',
    cell: (item) => <StatusChip status={item.status} />,
  },
  {
    id: 'lastSeen', header: 'Last Seen',
    cell: (item) => <span className="text-default-500 text-sm">{new Date(item.lastSeen).toLocaleString()}</span>,
  },
];

export function AgentTable({ agents, loading, contextAgentId, connectedAgentId, onContextMenu, onConnect, onDisconnect, onViewDetails, onRemove }: AgentTableProps) {
  const isContextAgentConnected = contextAgentId === connectedAgentId && !!connectedAgentId;
  const contextAgent = agents.find(a => a.id === contextAgentId);
  const canConnect = contextAgent?.status === 'Online' && !isContextAgentConnected;

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
                  No agents connected.
                </div>
              )}
            />
          )}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Popover>
        <ContextMenu.Menu>
          {canConnect && (
            <ContextMenu.Item id="connect" textValue="Connect" onAction={onConnect}>
              <PlugConnection className="w-4 h-4" /> Connect
            </ContextMenu.Item>
          )}
          {isContextAgentConnected && (
            <ContextMenu.Item id="disconnect" textValue="Disconnect" onAction={onDisconnect}>
              <CircleXmark className="w-4 h-4" /> Disconnect
            </ContextMenu.Item>
          )}
          <ContextMenu.Item id="view-details" textValue="View Details" onAction={onViewDetails}>
            <Eye className="w-4 h-4" /> View Details
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item id="remove" textValue="Remove" onAction={onRemove}>
            <TrashBin className="w-4 h-4" /> Remove
          </ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Popover>
    </ContextMenu>
  );
}
