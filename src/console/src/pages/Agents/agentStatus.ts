import type { TFunction } from 'i18next';
import type { AgentStatus } from '../../types/models';

export interface AgentTone {
  dot: string;
  avatar: string;
  text: string;
}

export function statusTone(status: AgentStatus): AgentTone {
  switch (status) {
    case 'Online':
      return {
        dot: 'bg-emerald-500',
        avatar: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        text: 'text-emerald-600 dark:text-emerald-400',
      };
    case 'Sleeping':
      return {
        dot: 'bg-amber-500',
        avatar: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        text: 'text-amber-600 dark:text-amber-400',
      };
    case 'Compromised':
      return {
        dot: 'bg-red-500',
        avatar: 'bg-red-500/15 text-red-600 dark:text-red-400',
        text: 'text-red-600 dark:text-red-400',
      };
    default:
      return {
        dot: 'bg-neutral-400',
        avatar: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
        text: 'text-neutral-500 dark:text-neutral-400',
      };
  }
}

export function statusLabel(t: TFunction, status: AgentStatus): string {
  switch (status) {
    case 'Online':
      return t('agents.online');
    case 'Sleeping':
      return t('agents.sleeping');
    case 'Compromised':
      return t('agents.compromised');
    default:
      return t('agents.offline');
  }
}

export function relativeTime(t: TFunction, iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return t('time.justNow');
  if (diffSec < 3600) return t('time.minutesAgo', { count: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t('time.hoursAgo', { count: Math.floor(diffSec / 3600) });
  if (diffSec < 86400 * 30) return t('time.daysAgo', { count: Math.floor(diffSec / 86400) });
  return new Date(iso).toLocaleDateString();
}
