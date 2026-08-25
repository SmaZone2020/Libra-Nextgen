import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, Button, Card, Chip, Modal, useOverlayState } from '@heroui/react';
import { ChevronDown, Folder } from '@gravity-ui/icons';
import { listFiles, downloadFile } from '../../api/files';
import { getWeChat } from '../../api/othersoft';
import { fileIcon, formatSize } from '../FileManager/fileIcons';
import type { WeChatAccount } from '../../types/models';
import type { FileEntry } from '../../api/files';

interface WeChatTabProps {
  agentId: string;
}

export function WeChatTab({ agentId }: WeChatTabProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<WeChatAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDirs, setOpenDirs] = useState<Record<string, FileEntry[]>>({});
  const [loadingDir, setLoadingDir] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ entry: FileEntry; dirPath: string } | null>(null);
  const modalState = useOverlayState();

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await getWeChat(agentId);
      setAccounts(res.accounts ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleToggleDir = async (dirPath: string) => {
    if (openDirs[dirPath]) {
      setOpenDirs(prev => { const n = { ...prev }; delete n[dirPath]; return n; });
      return;
    }
    setLoadingDir(dirPath);
    try {
      const res = await listFiles(agentId, dirPath);
      setOpenDirs(prev => ({ ...prev, [dirPath]: res.entries ?? [] }));
    } catch { /* ignore */ }
    finally { setLoadingDir(null); }
  };

  const handleFileClick = (entry: FileEntry, dirPath: string) => {
    setSelectedFile({ entry, dirPath });
    modalState.open();
  };

  if (loading) {
    return <div className="text-center text-neutral-500 py-8">{t('othersoft.loadingWeChat')}</div>;
  }

  if (accounts.length === 0) {
    return <div className="text-center text-neutral-500 py-8">{t('othersoft.noAccounts')}</div>;
  }

  return (
    <div className="space-y-4">
      {accounts.map(acc => (
        <Card key={acc.wxid} className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-medium">{acc.wxid}</span>
            <Chip size="sm">{acc.path}</Chip>
          </div>
          <div className="text-sm text-neutral-500 mb-2">
            {t('othersoft.monthFolders')} ({acc.fileDirs.length})
          </div>
          {acc.fileDirs.length === 0 ? (
            <div className="text-sm text-neutral-400">{t('othersoft.noFiles')}</div>
          ) : (
            <Accordion className="w-full">
              {acc.fileDirs.map(m => {
                const dirPath = `${acc.path}\\msg\\file\\${m}`;
                const files = openDirs[dirPath];
                return (
                  <Accordion.Item key={m}>
                    <Accordion.Heading>
                      <Accordion.Trigger onPress={() => handleToggleDir(dirPath)}>
                        <span className="mr-3 size-4 shrink-0 text-muted">
                          <Folder />
                        </span>
                        {m}
                        <Accordion.Indicator>
                          {loadingDir === dirPath ? (
                            <span className="text-xs text-muted">...</span>
                          ) : (
                            <ChevronDown />
                          )}
                        </Accordion.Indicator>
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body>
                        {files ? (
                          files.length === 0 ? (
                            <div className="text-sm text-neutral-400 py-2">
                              {t('othersoft.noFiles')}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-1">
                              {files.map(f => {
                                const Icon = fileIcon(f);
                                return (
                                  <Button
                                    key={f.name}
                                    variant="ghost"
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-medium text-left"
                                    onPress={() => handleFileClick(f, dirPath)}
                                  >
                                    <Icon className="w-4 h-4 shrink-0 text-default-500" />
                                    <span className="text-sm truncate flex-1 min-w-0">{f.name}</span>
                                    {f.type === 'file' && (
                                      <span className="text-xs text-neutral-400 shrink-0">
                                        {formatSize(f.size)}
                                      </span>
                                    )}
                                  </Button>
                                );
                              })}
                            </div>
                          )
                        ) : (
                          <div className="text-sm text-neutral-400 py-2">
                            {loadingDir === dirPath ? t('othersoft.loadingWeChat') : ''}
                          </div>
                        )}
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>
          )}
        </Card>
      ))}

      {/* File detail modal */}
      <Modal state={modalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[400px]">
              <Modal.CloseTrigger />
              {selectedFile && (() => {
                const { entry, dirPath } = selectedFile;
                const Icon = fileIcon(entry);
                const ext = entry.name.split('.').pop()?.toUpperCase() ?? '—';
                return (
                  <>
                    <Modal.Header>
                      <Modal.Icon className="bg-default text-foreground">
                        <Icon className="size-5" />
                      </Modal.Icon>
                      <Modal.Heading>{entry.name}</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">{t('othersoft.fileType')}</span>
                          <span>{ext}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">{t('othersoft.fileSize')}</span>
                          <span>{entry.type === 'dir' ? '—' : formatSize(entry.size)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">{t('othersoft.fileModified')}</span>
                          <span>{new Date(entry.modified).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">{t('othersoft.filePath')}</span>
                          <span className="text-xs truncate max-w-[200px] text-right">{dirPath}</span>
                        </div>
                      </div>
                    </Modal.Body>
                    <Modal.Footer>
                      <Button
                        className="w-full"
                        slot="close"
                        onPress={() => downloadFile(agentId, `${dirPath}\\${entry.name}`)}
                      >
                        {t('othersoft.download')}
                      </Button>
                    </Modal.Footer>
                  </>
                );
              })()}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
