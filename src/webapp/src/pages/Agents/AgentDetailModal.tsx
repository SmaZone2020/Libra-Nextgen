import { useTranslation } from 'react-i18next';
import { Accordion, Button, Chip, Modal, Spinner } from '@heroui/react';
import { ChevronDown } from '@gravity-ui/icons';
import type { AgentDetail } from '../../types/models';

type GpuVendor = 'NVIDIA' | 'Intel' | 'AMD' | 'Other';
type CpuVendor = 'Intel' | 'AMD' | 'Other';

const cpuVendor = (name: string): { label: CpuVendor; color: 'accent' | 'warning' | 'default' } => {
  const n = name.toLowerCase();
  if (n.includes('intel')) return { label: 'Intel', color: 'accent' };
  if (n.includes('amd')) return { label: 'AMD', color: 'warning' };
  return { label: 'Other', color: 'default' };
};

const gpuVendor = (name: string): { label: GpuVendor; color: 'success' | 'accent' | 'warning' | 'default' } => {
  const n = name.toLowerCase();
  if (n.includes('nvidia') || n.includes('geforce') || n.includes('rtx') || n.includes('gtx')) return { label: 'NVIDIA', color: 'success' };
  if (n.includes('intel') || n.includes('arc')) return { label: 'Intel', color: 'accent' };
  if (n.includes('amd') || n.includes('radeon')) return { label: 'AMD', color: 'warning' };
  return { label: 'Other', color: 'default' };
};

function formatBytes(bytes: number, t: (key: string) => string): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} ${t('common.byteUnits.TB')}`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} ${t('common.byteUnits.GB')}`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} ${t('common.byteUnits.MB')}`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} ${t('common.byteUnits.KB')}`;
  return `${bytes} ${t('common.byteUnits.B')}`;
}

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
      <Modal.Container size="lg">
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
          <Modal.Footer>
            <Button slot="close" variant="tertiary">{t('common.close')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function HardwareAccordion({ hardware, t }: { hardware: NonNullable<AgentDetail['hardware']>; t: (key: string, opts?: Record<string, unknown>) => string }) {
  return (
    <Accordion className="border-t border-default-200 pt-3">
      {(hardware.cpu || hardware.gpus.length > 0) && (
        <Accordion.Item key="cpu-gpu">
          <Accordion.Heading>
            <Accordion.Trigger>
              {t('agents.cpuGpu')}
              <Accordion.Indicator>
                <ChevronDown />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="space-y-3">
              {hardware.cpu && (
                <div>
                  <p className="text-md font-bold mb-1">{t('agents.cpu')}</p>
                  <div className="flex items-center gap-2 mb-1">
                    {(() => { const v = cpuVendor(hardware.cpu.name); return <Chip color={v.color} size="sm" variant="soft">{v.label}</Chip>; })()}
                    <span className="text-sm">{hardware.cpu.name}</span>
                  </div>
                  <p className="text-xs text-default-500">
                    {t('agents.cores', { physical: hardware.cpu.physicalCores, logical: hardware.cpu.logicalCores })} &middot; {hardware.cpu.maxClockMHz} MHz
                  </p>
                </div>
              )}
              {hardware.gpus.length > 0 && (
                <div>
                  <p className="text-md font-bold mb-1">{t('agents.gpu')}</p>
                  {hardware.gpus.map((g, i) => {
                    const v = gpuVendor(g.name);
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Chip color={v.color} size="sm" variant="soft">{v.label}</Chip>
                        <span>{g.name}{g.vramBytes ? ` (${formatBytes(g.vramBytes, t)})` : ''}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      )}
      {(hardware.ram || hardware.disks.length > 0) && (
        <Accordion.Item key="ram-disks">
          <Accordion.Heading>
            <Accordion.Trigger>
              {t('agents.ramDisks')}
              <Accordion.Indicator>
                <ChevronDown />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="space-y-3">
              {hardware.ram && (
                <div>
                  <p className="text-md font-bold mb-1">{t('agents.ram')}</p>
                  <p className="text-sm">{formatBytes(hardware.ram.totalBytes, t)}</p>
                </div>
              )}
              {hardware.disks.length > 0 && (
                <div>
                  <p className="text-md font-bold mb-1">{t('agents.disks')}</p>
                  {hardware.disks.map((d, i) => (
                    <p key={i} className="text-sm">
                      {d.model} &mdash; {formatBytes(d.sizeBytes, t)}{d.mediaType ? ` (${d.mediaType})` : ''}
                    </p>
                  ))}
                </div>
              )}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      )}
      {hardware.displays.length > 0 && (
        <Accordion.Item key="displays">
          <Accordion.Heading>
            <Accordion.Trigger>
              {t('agents.displays')}
              <Accordion.Indicator>
                <ChevronDown />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              {hardware.displays.map((d, i) => (
                <p key={i} className="text-sm">
                  {d.name} &mdash; {d.width}x{d.height}
                </p>
              ))}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      )}
      {(hardware.motherboardVendor || hardware.biosVersion) && (
        <Accordion.Item key="motherboard">
          <Accordion.Heading>
            <Accordion.Trigger>
              {t('agents.motherboardBios')}
              <Accordion.Indicator>
                <ChevronDown />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <p className="text-sm">
                {hardware.motherboardVendor}{hardware.motherboardVendor && hardware.biosVersion ? ' / ' : ''}
                {hardware.biosVersion}
              </p>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      )}
    </Accordion>
  );
}
