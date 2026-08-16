import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Spinner } from '@heroui/react';
import { CircleCheck } from '@gravity-ui/icons';
import type { BuildRecordDetail } from '../../types/models';
import { APP_TYPE_LABEL, PLATFORM_LABEL, STATUS_LABEL } from './constants';

interface BuilderModalsProps {
  building: boolean;
  buildSucceeded: boolean;
  logs: string[];
  elapsed: number;
  buildId: string | null;
  templateToDelete: string | null;
  selectedRecord: BuildRecordDetail | null;
  infoLoading: boolean;
  onCloseLogs: () => void;
  onDownload: (id: string) => void;
  onConfirmDeleteTemplate: () => void;
  onCancelDeleteTemplate: () => void;
  onCloseInfo: () => void;
}

const formatElapsed = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (iso: string): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
};

export function BuilderModals({
  building,
  buildSucceeded,
  logs,
  elapsed,
  buildId,
  templateToDelete,
  selectedRecord,
  infoLoading,
  onCloseLogs,
  onDownload,
  onConfirmDeleteTemplate,
  onCancelDeleteTemplate,
  onCloseInfo,
}: BuilderModalsProps) {
  const { t } = useTranslation();
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <>
      {/* Build Log / Success Modal */}
      <Modal.Backdrop
        isOpen={logs.length > 0 || building || buildSucceeded}
        isDismissable={!building}
        onOpenChange={(open) => { if (!open && !building) onCloseLogs(); }}
      >
        <Modal.Container size={buildSucceeded && !building ? "lg" : "cover"}>
          <Modal.Dialog>
            {!building && <Modal.CloseTrigger />}
            {buildSucceeded && !building ? (
              <>
                <Modal.Body>
                  <div className="flex flex-col items-center py-10 gap-4">
                    <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center">
                      <CircleCheck className="w-10 h-10 text-white" />
                    </div>
                    <h2 className="text-2xl font-semibold">{t('builder.buildSuccess')}</h2>
                    <p className="text-default-500 text-lg">{t('builder.buildSuccessDesc', { time: formatElapsed(elapsed) })}</p>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  {buildId && (
                    <Button variant="primary" onPress={() => onDownload(buildId)}>
                      {t('builder.download')}
                    </Button>
                  )}
                  <Button variant="ghost" onPress={onCloseLogs}>
                    {t('common.close')}
                  </Button>
                </Modal.Footer>
              </>
            ) : (
              <>
                <Modal.Header>
                  <Modal.Heading className="flex items-center gap-3">
                    {t('builder.buildLog')}
                    <span className="text-sm font-normal text-default-500 tabular-nums">
                      {formatElapsed(elapsed)}
                    </span>
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <div className="bg-default-100 rounded p-3 font-mono text-xs overflow-auto">
                    {logs.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all leading-5">
                        {line}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </Modal.Body>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* Delete Template Confirm Modal */}
      <Modal.Backdrop isOpen={!!templateToDelete} onOpenChange={(open) => { if (!open) onCancelDeleteTemplate(); }}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{t('builder.deleteTemplate')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-default-600">{t('builder.deleteTemplateConfirm')}</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onCancelDeleteTemplate}>{t('common.cancel')}</Button>
              <Button variant="danger" onPress={onConfirmDeleteTemplate}>{t('common.delete')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* Info Modal */}
      <Modal.Backdrop isOpen={!!selectedRecord} onOpenChange={() => onCloseInfo()}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('builder.buildInfo')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {infoLoading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : selectedRecord ? (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div><strong>{t('builder.platform')}:</strong> {PLATFORM_LABEL[selectedRecord.platform] || selectedRecord.platform}</div>
                    <div><strong>{t('builder.applicationType')}:</strong> {selectedRecord.config ? t(APP_TYPE_LABEL[selectedRecord.config.applicationType] || selectedRecord.config.applicationType) : '-'}</div>
                    <div><strong>{t('builder.fileSize')}:</strong> {formatSize(selectedRecord.fileSize)}</div>
                    <div><strong>{t('builder.buildTime')}:</strong> {formatDate(selectedRecord.createdAt)}</div>
                    <div>
                      <strong>Status:</strong>{' '}
                      <span className={selectedRecord.status === 'failed' ? 'text-danger' : selectedRecord.status === 'completed' ? 'text-success' : 'text-primary'}>
                        {t(STATUS_LABEL[selectedRecord.status] || selectedRecord.status)}
                      </span>
                    </div>
                  </div>
                  {selectedRecord.error && (
                    <div className="p-2 bg-danger-50 text-danger-700 rounded text-xs">{selectedRecord.error}</div>
                  )}
                  {selectedRecord.config && (
                    <>
                      <hr className="border-default-200" />
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-semibold mb-1">{t('builder.connection')}</h4>
                          <div className="text-default-600">
                            {selectedRecord.config.serverHost}:{selectedRecord.config.serverPort}
                          </div>
                        </div>
                        <div>
                          <h4 className="font-semibold mb-1">{t('builder.buildOptions')}</h4>
                          <div className="text-default-600 space-y-0.5">
                            <div>{t('builder.stripSymbols')}: {selectedRecord.config.stripSymbols ? t('common.yes') : t('common.no')}</div>
                            <div>{t('builder.enableObfuscation')}: {selectedRecord.config.enableObfuscation ? t('common.yes') : t('common.no')}</div>
                            <div>{t('builder.injectJunkData')}: {selectedRecord.config.injectJunkData ? `${t('common.yes')} (${selectedRecord.config.junkDataMb} MB)` : t('common.no')}</div>
                          </div>
                        </div>
                        <div>
                          <h4 className="font-semibold mb-1">{t('builder.persistence')}</h4>
                          <div className="text-default-600 space-y-0.5">
                            <div>{t('builder.requireAdmin')}: {selectedRecord.config.requireAdmin ? t('common.yes') : t('common.no')}</div>
                            <div>{t('builder.copyToAppData')}: {selectedRecord.config.copyToAppData ? t('common.yes') : t('common.no')}</div>
                            <div>{t('builder.enablePersistence')}: {selectedRecord.config.enablePersistence ? t('common.yes') : t('common.no')}</div>
                          </div>
                        </div>
                        {(selectedRecord.config.companyName || selectedRecord.config.fileDescription || selectedRecord.config.productName || selectedRecord.config.copyright || selectedRecord.config.fileVersion || selectedRecord.config.iconUrl) && (
                          <div>
                            <h4 className="font-semibold mb-1">{t('builder.metadata')}</h4>
                            <div className="text-default-600 space-y-0.5">
                              {selectedRecord.config.companyName && <div>{t('builder.companyName')}: {selectedRecord.config.companyName}</div>}
                              {selectedRecord.config.fileDescription && <div>{t('builder.fileDescription')}: {selectedRecord.config.fileDescription}</div>}
                              {selectedRecord.config.productName && <div>{t('builder.productName')}: {selectedRecord.config.productName}</div>}
                              {selectedRecord.config.copyright && <div>{t('builder.copyright')}: {selectedRecord.config.copyright}</div>}
                              {selectedRecord.config.fileVersion && <div>{t('builder.fileVersion')}: {selectedRecord.config.fileVersion}</div>}
                              {selectedRecord.config.iconUrl && <div className="truncate max-w-[300px]">{t('builder.icon')}: {selectedRecord.config.iconUrl}</div>}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              {selectedRecord && selectedRecord.status === 'completed' && (
                <Button variant="primary" onPress={() => onDownload(selectedRecord.id)}>
                  {t('builder.download')}
                </Button>
              )}
              <Button variant="ghost" onPress={onCloseInfo}>{t('common.close')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
