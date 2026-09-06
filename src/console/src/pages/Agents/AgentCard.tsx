import { useTranslation } from 'react-i18next';
import { Button, Card } from '@heroui/react';
import { PlugConnection, Xmark } from '@gravity-ui/icons';
import type { AgentListItem } from '../../types/models';
import { relativeTime, statusLabel, statusTone } from './agentStatus';

/** Device card in the style of mainstream remote-desktop apps:
 *  avatar + hostname + status; the body opens the device details while the
 *  trailing button explicitly connects (or disconnects) the device. */
export function AgentCard({
  agent,
  connected,
  onOpen,
  onConnect,
  onDisconnect,
  onContextMenu,
}: {
  agent: AgentListItem;
  connected: boolean;
  /** Opens the device detail page/modal without changing the active device. */
  onOpen?: () => void;
  /** Connects the device on click; disabled while the device is offline. */
  onConnect?: () => void;
  /** Disconnects the device; only shown for the connected online device. */
  onDisconnect?: () => void;
  /** Desktop context menu hook: fires with the agent id on right-click. */
  onContextMenu?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const tone = statusTone(agent.status);
  const isOnline = agent.status === 'Online';

  const action = isOnline && connected && onDisconnect
    ? (
      <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.disconnect')} onPress={onDisconnect}>
        <Xmark className="size-4" />
      </Button>
    )
    : isOnline && !connected && onConnect
      ? (
        <Button isIconOnly size="sm" variant="primary" aria-label={t('common.connect')} onPress={onConnect}>
          <PlugConnection className="size-4" />
        </Button>
      )
      : !isOnline && onConnect
        ? (
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.connect')} isDisabled>
            <PlugConnection className="size-4" />
          </Button>
        )
        : null;

  return (
    <Card
      className={`p-2 transition-colors duration-200 ${
        onOpen ? 'cursor-pointer hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50' : ''
      }`}
    >
      <div
        className="flex w-full items-center gap-2"
        onContextMenu={
          onContextMenu
            ? (e) => {
                e.preventDefault();
                onContextMenu(agent.id);
              }
            : undefined
        }
      >
        <div
          role={onOpen ? 'button' : undefined}
          tabIndex={onOpen ? 0 : undefined}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onOpen();
            }
          }}
          className={`flex min-w-0 flex-1 items-center gap-3 p-3 ${
            onOpen ? 'rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/50' : ''
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
                {relativeTime(t, agent.lastSeen)}
              </span>
            </div>
          </div>
        </div>

        {action && <div className="flex shrink-0 items-center pr-2">{action}</div>}
      </div>
    </Card>
  );
}
