import { useTranslation } from 'react-i18next';
import { Display } from '@gravity-ui/icons';
import type { AgentListItem } from '../../types/models';
import { AgentCard } from './AgentCard';

export type AgentListLayout = 'list' | 'grid';

/** Card list of agents with an empty state. `grid` arranges the cards in the
 *  same auto-fill grid used on the nodes page. */
export function AgentCardList({
  agents,
  connectedId,
  layout = 'list',
  onOpen,
  onConnect,
  onDisconnect,
  emptyLabel,
  onContextMenu,
}: {
  agents: AgentListItem[];
  connectedId: string;
  layout?: AgentListLayout;
  onOpen: (id: string) => void;
  /** Explicit per-card connect; offline cards render it disabled. */
  onConnect?: (id: string) => void;
  /** Disconnect the currently connected device from its card. */
  onDisconnect?: () => void;
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
    <div
      className={
        layout === 'grid'
          ? 'grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]'
          : 'space-y-2.5'
      }
    >
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          connected={agent.id === connectedId}
          onOpen={() => onOpen(agent.id)}
          onConnect={onConnect ? () => onConnect(agent.id) : undefined}
          onDisconnect={onDisconnect}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}
