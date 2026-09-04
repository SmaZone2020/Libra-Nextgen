import { Accordion, Chip } from '@heroui/react';
import { ChevronDown, Cpu, HardDrive, Display } from '@gravity-ui/icons';
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

export function HardwareAccordion({ hardware, t }: { hardware: AgentDetail['hardware']; t: (key: string) => string }) {
  if (!hardware) return null;

  const cpu = hardware.cpu;
  const gpu = hardware.gpus?.[0];
  const cpuInfo = cpu ? cpuVendor(cpu.name || '') : null;
  const gpuInfo = gpu ? gpuVendor(gpu.name || '') : null;

  const items = [];

  // CPU + GPU
  if (cpu || gpu) {
    const lines: React.ReactNode[] = [];
    if (cpu) {
      lines.push(
        <div key="cpu" className="flex justify-between">
          <span className="text-default-500">CPU</span>
          <span className="text-default-700">
            {cpu.name || '—'}
            {cpuInfo && <Chip size="sm" variant="soft" color={cpuInfo.color} className="ml-2">{cpuInfo.label}</Chip>}
            {cpu.physicalCores ? ` (${cpu.physicalCores} cores)` : ''}
          </span>
        </div>
      );
    }
    if (gpu) {
      lines.push(
        <div key="gpu" className="flex justify-between">
          <span className="text-default-500">GPU</span>
          <span className="text-default-700">
            {gpu.name || '—'}
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
          <span className="text-default-700">{formatBytes(hardware.disks[0]!.sizeBytes, t)}</span>
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
