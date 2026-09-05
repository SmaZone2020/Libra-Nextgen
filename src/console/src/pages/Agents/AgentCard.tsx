import { useTranslation } from 'react-i18next';
import { ArrowChevronRight } from '@gravity-ui/icons';
import type { AgentListItem } from '../../types/models';
import { relativeTime, statusLabel, statusTone } from './agentStatus';

/** Device card in the style of mainstream remote-desktop apps:
 *  avatar + hostname + status, tap to open the device details. */
export function AgentCard({
  agent,
  connected,
  onOpen,
  onContextMenu,
}: {
  agent: AgentListItem;
  connected: boolean;
  onOpen: () => void;
  /** Desktop context menu hook: fires with the agent id on right-click. */
  onContextMenu?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const tone = statusTone(agent.status);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu(agent.id);
            }
          : undefined
      }
      className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl border bg-white p-3 outline-none transition-colors active:bg-neutral-50 dark:bg-neutral-900 dark:active:bg-neutral-800 ${
        connected
          ? 'border-primary/60'
          : 'border-neutral-200 dark:border-neutral-800'
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-12 shrink-0 select-none items-center justify-center rounded-2xl text-sm font-semibold ${tone.avatar}`}
      >
        {agent.hostname.slice(0, 2).toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {agent.hostname}
          </span>
          {connected && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {t('agents.connected')}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {agent.osVersion}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs">
          <span className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
          <span className={`font-medium ${tone.text}`}>{statusLabel(t, agent.status)}</span>
          <span className="text-neutral-400 dark:text-neutral-500">·</span>
          <span className="truncate text-neutral-500 dark:text-neutral-400">
            {t('agents.lastSeen')} {relativeTime(t, agent.lastSeen)}
          </span>
        </div>
      </div>

      <ArrowChevronRight className="size-4 shrink-0 text-neutral-400" />
    </div>
  );
}
