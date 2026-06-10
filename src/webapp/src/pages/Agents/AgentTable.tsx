import { Spinner } from '@heroui/react';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import { StatusChip } from './StatusChip';
import type { DataGridColumn } from '../../components/data-grid';
import type { AgentListItem } from '../../types/models';

interface AgentTableProps {
  agents: AgentListItem[];
  loading: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
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

export function AgentTable({ agents, loading, onContextMenu, onViewDetails, onRemove }: AgentTableProps) {
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
          <ContextMenu.Item id="view-details" textValue="View Details" onAction={onViewDetails}>
            View Details
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item id="remove" textValue="Remove" onAction={onRemove}>
            Remove
          </ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Popover>
    </ContextMenu>
  );
}
