import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, ProgressBar, Spinner } from '@heroui/react';
import { CircleCheck, CircleXmark } from '@gravity-ui/icons';
import { Stepper } from '../../components/stepper';
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

// ── 构建阶段定义（按服务端 job.Log 的 "=== Stage N: ... ===" 标记识别）─────────

interface BuildStageDef {
  id: string;
  /** 服务端日志里该阶段的标记；命中即推进。 */
  marker: string;
  labelKey: string;
}

const BUILD_STAGES: BuildStageDef[] = [
  { id: 'core', marker: 'Stage 1:', labelKey: 'builder.stageCore' },
  { id: 'srdi', marker: 'Stage 1.5:', labelKey: 'builder.stageSrdi' },
  { id: 'modules', marker: 'Stage 1.6:', labelKey: 'builder.stageModules' },
  { id: 'encrypt', marker: 'Stage 2:', labelKey: 'builder.stageEncrypt' },
  { id: 'loader', marker: 'Stage 3:', labelKey: 'builder.stageLoader' },
  { id: 'inject', marker: 'Stage 4:', labelKey: 'builder.stageInject' },
];

/** 从原始日志行提取阶段序号（0-based）；无标记返回 -1。 */
function stageIndexForLine(line: string): number {
  for (let i = 0; i < BUILD_STAGES.length; i++) {
    if (line.includes(BUILD_STAGES[i]!.marker)) return i;
  }
  return -1;
}

/** 阶段状态：done / active / pending / failed。 */
type StageState = 'done' | 'active' | 'pending' | 'failed';

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

  // ── 从日志推导阶段状态 ─────────────────────────────────────────────

  /** 日志中按出现顺序见过的阶段序号（去重）。 */
  const stageOrder = useMemo(() => {
    const seen = new Set<number>();
    const order: number[] = [];
    for (const line of logs) {
      const idx = stageIndexForLine(line);
      if (idx >= 0 && !seen.has(idx)) {
        seen.add(idx);
        order.push(idx);
      }
    }
    return order;
  }, [logs]);

  const failed = !building && !buildSucceeded && logs.length > 0;
  const currentStage = building ? (stageOrder.length > 0 ? stageOrder[stageOrder.length - 1]! : -1) : -1;

  // 受控 currentStep：构建中 = 当前阶段；失败 = 最后出现的阶段（指示器/分隔线终止于此）；
  // 成功 = 全部完成。
  const stepperStep = useMemo(() => {
    if (failed) return stageOrder.length > 0 ? stageOrder[stageOrder.length - 1]! : 0;
    if (building) return currentStage >= 0 ? currentStage : 0;
    return BUILD_STAGES.length;
  }, [failed, building, currentStage, stageOrder]);

  const stageStates = useMemo<StageState[]>(() => {
    const states: StageState[] = BUILD_STAGES.map(() => 'pending');
    // 已出现 = done（失败时最后一个出现 = failed）
    stageOrder.forEach((idx, pos) => {
      states[idx] = failed && pos === stageOrder.length - 1 ? 'failed' : 'done';
    });
    // 构建中：当前阶段 = active（spinner）
    if (building && currentStage >= 0) states[currentStage] = 'active';
    return states;
  }, [stageOrder, failed, building, currentStage]);

  /** 失败原因（stderr / WARN / error 行，取最后一条）。 */
  const lastError = useMemo(() => {
    if (!failed) return null;
    for (let i = logs.length - 1; i >= 0; i--) {
      const line = logs[i]!;
      if (line.startsWith('[stderr]') || line.startsWith('[WARN]') || /error/i.test(line)) return line;
    }
    return null;
  }, [logs, failed]);

  return (
    <>
      {/* Build Progress Modal（横向步骤时间线） */}
      <Modal.Backdrop
        isOpen={logs.length > 0 || building || buildSucceeded}
        isDismissable={!building}
        onOpenChange={(open) => { if (!open && !building) onCloseLogs(); }}
      >
        <Modal.Container size="lg">
          <Modal.Dialog>
            {!building && <Modal.CloseTrigger />}
            <Modal.Header>
              <Modal.Heading className="flex items-center gap-3">
                {building ? t('builder.buildProgress') : failed ? t('builder.buildFailed') : t('builder.buildSuccess')}
                <span className="text-sm font-normal text-default-500 tabular-nums">{formatElapsed(elapsed)}</span>
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {/* 横向步骤时间线（HeroUI Stepper，currentStep 受控；分隔线自动计算） */}
              <Stepper orientation="horizontal" size="md" currentStep={stepperStep} className="w-full">
                {BUILD_STAGES.map((def, i) => {
                  const state = stageStates[i]!;
                  const isCurrent = i === currentStage;
                  return (
                    <Stepper.Step key={def.id}>
                      <Stepper.StepButton>
                        <Stepper.Indicator>
                          {state === 'done' ? (
                            <Stepper.Icon><CircleCheck className="w-4 h-4" /></Stepper.Icon>
                          ) : state === 'failed' ? (
                            <Stepper.Icon><CircleXmark className="w-4 h-4" /></Stepper.Icon>
                          ) : isCurrent ? (
                            <Spinner size="sm" />
                          ) : (
                            <Stepper.Icon><span className="text-xs">{i + 1}</span></Stepper.Icon>
                          )}
                        </Stepper.Indicator>
                        <Stepper.Content>
                          <Stepper.Title>{t(def.labelKey)}</Stepper.Title>
                        </Stepper.Content>
                      </Stepper.StepButton>
                      <Stepper.Separator />
                    </Stepper.Step>
                  );
                })}
              </Stepper>

              {/* 状态明细 */}
              <div className="flex items-center gap-2 text-sm my-3">
                {building ? (
                  <>
                    <span className="text-default-600">
                      {currentStage >= 0 ? t('builder.stageRunningDetail', { stage: t(BUILD_STAGES[currentStage]!.labelKey) }) : t('builder.preparing')}
                    </span>
                  </>
                ) : failed ? (
                  <span className="text-danger">
                    {t('builder.stageFailedDetail')}
                    {lastError && <span className="ml-2 font-mono text-xs break-all">{lastError}</span>}
                  </span>
                ) : (
                  <span className="text-success flex items-center gap-1.5">
                    <CircleCheck className="w-4 h-4" />
                    {t('builder.stageAllDone')}
                  </span>
                )}
              </div>

              {/* 原始日志（折叠） */}
              <details className="mt-4 group">
                <summary className="cursor-pointer text-xs text-default-500 hover:text-default-700 select-none list-none flex items-center gap-1">
                  <span className="group-open:hidden">▶</span>
                  <span className="hidden group-open:inline">▼</span>
                  {logs.length > 0 ? t('builder.showRawLog', { count: logs.length }) : t('builder.noLogsYet')}
                </summary>
                <div className="bg-default-100 rounded p-3 font-mono text-xs overflow-auto max-h-52 mt-2">
                  {logs.map((line, i) => (
                    <div key={i} className={`whitespace-pre-wrap break-all leading-5 ${line.startsWith('[stderr]') || line.startsWith('[WARN]') ? 'text-warning' : ''}`}>
                      {line}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </details>
            </Modal.Body>
            <Modal.Footer>
              {!building && buildSucceeded && buildId && (
                <Button variant="primary" onPress={() => onDownload(buildId)}>
                  {t('builder.download')}
                </Button>
              )}
              {!building && (
                <Button variant="ghost" onPress={onCloseLogs}>
                  {t('common.close')}
                </Button>
              )}
            </Modal.Footer>
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
