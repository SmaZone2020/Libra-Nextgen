import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import { fileIcon, formatSize } from './fileIcons';
import {
  Pencil, ArrowRightFromSquare, Copy, Archive, FileZipper,
  Link, ArrowDownToLine, TrashBin, Scissors,
} from '@gravity-ui/icons';
import type { DataGridColumn } from '../../components/data-grid';
import type { FileEntry } from '../../api/files';

const ARCHIVE_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz',
  'jar', 'war', 'apk', 'ipa', 'egg', 'whl',
]);

function isArchive(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ARCHIVE_EXTENSIONS.has(ext);
}

interface FileListProps {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  onRowAction: (key: string | number) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRename: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onCompress: () => void;
  onDecompress: () => void;
  onShortcut: () => void;
  onDownload: () => void;
  contextEntry: FileEntry | null;
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

export function FileList({
  entries, loading, error, onRowAction, onContextMenu,
  onRename, onMove, onCopy, onDelete, onCompress, onDecompress, onShortcut, onDownload,
  contextEntry,
}: FileListProps) {
  const isFile = contextEntry?.type === 'file';
  const showDecompress = isFile && isArchive(contextEntry.name);

  return (
    <ContextMenu>
      <ContextMenu.Trigger className="w-full">
        <div onContextMenu={onContextMenu}>
          <DataGrid
            aria-label="File list"
            columns={columns}
            data={entries}
            getRowId={(e) => e.name}
            onRowAction={onRowAction}
            scrollContainerClassName="max-h-[calc(100vh-260px)]"
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
          <ContextMenu.Item id="rename" textValue="Rename" onAction={onRename}>
            <Pencil className="w-4 h-4" /> Rename
          </ContextMenu.Item>
          <ContextMenu.Item id="move" textValue="Move" onAction={onMove}>
            <ArrowRightFromSquare className="w-4 h-4" /> Move
          </ContextMenu.Item>
          <ContextMenu.Item id="copy" textValue="Copy" onAction={onCopy}>
            <Copy className="w-4 h-4" /> Copy
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item id="compress" textValue="Compress" onAction={onCompress}>
            <Archive className="w-4 h-4" /> Compress
          </ContextMenu.Item>
          {showDecompress && (
            <ContextMenu.Item id="decompress" textValue="Decompress" onAction={onDecompress}>
              <FileZipper className="w-4 h-4" /> Decompress
            </ContextMenu.Item>
          )}
          <ContextMenu.Item id="shortcut" textValue="Create Shortcut" onAction={onShortcut}>
            <Link className="w-4 h-4" /> Create Shortcut
          </ContextMenu.Item>
          {isFile && (
            <>
              <ContextMenu.Separator />
              <ContextMenu.Item id="download" textValue="Download" onAction={onDownload}>
                <ArrowDownToLine className="w-4 h-4" /> Download
              </ContextMenu.Item>
            </>
          )}
          <ContextMenu.Separator />
          <ContextMenu.Item id="delete" textValue="Delete" onAction={onDelete}>
            <TrashBin className="w-4 h-4" /> Delete
          </ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Popover>
    </ContextMenu>
  );
}
