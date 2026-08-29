'use client';

import { useTranslation } from 'react-i18next';
import { Button, Modal, Chip } from '@heroui/react';
import { Clock, ShieldExclamation, Xmark } from '@gravity-ui/icons';
import type { AiToolCall } from '../../api/ai';

export type AiPermit = 'one-time' | '5min' | '20min';

export interface AiApprovalModalProps {
  /** 待审批的工具调用（null 时不显示）。 */
  tool: AiToolCall | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (permit: AiPermit) => void;
  onReject: () => void;
}

/**
 * 档位提升审批模态框：一次性 / 5分钟 / 20分钟 临时许可。
 * 可关闭（不决策）→ 工具调用保留在对话流中，稍后可再次批准/拒绝。
 */
export function AiApprovalModal({
  tool,
  open,
  onOpenChange,
  onApprove,
  onReject,
}: AiApprovalModalProps) {
  const { t } = useTranslation();

  if (!tool) return null;

  const requiredTier = (tool as AiToolCall & { requiredTier?: number }).requiredTier;
  const currentTier = (tool as AiToolCall & { currentTier?: number }).currentTier;

  const permitOptions: { permit: AiPermit; label: string}[] = [
    { permit: 'one-time', label: t('ai.permitOnce') },
    { permit: '5min', label: t('ai.permit5min') },
    { permit: '20min', label: t('ai.permit20min') },
  ];

  return (
    <Modal>
      <Modal.Backdrop isOpen={open} isDismissable onOpenChange={onOpenChange}>
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t('common.close')} onPress={() => onOpenChange(false)}>
              <Xmark className="size-4" />
            </Modal.CloseTrigger>
            <Modal.Header>
              <Modal.Heading className="flex items-center gap-2">
                <ShieldExclamation className="size-5 text-warning" />
                {t('ai.approvalTitle')}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium text-foreground">
                      {tool.toolName}
                    </span>
                    {requiredTier !== undefined && currentTier !== undefined && (
                      <Chip color="warning" variant="soft" size="sm">
                        {t('ai.approvalTierUp', { 
                          from: ['Cognitio', 'Arbitrium', 'Imperium', 'Dictatura'][currentTier], 
                          to: ['Cognitio', 'Arbitrium', 'Imperium', 'Dictatura'][requiredTier] 
                        })}
                      </Chip>
                    )}
                  </div>
                  {tool.argsText && tool.argsText !== '{}' && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">
                      {tool.argsText}
                    </pre>
                  )}
                  {tool.error && (
                    <div className="mt-2 text-xs text-muted">{tool.error}</div>
                  )}
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="flex-col items-stretch gap-2">
              {permitOptions.map((opt) => (
                <Button
                  key={opt.permit}
                  variant={opt.permit === 'one-time' ? 'primary' : 'secondary'}
                  className="w-full justify-start gap-2"
                  onPress={() => onApprove(opt.permit)}
                >
                  <Clock className="size-4 shrink-0" />
                  <span className="flex flex-col items-start leading-tight">
                    <span className="text-sm font-medium">{opt.label}</span>
                  </span>
                </Button>
              ))}
              <Button
                variant="secondary"
                className="w-full text-danger"
                onPress={onReject}
              >
                {t('ai.reject')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
