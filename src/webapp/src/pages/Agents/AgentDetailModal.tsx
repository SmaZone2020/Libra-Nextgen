import { useTranslation } from 'react-i18next';
import { Accordion, Chip, Modal, Spinner } from '@heroui/react';
import { ChevronDown, Cpu, Gpu, HardDrive, Display } from '@gravity-ui/icons';
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
    [t('agents.publicIp'), agent.geo?.publicIp || '—'],
    [t('agents.region'), agent.geo?.region || '—'],
    [t('agents.isp'), agent.geo?.isp ? `${agent.geo.isp} (${agent.geo.llc || ''})` : '—'],
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
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function HardwareAccordion({ hardware, t }: { hardware: AgentDetail['hardware']; t: (key: string) => string }) {
  if (!hardware) return null;

  const cpu = hardware.cpu;
  const gpu = hardware.gpu;
  const cpuInfo = cpu ? cpuVendor(cpu.model || '') : null;
  const gpuInfo = gpu ? gpuVendor(gpu.model || '') : null;

  const items = [];

  // CPU + GPU
  if (cpu || gpu) {
    const lines: React.ReactNode[] = [];
    if (cpu) {
      lines.push(
        <div key="cpu" className="flex justify-between">
          <span className="text-default-500">CPU</span>
          <span className="text-default-700">
            {cpu.model || '—'}
            {cpuInfo && <Chip size="sm" variant="soft" color={cpuInfo.color} className="ml-2">{cpuInfo.label}</Chip>}
            {cpu.cores ? ` (${cpu.cores} cores)` : ''}
          </span>
        </div>
      );
    }
    if (gpu) {
      lines.push(
        <div key="gpu" className="flex justify-between">
          <span className="text-default-500">GPU</span>
          <span className="text-default-700">
            {gpu.model || '—'}
            {gpuInfo && <Chip size="sm" variant="soft" color={gpuInfo.color} className="ml-2">{gpuInfo.label}</Chip>}
          </span>
        </div>
      );
    }
    items.push({ id: 'processor', icon: <Cpu />, title: t('agents.processorGpu'), content: lines });
  }

  // RAM + Disk
  if (hardware.ram || (hardware.disks && hardware.disks.length > 0)) {
    const lines: React.ReactNode[] = [];
    if (hardware.ram) {
      lines.push(
        <div key="ram" className="flex justify-between">
          <span className="text-default-500">RAM</span>
          <span className="text-default-700">{formatBytes(hardware.ram.totalBytes, t)}</span>
        </div>
      );
    }
    if (hardware.disks && hardware.disks.length > 0) {
      lines.push(
        <div key="disk" className="flex justify-between">
          <span className="text-default-500">Disk</span>
          <span className="text-default-700">{formatBytes(hardware.disks[0].sizeBytes, t)}</span>
        </div>
      );
    }
    items.push({ id: 'memory', icon: <HardDrive />, title: t('agents.ramDisks'), content: lines });
  }

  // Display
  if (hardware.displays && hardware.displays.length > 0) {
    const lines = hardware.displays.map((d, i) => (
      <div key={i} className="flex justify-between">
        <span className="text-default-500">{t('agents.display')} {i + 1}</span>
        <span className="text-default-700">{d.width}×{d.height}</span>
      </div>
    ));
    items.push({ id: 'display', icon: <Display />, title: t('agents.displayInfo'), content: lines });
  }

  if (items.length === 0) return null;

  return (
    <Accordion className="w-full">
      {items.map((item) => (
        <Accordion.Item key={item.id}>
          <Accordion.Heading>
            <Accordion.Trigger>
              <span className="mr-3 size-4 shrink-0 text-muted">{item.icon}</span>
              {item.title}
              <Accordion.Indicator>
                <ChevronDown />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="space-y-1 text-sm">{item.content}</div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
