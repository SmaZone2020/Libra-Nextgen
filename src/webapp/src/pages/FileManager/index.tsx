import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { listFiles, getDrives, deleteFile, renameFile, moveFile, copyFile, compressFile, decompressFile, createShortcut, downloadFile, readFile, listArchive } from '../../api/files';
import type { FileEntry } from '../../api/files';
import { Modal, Spinner } from '@heroui/react';
import { PathBar } from './PathBar';
import { FileList, isArchive } from './FileList';
import { useAgent } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';

function decodeContent(base64: string): string {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '[binary file — cannot preview]';
  }
}

export default function FileManagerPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const { alert, confirm, prompt, DialogComponent } = useDialog();
  const [path, setPath] = useState('C:\\');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inArchive, setInArchive] = useState(false);

  const [fileViewer, setFileViewer] = useState<{ name: string; content: string } | null>(null);
  const [fileViewLoading, setFileViewLoading] = useState(false);

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
      setError(e instanceof Error ? e.message : t('fileManager.listFailed'));
    } finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      setEntries([]);
      setHistory([]);
      setDrives([]);
      setPath('');
      setInArchive(false);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setEntries([]);
    setPath('');
    setHistory([]);
    setLoading(true);

    // Fetch drives first, then list the first available drive
    getDrives(agentId).then((drivesResult) => {
      const driveList = drivesResult.drives ?? (Array.isArray(drivesResult) ? drivesResult : []);
      setDrives(driveList);
      const firstDrive = driveList[0] ?? 'C:\\';
      return listFiles(agentId, firstDrive).then((fileResult) => {
        setPath(fileResult.path);
        setEntries(fileResult.entries);
      });
    }).catch((e) => {
      setError(e instanceof Error ? e.message : t('fileManager.connectFailed'));
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
    setInArchive(false);
    sendFileList(dirPath);
  }, [path, sendFileList]);

  const openFile = useCallback(async (filePath: string, name: string) => {
    if (!agentId) return;
    setFileViewLoading(true);
    setFileViewer({ name, content: '' });
    try {
      const result = await readFile(agentId, filePath);
      if (result.error) {
        await alert(result.error);
        setFileViewer(null);
      } else {
        setFileViewer({ name, content: decodeContent(result.content) });
      }
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.openFailed'));
      setFileViewer(null);
    } finally {
      setFileViewLoading(false);
    }
  }, [agentId, alert]);

  const enterArchive = useCallback(async (archivePath: string) => {
    if (!agentId) return;
    setHistory(prev => [...prev, path]);
    setLoading(true);
    setError(null);
    try {
      const result = await listArchive(agentId, archivePath);
      setInArchive(true);
      setPath(result.path);
      setEntries(result.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fileManager.listFailed'));
    } finally {
      setLoading(false);
    }
  }, [agentId, path]);

  const exitArchive = useCallback(() => {
    const parentDir = path.replace(/\\+$/, '').split('\\').slice(0, -1).join('\\') || 'C:\\';
    setInArchive(false);
    sendFileList(parentDir);
  }, [path, sendFileList]);

  const handleRowAction = useCallback((key: string | number) => {
    const entry = entries.find(e => e.name === String(key));
    if (!entry) return;
    const fullPath = path.replace(/\\+$/, '') + '\\' + entry.name;
    if (entry.type === 'dir') {
      if (inArchive) return;
      navigateTo(fullPath);
    } else if (isArchive(entry.name)) {
      enterArchive(fullPath);
    } else {
      openFile(fullPath, entry.name);
    }
  }, [entries, path, navigateTo, inArchive, enterArchive, openFile]);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1]!;
    setHistory(h => h.slice(0, -1));
    setInArchive(false);
    sendFileList(prev);
  }, [history, sendFileList]);

  const goUp = useCallback(() => {
    if (inArchive) { exitArchive(); return; }
    const parent = path.split('\\').slice(0, -1).join('\\') || path[0] + ':\\';
    navigateTo(parent);
  }, [path, navigateTo, inArchive, exitArchive]);

  const handleDriveChange = useCallback((drive: string) => {
    setHistory(prev => [...prev, path]);
    setInArchive(false);
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

  const handleOpen = async () => {
    const entry = contextRef.current;
    if (!entry) return;
    await openFile(getContextPath(), entry.name);
  };

  const handleViewArchive = async () => {
    const entry = contextRef.current;
    if (!entry) return;
    await enterArchive(getContextPath());
  };

  const handleRename = async () => {
    if (!agentId || !contextRef.current) return;
    const { confirmed, value } = await prompt(t('fileManager.renamePrompt'), contextRef.current.name);
    if (!confirmed || !value || value === contextRef.current.name) return;
    try {
      await renameFile(agentId, getContextPath(), value);
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.renameFailed'));
    }
  };

  const handleMove = async () => {
    if (!agentId || !contextRef.current) return;
    const { confirmed, value } = await prompt(t('fileManager.movePrompt'));
    if (!confirmed || !value) return;
    try {
      await moveFile(agentId, getContextPath(), value);
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.moveFailed'));
    }
  };

  const handleCopy = async () => {
    if (!agentId || !contextRef.current) return;
    const { confirmed, value } = await prompt(t('fileManager.copyPrompt'));
    if (!confirmed || !value) return;
    try {
      await copyFile(agentId, getContextPath(), value);
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.copyFailed'));
    }
  };

  const handleDelete = async () => {
    if (!agentId || !contextRef.current) return;
    const { confirmed } = await confirm(t('fileManager.deleteConfirm', { name: contextRef.current.name }));
    if (!confirmed) return;
    try {
      await deleteFile(agentId, getContextPath());
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.deleteFailed'));
    }
  };

  const handleCompress = async () => {
    if (!agentId || !contextRef.current) return;
    try {
      await compressFile(agentId, getContextPath());
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.compressFailed'));
    }
  };

  const handleDecompress = async () => {
    if (!agentId || !contextRef.current) return;
    try {
      await decompressFile(agentId, getContextPath());
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.decompressFailed'));
    }
  };

  const handleShortcut = async () => {
    if (!agentId || !contextRef.current) return;
    try {
      await createShortcut(agentId, getContextPath());
      sendFileList(path);
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.shortcutFailed'));
    }
  };

  const handleDownload = async () => {
    if (!agentId || !contextRef.current) return;
    try {
      await downloadFile(agentId, getContextPath());
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.downloadFailed'));
    }
  };

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  if (!agentId) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        {t('fileManager.selectAgent')}
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
        onOpen={handleOpen}
        onViewArchive={handleViewArchive}
        onRename={handleRename}
        onMove={handleMove}
        onCopy={handleCopy}
        onDelete={handleDelete}
        onCompress={handleCompress}
        onDecompress={handleDecompress}
        onShortcut={handleShortcut}
        onDownload={handleDownload}
      />

      {/* File content viewer */}
      <Modal.Backdrop isOpen={!!fileViewer} onOpenChange={(open) => { if (!open) setFileViewer(null); }}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading className="break-all">{fileViewer?.name}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {fileViewLoading ? (
                <div className="flex justify-center py-8"><Spinner size="lg" /></div>
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-[60vh] overflow-auto bg-default-100 rounded p-3">
                  {fileViewer?.content}
                </pre>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {DialogComponent}
    </div>
  );
}
