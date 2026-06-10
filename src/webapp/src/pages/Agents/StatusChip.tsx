import { Chip } from '@heroui/react';
import type { AgentStatus } from '../../types/models';

export const statusColor = (s: AgentStatus) =>
  s === 'Online' ? 'success' : s === 'Offline' ? 'default' : 'warning';

export function StatusChip({ status }: { status: AgentStatus }) {
  return (
    <Chip color={statusColor(status)} size="sm" variant="soft">
      {status}
    </Chip>
  );
}
