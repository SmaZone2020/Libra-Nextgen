import { useTranslation } from 'react-i18next';
import { Modal, Spinner } from '@heroui/react';
import type { AgentDetail } from '../../types/models';
import { HardwareAccordion } from './HardwareAccordion';

interface AgentDetailModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentDetail | null;
  loading: boolean;
}

export function AgentDetailModal({ isOpen, onOpenChange, agent, loading }: AgentDetailModalProps) {
  const { t } = useTranslation();

  const infoFields: [string, string][] = agent ? [
    [t('agents.ip'), agent.ipAddress],
    [t('agents.os'), agent.osVersion],
    [t('agents.arch'), agent.arch],
    [t('agents.user'), agent.userName],
    [t('agents.process'), `${agent.processName} (PID ${agent.pid})`],
    [t('agents.elevated'), agent.isElevated ? t('common.yes') : t('common.no')],
    [t('agents.firstSeen'), new Date(agent.firstSeen).toLocaleString()],
    [t('agents.heartbeat'), `${agent.heartbeatInterval}s`],
  ] : [];

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="center" size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              {agent ? agent.hostname : t('agents.details')}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner color="accent" />
              </div>
            ) : agent ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  {infoFields.map(([label, value]) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-default-500">{label}</span>
                      <span className="text-default-700">{value}</span>
                    </div>
                  ))}
                </div>
                {agent.hardware && (
                  <HardwareAccordion hardware={agent.hardware} t={t} />
                )}
              </div>
            ) : (
              <p className="text-default-500 text-sm text-center py-4">
                {t('agents.detailsFailed')}
              </p>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
