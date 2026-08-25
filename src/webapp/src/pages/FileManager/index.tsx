import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, ProgressBar, useOverlayState } from '@heroui/react';
import { listFiles, getDrives, deleteFile, renameFile, moveFile, copyFile, compressFile, decompressFile, createShortcut, downloadFile, openFile, listArchive } from '../../api/files';
import type { FileEntry } from '../../api/files';
import { PathBar } from './PathBar';
import { FileList, isArchive } from './FileList';
import { useAgent } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';
import { joinPath, getParentPath } from '../../utils/path';

interface DownloadState {
  name: string;
  total: number;
  received: number;
  speed: number;
  status: 'downloading' | 'done' | 'error';
  error?: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatSpeed = (bps: number): string => `${formatBytes(bps)}/s`;

export default function FileManagerPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const { alert, confirm, prompt, DialogComponent } = useDialog();
  const [path, setPath] = useState('C:\\');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inArchive, setInArchive] = useState(false);

  const contextRef = useRef<FileEntry | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dlAbortRef = useRef<AbortController | null>(null);
  const [contextEntry, setContextEntry] = useState<FileEntry | null>(null);
  const [dl, setDl] = useState<DownloadState | null>(null);
  const dlModal = useOverlayState();

  const PAGE_SIZE = 200;

  const sendFileList = useCallback(async (dirPath: string, id?: string) => {
    const targetId = id || agentId;
    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listFiles(targetId, dirPath, 0, PAGE_SIZE);
      setPath(result.path ?? dirPath);
      setEntries(result.entries ?? []);
      setTotal(result.total ?? result.entries?.length ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fileManager.listFailed'));
    } finally { setLoading(false); }
  }, [agentId]);

  const loadMore = useCallback(async () => {
    if (!agentId || loading || loadingMore) return;
    if (entries.length >= total) return;
    setLoadingMore(true);
    try {
      const result = await listFiles(agentId, path, entries.length, PAGE_SIZE);
      const more = result.entries ?? [];
      setEntries(prev => [...prev, ...more]);
      setTotal(result.total ?? (entries.length + more.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fileManager.listFailed'));
    } finally { setLoadingMore(false); }
  }, [agentId, path, entries, total, loading, loadingMore]);

  const hasMore = entries.length < total;

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
    setTotal(0);
    setPath('');
    setHistory([]);
    setLoading(true);

    // Fetch drives first, then list the first available drive
    getDrives(agentId).then((drivesResult) => {
      const driveList = drivesResult.drives ?? (Array.isArray(drivesResult) ? drivesResult : []);
      setDrives(driveList);
      const firstDrive = driveList[0] ?? 'C:\\';
      return listFiles(agentId, firstDrive, 0, PAGE_SIZE).then((fileResult) => {
        setPath(fileResult.path ?? firstDrive);
        setEntries(fileResult.entries ?? []);
        setTotal(fileResult.total ?? fileResult.entries?.length ?? 0);
      });
    }).catch((e) => {
      setError(e instanceof Error ? e.message : t('fileManager.connectFailed'));
    }).finally(() => { setLoading(false); });
  }, [agentId]);

  const navigateTo = useCallback((dirPath: string) => {
    setHistory(prev => [...prev, path]);
    setInArchive(false);
    sendFileList(dirPath);
  }, [path, sendFileList]);

  const executeFile = useCallback(async (filePath: string, name: string) => {
    if (!agentId) return;
    const { confirmed } = await confirm(t('fileManager.openConfirm', { name }));
    if (!confirmed) return;
    try {
      const result = await openFile(agentId, filePath);
      if (result.error) await alert(result.error);
    } catch (e) {
      await alert(e instanceof Error ? e.message : t('fileManager.openFailed'));
    }
  }, [agentId, confirm, alert]);

  const enterArchive = useCallback(async (archivePath: string) => {
    if (!agentId) return;
    setHistory(prev => [...prev, path]);
    setLoading(true);
    setError(null);
    try {
      const result = await listArchive(agentId, archivePath);
      setInArchive(true);
      setPath(result.path ?? archivePath);
      setEntries(result.entries ?? []);
      setTotal(result.total ?? result.entries?.length ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fileManager.listFailed'));
    } finally {
      setLoading(false);
    }
  }, [agentId, path]);

  const exitArchive = useCallback(() => {
    const parentDir = getParentPath(path);
    setInArchive(false);
    sendFileList(parentDir);
  }, [path, sendFileList]);

  const handleRowAction = useCallback((key: string | number) => {
    const entry = entries.find(e => e.name === String(key));
    if (!entry) return;
    const fullPath = joinPath(path, entry.name);
    if (entry.type === 'dir') {
      if (inArchive) return;
      navigateTo(fullPath);
    } else if (isArchive(entry.name)) {
      enterArchive(fullPath);
    } else {
      executeFile(fullPath, entry.name);
    }
  }, [entries, path, navigateTo, inArchive, enterArchive, executeFile]);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1]!;
    setHistory(h => h.slice(0, -1));
    setInArchive(false);
    sendFileList(prev);
  }, [history, sendFileList]);

  const goUp = useCallback(() => {
    if (inArchive) { exitArchive(); return; }
    const parent = getParentPath(path);
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
    return joinPath(path, entry.name);
  };

  const handleOpen = async () => {
    const entry = contextRef.current;
    if (!entry) return;
    await executeFile(getContextPath(), entry.name);
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
    const entry = contextRef.current;
    if (!agentId || !entry) return;
    const filePath = getContextPath();
    const total = entry.size || 0;

    dlAbortRef.current?.abort();
    const abort = new AbortController();
    dlAbortRef.current = abort;

    setDl({ name: entry.name, total, received: 0, speed: 0, status: 'downloading' });
    dlModal.open();

    try {
      await downloadFile(agentId, filePath, {
        total,
        signal: abort.signal,
        onProgress: (p) => setDl(prev => prev ? {
          ...prev,
          received: p.received,
          total: p.total || prev.total,
          speed: p.speed,
        } : prev),
      });
      if (abort.signal.aborted) return;
      setDl(prev => prev ? { ...prev, received: prev.total || prev.received, speed: 0, status: 'done' } : prev);
      setTimeout(() => {
        dlModal.close();
        setDl(null);
      }, 800);
    } catch (e) {
      if (abort.signal.aborted) {
        dlModal.close();
        setDl(null);
        return;
      }
      setDl(prev => prev ? {
        ...prev,
        status: 'error',
        error: e instanceof Error ? e.message : t('fileManager.downloadFailed'),
      } : prev);
    }
  };

  const handleDownloadCancel = () => {
    dlAbortRef.current?.abort();
  };

  const closeDownloadModal = () => {
    if (dl?.status === 'downloading') handleDownloadCancel();
    dlModal.close();
    setDl(null);
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
        entries={entries}
        loading={loading}
        error={error}
        hasMore={hasMore}
        isLoadingMore={loadingMore}
        onLoadMore={loadMore}
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

      {DialogComponent}

      <Modal state={dlModal}>
        <Modal.Backdrop isDismissable={dl?.status !== 'downloading'} isKeyboardDismissDisabled={dl?.status === 'downloading'}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[420px]">
              {dl && (
                <>
                  <Modal.Header>
                    <Modal.Heading className="break-all">{dl.name}</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <div className="space-y-4">
                      <ProgressBar aria-label={t('fileManager.downloadProgress')} value={dl.total > 0 ? Math.min(100, (dl.received / dl.total) * 100) : 0} className="w-full">
                        <ProgressBar.Track>
                          <ProgressBar.Fill />
                        </ProgressBar.Track>
                      </ProgressBar>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-default-500">
                          {formatBytes(dl.received)}
                          {dl.total > 0 && <> / {formatBytes(dl.total)}</>}
                        </span>
                        <span className="font-mono text-xs text-default-600 tabular-nums">
                          {dl.speed > 0 && formatSpeed(dl.speed)}
                        </span>
                      </div>

                      {dl.total > 0 && (
                        <div className="text-right text-xs text-default-400 tabular-nums">
                          {Math.min(100, (dl.received / dl.total) * 100).toFixed(1)}%
                        </div>
                      )}

                      {dl.status === 'done' && (
                        <div className="text-sm text-success-500">{t('fileManager.downloadDone')}</div>
                      )}
                      {dl.status === 'error' && (
                        <div className="text-sm text-danger-500">{dl.error ?? t('fileManager.downloadFailed')}</div>
                      )}
                    </div>
                  </Modal.Body>
                  <Modal.Footer>
                    {dl.status === 'downloading' && (
                      <Button className="flex-1" variant="ghost" onPress={handleDownloadCancel}>
                        {t('fileManager.cancel')}
                      </Button>
                    )}
                    {dl.status !== 'downloading' && (
                      <Button className="flex-1" onPress={closeDownloadModal}>
                        {t('fileManager.close')}
                      </Button>
                    )}
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
