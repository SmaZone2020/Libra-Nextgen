import { useTranslation } from 'react-i18next';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import { fileIcon, formatSize } from './fileIcons';
import {
  Pencil, ArrowRightFromSquare, Copy, Archive, FileZipper,
  Link, ArrowDownToLine, TrashBin, Scissors, Eye, FolderOpen,
} from '@gravity-ui/icons';
import type { DataGridColumn } from '../../components/data-grid';
import type { FileEntry } from '../../api/files';

const ARCHIVE_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz',
  'jar', 'war', 'apk', 'ipa', 'egg', 'whl',
]);

export function isArchive(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ARCHIVE_EXTENSIONS.has(ext);
}

interface FileListProps {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  onRowAction: (key: string | number) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onViewArchive: () => void;
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

export function FileList({
  entries, loading, error, onRowAction, onContextMenu,
  onOpen, onViewArchive,
  onRename, onMove, onCopy, onDelete, onCompress, onDecompress, onShortcut, onDownload,
  contextEntry,
}: FileListProps) {
  const { t } = useTranslation();

  const columns: DataGridColumn<FileEntry>[] = [
    {
      id: 'name', header: t('fileManager.name'),
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
      id: 'size', header: t('fileManager.size'),
      cell: (item) => (
        <span className="text-default-500 text-sm tabular-nums">
          {item.type === 'dir' ? '—' : formatSize(item.size)}
        </span>
      ),
    },
    {
      id: 'modified', header: t('fileManager.modified'),
      cell: (item) => (
        <span className="text-default-500 text-sm">
          {new Date(item.modified).toLocaleString()}
        </span>
      ),
    },
    {
      id: 'type', header: t('fileManager.type'),
      cell: (item) => (
        <span className="text-default-500 text-sm">
          {item.type === 'dir' ? t('fileManager.folder') : item.name.split('.').pop()?.toUpperCase() ?? t('fileManager.file')}
        </span>
      ),
    },
  ];

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
                {loading ? t('common.loading') : error ? <span className="text-danger-500">{error}</span> : t('fileManager.emptyDir')}
              </div>
            )}
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Popover>
        <ContextMenu.Menu>
          {isFile && !isArchive(contextEntry.name) && (
            <>
              <ContextMenu.Item id="open" textValue={t('fileManager.open')} onAction={onOpen}>
                <Eye className="w-4 h-4" /> {t('fileManager.open')}
              </ContextMenu.Item>
              <ContextMenu.Separator />
            </>
          )}
          {isFile && isArchive(contextEntry.name) && (
            <ContextMenu.Item id="viewArchive" textValue={t('fileManager.viewArchive')} onAction={onViewArchive}>
              <FolderOpen className="w-4 h-4" /> {t('fileManager.viewArchive')}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item id="rename" textValue={t('fileManager.rename')} onAction={onRename}>
            <Pencil className="w-4 h-4" /> {t('fileManager.rename')}
          </ContextMenu.Item>
          <ContextMenu.Item id="move" textValue={t('fileManager.move')} onAction={onMove}>
            <ArrowRightFromSquare className="w-4 h-4" /> {t('fileManager.move')}
          </ContextMenu.Item>
          <ContextMenu.Item id="copy" textValue={t('fileManager.copy')} onAction={onCopy}>
            <Copy className="w-4 h-4" /> {t('fileManager.copy')}
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item id="compress" textValue={t('fileManager.compress')} onAction={onCompress}>
            <Archive className="w-4 h-4" /> {t('fileManager.compress')}
          </ContextMenu.Item>
          {showDecompress && (
            <ContextMenu.Item id="decompress" textValue={t('fileManager.decompress')} onAction={onDecompress}>
              <FileZipper className="w-4 h-4" /> {t('fileManager.decompress')}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item id="shortcut" textValue={t('fileManager.createShortcut')} onAction={onShortcut}>
            <Link className="w-4 h-4" /> {t('fileManager.createShortcut')}
          </ContextMenu.Item>
          {isFile && (
            <>
              <ContextMenu.Separator />
              <ContextMenu.Item id="download" textValue={t('fileManager.download')} onAction={onDownload}>
                <ArrowDownToLine className="w-4 h-4" /> {t('fileManager.download')}
              </ContextMenu.Item>
            </>
          )}
          <ContextMenu.Separator />
          <ContextMenu.Item id="delete" textValue={t('fileManager.delete')} onAction={onDelete}>
            <TrashBin className="w-4 h-4" /> {t('fileManager.delete')}
          </ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Popover>
    </ContextMenu>
  );
}
