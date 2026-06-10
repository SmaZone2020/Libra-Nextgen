import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button, Card, Chip, ComboBox, Input, Label, ListBox } from '@heroui/react';
import { Breadcrumbs } from '@heroui/react/breadcrumbs';
import {
  File, FileCode, FileLetterP, FileLetterW, FileLetterX, FileText, FileZipper,
  Folder, FolderArrowLeft, FolderTree, MusicNote, Picture, Video,
} from '@gravity-ui/icons';
import { getAgents } from '../../api/agents';
import { listFiles, getDrives } from '../../api/files';
import type { FileEntry as ApiFileEntry } from '../../api/files';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import type { DataGridColumn } from '../../components/data-grid';
import type { AgentListItem } from '../../types/models';
import type { ComponentType, SVGProps } from 'react';

// ── File icon mapping ──────────────────────────────────────────────────────────

type FileEntry = ApiFileEntry;

type IconCtor = ComponentType<SVGProps<SVGSVGElement>>;

const extIcons: Record<string, IconCtor> = {
  // Images
  png: Picture, jpg: Picture, jpeg: Picture, gif: Picture, svg: Picture,
  bmp: Picture, webp: Picture, ico: Picture, tiff: Picture, tif: Picture,
  // Videos
  mp4: Video, avi: Video, mkv: Video, mov: Video, webm: Video, wmv: Video,
  flv: Video, m4v: Video, mpg: Video, mpeg: Video,
  // Audio
  mp3: MusicNote, wav: MusicNote, flac: MusicNote, aac: MusicNote,
  ogg: MusicNote, wma: MusicNote, m4a: MusicNote,
  // Archives
  zip: FileZipper, rar: FileZipper, '7z': FileZipper, tar: FileZipper,
  gz: FileZipper, bz2: FileZipper, xz: FileZipper, zst: FileZipper,
  // Code
  js: FileCode, ts: FileCode, tsx: FileCode, jsx: FileCode,
  py: FileCode, cs: FileCode, go: FileCode, rs: FileCode,
  java: FileCode, c: FileCode, cpp: FileCode, cc: FileCode, cxx: FileCode,
  h: FileCode, hpp: FileCode, json: FileCode, xml: FileCode,
  yaml: FileCode, yml: FileCode, html: FileCode, htm: FileCode,
  css: FileCode, scss: FileCode, less: FileCode,
  sh: FileCode, bash: FileCode, bat: FileCode, cmd: FileCode, ps1: FileCode,
  toml: FileCode, sql: FileCode, php: FileCode, rb: FileCode,
  swift: FileCode, kt: FileCode, scala: FileCode, dart: FileCode,
  vue: FileCode, svelte: FileCode, r: FileCode, lua: FileCode,
  // Documents
  pdf: FileLetterP,
  doc: FileLetterW, docx: FileLetterW, odt: FileText,
  xls: FileLetterX, xlsx: FileLetterX, ods: FileText,
  ppt: File, pptx: File, odp: File,
  // Text
  txt: FileText, md: FileText, log: FileText, cfg: FileText,
  ini: FileText, env: FileText, readme: FileText,
};

function fileIcon(entry: FileEntry): IconCtor {
  if (entry.type === 'dir') return Folder;
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  return extIcons[ext] ?? File;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FileManagerPage() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [path, setPath] = useState('C:\\');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef<FileEntry | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load online agents
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await getAgents(1, 100, 'online');
        if (!cancelled) setAgents(res.agents);
      } catch { /* ignore */ }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Send file.list request via REST
  const sendFileList = useCallback(async (dirPath: string) => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listFiles(agentId, dirPath);
      setPath(result.path);
      setEntries(result.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to list directory');
    } finally { setLoading(false); }
  }, [agentId]);

  const bindAgent = useCallback(async (id: string) => {
    if (!id) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setAgentId(id);
    setConnected(true);
    setEntries([]);
    setPath('C:\\');
    setHistory([]);
    setLoading(true);

    try {
      const [fileResult, drivesResult] = await Promise.all([
        listFiles(id, 'C:\\'),
        getDrives(id),
      ]);
      setPath(fileResult.path);
      setEntries(fileResult.entries);
      setDrives(drivesResult.drives);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to agent');
      setConnected(false);
    } finally { setLoading(false); }
  }, []);

  // Sort: folders first, then files; within each group, sort alphabetically by name
  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    sorted.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return sorted;
  }, [entries]);

  // Navigate to directory
  const navigateTo = useCallback((dirPath: string) => {
    setHistory(prev => [...prev, path]);
    sendFileList(dirPath);
  }, [path, sendFileList]);

  // Click a folder to navigate in
  const handleRowAction = useCallback((key: string | number) => {
    const entry = entries.find(e => e.name === String(key));
    if (entry?.type === 'dir') {
      const newPath = path.replace(/\\+$/, '') + '\\' + entry.name;
      navigateTo(newPath);
    }
  }, [entries, path, navigateTo]);

  // Go back
  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1]!;
    setHistory(h => h.slice(0, -1));
    sendFileList(prev);
  }, [history, sendFileList]);

  // Go to parent
  const goUp = useCallback(() => {
    const parent = path.split('\\').slice(0, -1).join('\\') || path[0] + ':\\';
    navigateTo(parent);
  }, [path, navigateTo]);

  // Drive items for ComboBox
  const driveItems = useMemo(() => drives.map(d => ({ id: d, label: d })), [drives]);

  // Breadcrumb segments
  const breadcrumbs = useMemo(() => {
    const parts = path.split('\\').filter(Boolean);
    if (parts.length === 0) return [{ label: path, path }];
    return parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join('\\'),
    }));
  }, [path]);

  // Cleanup
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[role="row"][data-key]');
    const key = row ? row.getAttribute('data-key') : null;
    contextRef.current = entries.find(en => en.name === key) ?? null;
  };

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

  const selectedAgent = agents.find(a => a.id === agentId);

  return (
    <div className="space-y-3">
      {/* Agent selector bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <ComboBox
          defaultItems={agents}
          selectedKey={agentId || null}
          onSelectionChange={(key) => bindAgent(String(key))}
          isDisabled={connected}
        >
          <Label>Agent</Label>
          <ComboBox.InputGroup>
            <Input placeholder="Select agent..." />
            <ComboBox.Trigger />
          </ComboBox.InputGroup>
          <ComboBox.Popover>
            <ListBox>
              {(item: AgentListItem) => (
                <ListBox.Item id={item.id} textValue={item.hostname}>
                  {item.hostname}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              )}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>

        {connected && selectedAgent && (
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="soft" color="success">{selectedAgent.hostname}</Chip>
            <Chip size="sm" variant="soft">{selectedAgent.ipAddress}</Chip>
          </div>
        )}

        {connected && (
          <Button
            size="sm" variant="ghost"
            onPress={() => {
              abortRef.current?.abort();
              setConnected(false);
              setAgentId('');
              setEntries([]);
              setHistory([]);
            }}
          >
            Disconnect
          </Button>
        )}
      </div>

      {/* Path bar */}
      {connected && (
        <div className="flex items-center gap-2 flex-wrap h-10">
          <Button isIconOnly size="sm" variant="ghost" isDisabled={history.length === 0} onPress={goBack}>
            <FolderArrowLeft className="w-4 h-4" />
          </Button>
          <Button isIconOnly size="sm" variant="ghost" onPress={goUp}>
            <FolderTree className="w-4 h-4" />
          </Button>

          <ComboBox
            className="w-[180px]"
            defaultItems={driveItems}
            selectedKey={path.split('\\')[0] + '\\'}
            onSelectionChange={(key) => {
              if (key) {
                setHistory(prev => [...prev, path]);
                sendFileList(String(key));
              }
            }}
            aria-label="Select drive"
          >
            <ComboBox.InputGroup>
              <Input placeholder="Drive..." />
              <ComboBox.Trigger />
            </ComboBox.InputGroup>
            <ComboBox.Popover>
              <ListBox>
                {(item: { id: string; label: string }) => (
                  <ListBox.Item id={item.id} textValue={item.label}>
                    {item.label}
                  </ListBox.Item>
                )}
              </ListBox>
            </ComboBox.Popover>
          </ComboBox>

          <Card className='flex-1 min-w-0 py-0 h-[40px] rounded-[12px]'>
            <Breadcrumbs
            className='w-full h-full'
            onAction={(key) => {
              const idx = breadcrumbs.findIndex(c => c.path === key);
              if (idx >= 0 && idx < breadcrumbs.length - 1) {
                navigateTo(String(key));
              }
            }}
          >
            {breadcrumbs.map((crumb) => (
              <Breadcrumbs.Item key={crumb.path} id={crumb.path}>
                {crumb.label}
              </Breadcrumbs.Item>
            ))}
          </Breadcrumbs>
          </Card>
        </div>
      )}

      {/* File list */}
      {connected && (
        <ContextMenu>
          <ContextMenu.Trigger className="w-full">
            <div onContextMenu={handleContextMenu} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              <DataGrid
                aria-label="File list"
                columns={columns}
                data={sortedEntries}
                getRowId={(e) => e.name}
                onRowAction={handleRowAction}
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
      )}

      {/* Empty state */}
      {!connected && (
        <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
          Select an online agent to browse its file system.
        </div>
      )}
    </div>
  );
}
