import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import { fileIcon, formatSize } from './fileIcons';
import type { DataGridColumn } from '../../components/data-grid';
import type { FileEntry } from '../../api/files';

interface FileListProps {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  onRowAction: (key: string | number) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const columns: DataGridColumn<FileEntry>[] = [
  {
    id: 'name', header: 'Name',
    cell: (item) => {
      const Icon = fileIcon(item);
      return (
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 shrink-0 text-default-500" />
          <span className={item.type === 'dir' ? 'font-medium' : ''}>{item.name}</span>
        </div>
      );
    },
  },
  {
    id: 'size', header: 'Size',
    cell: (item) => (
      <span className="text-default-500 text-sm tabular-nums">
        {item.type === 'dir' ? '—' : formatSize(item.size)}
      </span>
    ),
  },
  {
    id: 'modified', header: 'Modified',
    cell: (item) => (
      <span className="text-default-500 text-sm">
        {new Date(item.modified).toLocaleString()}
      </span>
    ),
  },
  {
    id: 'type', header: 'Type',
    cell: (item) => (
      <span className="text-default-500 text-sm">
        {item.type === 'dir' ? 'Folder' : item.name.split('.').pop()?.toUpperCase() ?? 'File'}
      </span>
    ),
  },
];

export function FileList({ entries, loading, error, onRowAction, onContextMenu }: FileListProps) {
  return (
    <ContextMenu>
      <ContextMenu.Trigger className="w-full">
        <div onContextMenu={onContextMenu} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <DataGrid
            aria-label="File list"
            columns={columns}
            data={entries}
            getRowId={(e) => e.name}
            onRowAction={onRowAction}
            renderEmptyState={() => (
              <div className="flex justify-center py-8 text-default-500 text-sm">
                {loading ? 'Loading...' : error ? <span className="text-danger-500">{error}</span> : 'Empty directory.'}
              </div>
            )}
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Popover>
        <ContextMenu.Menu>
          <ContextMenu.Item id="download" textValue="Download">
            Download
          </ContextMenu.Item>
          <ContextMenu.Item id="delete" textValue="Delete">
            Delete
          </ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Popover>
    </ContextMenu>
  );
}
