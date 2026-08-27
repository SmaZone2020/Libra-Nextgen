import { useEffect, useState } from 'react';
import { Button, Card, Chip, Modal, useOverlayState } from '@heroui/react';
import { ChevronDown, Folder } from '@gravity-ui/icons';
import { File, FileCode, FileLetterP, FileLetterW, FileLetterX, FileText, FileZipper, MusicNote, Picture, Video } from '@gravity-ui/icons';
import { usePluginHost } from '../../hooks/usePluginHost';
import { listFiles, downloadFile, type FileEntry } from '../../api/files';

/**
 * 微信文件插件页面（page/index.tsx）—— com.libra.wechat-file。
 *
 * 数据流：
 *   1. dispatchTask('com.libra.wechat-file', 'collect') → Agent 端 native 模块
 *      （wechat_file）扫描 Documents\Tencent Files\xwechat_files\wxid_*，
 *      返回 { accounts: [{ wxid, path, fileDirs: ["2025-01", ...] }] }。
 *   2. 目录展开：listFiles(agentId, dirPath)（宿主 files 模块）按月份拉取文件。
 *   3. 点击文件：详情弹窗 + downloadFile 下载。
 *
 * 保持原「软件数据 → 微信」标签页的 UI 与操作不变。
 */
const PLUGIN_ID = 'com.libra.wechat-file';

interface WeChatAccount {
  wxid: string;
  path: string;
  fileDirs: string[];
}

interface WeChatResult {
  accounts?: WeChatAccount[];
  error?: string;
}

/** 插件结果可能是 JSON 字符串（服务端透传）或已是对象，统一解析。 */
function parseResult(raw: unknown): WeChatResult | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as WeChatResult;
  if (typeof raw === 'string') {
    try {
      const p: unknown = JSON.parse(raw);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as WeChatResult;
    } catch { /* 非 JSON */ }
  }
  return null;
}

function fileIcon(entry: FileEntry): (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element {
  if (entry.type === 'dir') return Folder;
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico'].includes(ext)) return Picture;
  if (['mp4', 'avi', 'mkv', 'mov', 'webm', 'wmv', 'flv'].includes(ext)) return Video;
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return MusicNote;
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return FileZipper;
  if (['pdf'].includes(ext)) return FileLetterP;
  if (['doc', 'docx'].includes(ext)) return FileLetterW;
  if (['xls', 'xlsx'].includes(ext)) return FileLetterX;
  if (['txt', 'md', 'log', 'cfg', 'ini'].includes(ext)) return FileText;
  if (['js', 'ts', 'tsx', 'py', 'cs', 'json', 'xml', 'html', 'css', 'sh', 'bat', 'ps1', 'sql'].includes(ext)) return FileCode;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function WeChatFilePage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [accounts, setAccounts] = useState<WeChatAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDirs, setOpenDirs] = useState<Record<string, FileEntry[]>>({});
  const [loadingDir, setLoadingDir] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ entry: FileEntry; dirPath: string } | null>(null);
  const modalState = useOverlayState();

  const fetchAccounts = async () => {
    if (!selectedAgent) return;
    setLoading(true);
    try {
      const res = await dispatchTask(PLUGIN_ID, 'collect', {});
      const parsed = parseResult(res.result);
      setAccounts(parsed?.error ? [] : (parsed?.accounts ?? []));
    } catch (e) {
      console.warn('wechat-file collect failed:', e);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAccounts(); }, [selectedAgent]);

  const handleToggleDir = async (dirPath: string) => {
    if (openDirs[dirPath]) {
      setOpenDirs(prev => { const n = { ...prev }; delete n[dirPath]; return n; });
      return;
    }
    setLoadingDir(dirPath);
    try {
      const res = await listFiles(selectedAgent!.id, dirPath);
      setOpenDirs(prev => ({ ...prev, [dirPath]: res.entries ?? [] }));
    } catch { /* ignore */ }
    finally { setLoadingDir(null); }
  };

  const handleFileClick = (entry: FileEntry, dirPath: string) => {
    setSelectedFile({ entry, dirPath });
    modalState.open();
  };

  if (loading) {
    return <div className="text-center text-neutral-500 py-8">加载微信账号中...</div>;
  }

  if (accounts.length === 0) {
    return <div className="text-center text-neutral-500 py-8">未发现任何账号。</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" isPending={loading} onPress={fetchAccounts}>
          刷新
        </Button>
      </div>

      {accounts.map(acc => (
        <Card key={acc.wxid} className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-medium">{acc.wxid}</span>
            <Chip size="sm">{acc.path}</Chip>
          </div>
          <div className="text-sm text-neutral-500 mb-2">
            月份文件夹 ({acc.fileDirs.length})
          </div>
          {acc.fileDirs.length === 0 ? (
            <div className="text-sm text-neutral-400">该文件夹内无文件。</div>
          ) : (
            <div className="space-y-1">
              {acc.fileDirs.map(m => {
                const dirPath = `${acc.path}\\msg\\file\\${m}`;
                const files = openDirs[dirPath];
                const open = Boolean(files) || loadingDir === dirPath;
                return (
                  <div key={m} className="rounded-lg border border-default-100">
                    <Button
                      variant="ghost"
                      className="w-full flex items-center gap-2 px-2 py-1.5 justify-start"
                      onPress={() => handleToggleDir(dirPath)}
                    >
                      <span className="size-4 shrink-0 text-muted"><Folder /></span>
                      <span className="text-sm flex-1 text-left">{m}</span>
                      <span className="text-xs text-muted shrink-0">
                        {loadingDir === dirPath ? '...' : <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />}
                      </span>
                    </Button>
                    {open && (
                      <div className="px-2 pb-2">
                        {files ? (
                          files.length === 0 ? (
                            <div className="text-sm text-neutral-400 py-2">该文件夹内无文件。</div>
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
                            {loadingDir === dirPath ? '加载微信账号中...' : ''}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
                          <span className="text-neutral-500">类型</span>
                          <span>{ext}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">大小</span>
                          <span>{entry.type === 'dir' ? '—' : formatSize(entry.size)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">修改时间</span>
                          <span>{new Date(entry.modified).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">路径</span>
                          <span className="text-xs truncate max-w-[200px] text-right">{dirPath}</span>
                        </div>
                      </div>
                    </Modal.Body>
                    <Modal.Footer>
                      <Button
                        className="w-full"
                        slot="close"
                        onPress={() => downloadFile(selectedAgent!.id, `${dirPath}\\${entry.name}`)}
                      >
                        下载
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
