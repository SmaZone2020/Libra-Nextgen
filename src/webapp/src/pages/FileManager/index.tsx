import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { listFiles, getDrives, deleteFile, renameFile, moveFile, copyFile, compressFile, decompressFile, createShortcut, downloadFile } from '../../api/files';
import type { FileEntry } from '../../api/files';
import { PathBar } from './PathBar';
import { FileList } from './FileList';
import { useAgent } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';

export default function FileManagerPage() {
  const { agentId } = useAgent();
  const { alert, confirm, prompt, DialogComponent } = useDialog();
  const [path, setPath] = useState('C:\\');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef<FileEntry | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [contextEntry, setContextEntry] = useState<FileEntry | null>(null);

  const sendFileList = useCallback(async (dirPath: string, id?: string) => {
    const targetId = id || agentId;
    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listFiles(targetId, dirPath);
      setPath(result.path);
      setEntries(result.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to list directory');
    } finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      setEntries([]);
      setHistory([]);
      setDrives([]);
      setPath('C:\\');
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setEntries([]);
    setPath('C:\\');
    setHistory([]);
    setLoading(true);

    Promise.all([
      listFiles(agentId, 'C:\\'),
      getDrives(agentId),
    ]).then(([fileResult, drivesResult]) => {
      setPath(fileResult.path);
      setEntries(fileResult.entries);
      setDrives(drivesResult.drives);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to connect to agent');
    }).finally(() => { setLoading(false); });
  }, [agentId]);

  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    sorted.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return sorted;
  }, [entries]);

  const navigateTo = useCallback((dirPath: string) => {
    setHistory(prev => [...prev, path]);
    sendFileList(dirPath);
  }, [path, sendFileList]);

  const handleRowAction = useCallback((key: string | number) => {
    const entry = entries.find(e => e.name === String(key));
    if (entry?.type === 'dir') {
      const newPath = path.replace(/\\+$/, '') + '\\' + entry.name;
      navigateTo(newPath);
    }
  }, [entries, path, navigateTo]);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1]!;
    setHistory(h => h.slice(0, -1));
    sendFileList(prev);
  }, [history, sendFileList]);

  const goUp = useCallback(() => {
    const parent = path.split('\\').slice(0, -1).join('\\') || path[0] + ':\\';
    navigateTo(parent);
  }, [path, navigateTo]);

  const handleDriveChange = useCallback((drive: string) => {
    setHistory(prev => [...prev, path]);
    sendFileList(drive);
  }, [path, sendFileList]);

  const handleContextMenu = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[role="row"][data-key]');
    const key = row ? row.getAttribute('data-key') : null;
    const entry = entries.find(en => en.name === key) ?? null;
    contextRef.current = entry;
    setContextEntry(entry);
  };

  const getContextPath = () => {
    const entry = contextRef.current;
    if (!entry) return '';
    return path.replace(/\\+$/, '') + '\\' + entry.name;
  };

  const handleRename = async () => {
    if (!agentId || !contextRef.current) return;
    const { confirmed, value } = await prompt('New name:', contextRef.current.name);
    if (!confirmed || !value || value === contextRef.current.name) return;
    try {
      await renameFile(agentId, getContextPath(), value);
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : 'Rename failed');
    }
  };

  const handleMove = async () => {
    if (!agentId || !contextRef.current) return;
    const { confirmed, value } = await prompt('Move to (destination path):');
    if (!confirmed || !value) return;
    try {
      await moveFile(agentId, getContextPath(), value);
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : 'Move failed');
    }
  };

  const handleCopy = async () => {
    if (!agentId || !contextRef.current) return;
    const { confirmed, value } = await prompt('Copy to (destination path):');
    if (!confirmed || !value) return;
    try {
      await copyFile(agentId, getContextPath(), value);
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : 'Copy failed');
    }
  };

  const handleDelete = async () => {
    if (!agentId || !contextRef.current) return;
    const { confirmed } = await confirm(`Delete "${contextRef.current.name}"?`);
    if (!confirmed) return;
    try {
      await deleteFile(agentId, getContextPath());
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handleCompress = async () => {
    if (!agentId || !contextRef.current) return;
    try {
      await compressFile(agentId, getContextPath());
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : 'Compress failed');
    }
  };

  const handleDecompress = async () => {
    if (!agentId || !contextRef.current) return;
    try {
      await decompressFile(agentId, getContextPath());
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : 'Decompress failed');
    }
  };

  const handleShortcut = async () => {
    if (!agentId || !contextRef.current) return;
    try {
      await createShortcut(agentId, getContextPath());
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : 'Create shortcut failed');
    }
  };

  const handleDownload = async () => {
    if (!agentId || !contextRef.current) return;
    try {
      await downloadFile(agentId, getContextPath());
    } catch (e) {
      await alert(e instanceof Error ? e.message : 'Download failed');
    }
  };

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  if (!agentId) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        Select an online agent to browse its file system.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PathBar
        path={path}
        drives={drives}
        historyLength={history.length}
        onGoBack={goBack}
        onGoUp={goUp}
        onDriveChange={handleDriveChange}
        onNavigate={navigateTo}
      />

      <FileList
        entries={sortedEntries}
        loading={loading}
        error={error}
        onRowAction={handleRowAction}
        onContextMenu={handleContextMenu}
        contextEntry={contextEntry}
        onRename={handleRename}
        onMove={handleMove}
        onCopy={handleCopy}
        onDelete={handleDelete}
        onCompress={handleCompress}
        onDecompress={handleDecompress}
        onShortcut={handleShortcut}
        onDownload={handleDownload}
      />

      {DialogComponent}
    </div>
  );
}
