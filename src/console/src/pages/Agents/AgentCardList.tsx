import { useTranslation } from 'react-i18next';
import { Display } from '@gravity-ui/icons';
import type { AgentListItem } from '../../types/models';
import { AgentCard } from './AgentCard';

/** Card list of agents with an empty state. */
export function AgentCardList({
  agents,
  connectedId,
  onOpen,
  emptyLabel,
  onContextMenu,
}: {
  agents: AgentListItem[];
  connectedId: string;
  onOpen: (id: string) => void;
  /** Overrides the default "no agents" copy (e.g. "nothing matches the filter"). */
  emptyLabel?: string;
  /** Optional right-click hook per card (desktop context menu). */
  onContextMenu?: (id: string) => void;
}) {
  const { t } = useTranslation();

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-300 py-10 text-neutral-400 dark:border-neutral-700">
        <Display className="size-8" />
        <p className="text-sm">{emptyLabel ?? t('agents.noAgents')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          connected={agent.id === connectedId}
          onOpen={() => onOpen(agent.id)}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}
