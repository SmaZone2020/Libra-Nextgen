import { useTranslation } from 'react-i18next';
import { Button, Modal, ProgressBar, useOverlayState } from '@heroui/react';

export interface DownloadState {
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

export interface DownloadModalProps {
  state: DownloadState | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onClose: () => void;
}

export function DownloadModal({ state: dl, open, onOpenChange, onCancel, onClose }: DownloadModalProps) {
  const { t } = useTranslation();
  const modal = useOverlayState({ isOpen: open, onOpenChange });

  return (
    <Modal state={modal}>
      <Modal.Backdrop isDismissable={dl?.status !== 'downloading'} isKeyboardDismissDisabled={dl?.status === 'downloading'}>
        <Modal.Container placement="center">
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
                    <Button className="flex-1" variant="ghost" onPress={onCancel}>
                      {t('fileManager.cancel')}
                    </Button>
                  )}
                  {dl.status !== 'downloading' && (
                    <Button className="flex-1" onPress={onClose}>
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
  );
}
