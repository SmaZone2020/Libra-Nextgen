import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Spinner } from '@heroui/react';
import {
  ArrowChevronLeft,
  ArrowRotateLeft,
  Cpu,
  Flame,
  Folder,
  Globe,
  PlugConnection,
  Terminal,
  TrashBin,
} from '@gravity-ui/icons';
import { getAgent, deleteAgent } from '../../api/agents';
import { createTask } from '../../api/tasks';
import { useAgent } from '../../contexts/AgentContext';
import { useDialog } from '../../hooks/useDialog';
import type { AgentDetail } from '../../types/models';
import { HardwareAccordion } from './HardwareAccordion';
import { relativeTime, statusLabel, statusTone } from './agentStatus';

const ACTION_ROUTES = [
  { key: 'shell', icon: Terminal, to: '/shell' },
  { key: 'explorer', icon: Folder, to: '/files' },
  { key: 'system', icon: Cpu, to: '/system' },
  { key: 'softwareData', icon: PlugConnection, to: '/othersoft' },
  { key: 'proxyBrowser', icon: Globe, to: '/proxy' },
] as const;

/** Mobile-style device detail page (also reachable on desktop by URL). */
export default function AgentDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentId: routeId = '' } = useParams<{ agentId: string }>();
  const { agents, agentId: connectedId, selectAgent, disconnect } = useAgent();
  const { confirm, alert, DialogComponent } = useDialog();

  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!routeId) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      setDetail(await getAgent(routeId));
    } catch {
      setFailed(true);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live status from the shared real-time list wins over the fetched detail.
  const liveAgent = agents.find((a) => a.id === routeId);
  const status = liveAgent?.status ?? detail?.status;
  const connected = connectedId === routeId && status === 'Online';

  const runTask = async (commandType: 'Restart' | 'KillAndClean', command: string, confirmKey: string, failKey: string) => {
    const { confirmed } = await confirm(t(confirmKey));
    if (!confirmed) return;
    try {
      await createTask({ agentId: routeId, commandType, command, timeoutSeconds: 5 });
    } catch (e) {
      await alert(`${t(failKey)}\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRemove = async () => {
    const { confirmed } = await confirm(t('agents.removeConfirm'));
    if (!confirmed) return;
    await deleteAgent(routeId);
    navigate('/agents');
  };

  const openAction = (to: string) => {
    if (status !== 'Online') return;
    selectAgent(routeId);
    navigate(to);
  };

  const infoRows: [string, string][] = [];
  if (detail) {
    infoRows.push(
      [t('agents.ip'), detail.ipAddress],
      [t('agents.os'), detail.osVersion],
      [t('agents.arch'), detail.arch],
      [t('agents.user'), detail.userName],
      [t('agents.process'), `${detail.processName} (PID ${detail.pid})`],
      [t('agents.elevated'), detail.isElevated ? t('common.yes') : t('common.no')],
      [t('agents.firstSeen'), new Date(detail.firstSeen).toLocaleString()],
      [t('agents.lastSeen'), relativeTime(t, liveAgent?.lastSeen ?? detail.lastSeen)],
      [t('agents.heartbeat'), `${detail.heartbeatInterval}s`],
    );
    if (detail.geo) {
      infoRows.push(
        [t('agents.region'), detail.geo.region],
        [t('agents.publicIp'), detail.geo.publicIp],
        [t('agents.isp'), detail.geo.isp],
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      <Button
        variant="ghost"
        className="-ml-2 h-auto gap-1 px-2 py-1 text-sm text-neutral-600 dark:text-neutral-300"
        onPress={() => navigate('/agents')}
      >
        <ArrowChevronLeft className="size-4" />
        {t('mobile.back')}
      </Button>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner color="accent" />
        </div>
      ) : failed || !detail ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-300 py-12 text-sm text-neutral-500 dark:border-neutral-700">
          {t('agents.detailsFailed')}
          <Button size="sm" variant="secondary" onPress={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <>
          {/* Hero */}
          <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <span
              aria-hidden="true"
              className={`flex size-14 shrink-0 select-none items-center justify-center rounded-2xl text-base font-semibold ${statusTone(status ?? 'Offline').avatar}`}
            >
              {detail.hostname.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {detail.hostname}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-sm">
                <span className={`size-2 rounded-full ${statusTone(status ?? 'Offline').dot}`} />
                <span className={`font-medium ${statusTone(status ?? 'Offline').text}`}>
                  {statusLabel(t, status ?? 'Offline')}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                {detail.ipAddress} · {relativeTime(t, liveAgent?.lastSeen ?? detail.lastSeen)}
              </div>
            </div>
            {status === 'Online' &&
              (connected ? (
                <Button size="sm" variant="ghost" onPress={disconnect}>
                  {t('common.disconnect')}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onPress={() => selectAgent(routeId)}>
                  {t('common.connect')}
                </Button>
              ))}
          </div>

          {/* Quick actions */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {t('nav.features')}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {ACTION_ROUTES.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  disabled={status !== 'Online'}
                  onClick={() => openAction(action.to)}
                  className="flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 outline-none transition-colors enabled:hover:bg-neutral-100 enabled:active:bg-neutral-200 disabled:opacity-40 dark:enabled:hover:bg-neutral-800"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <action.icon className="size-5" />
                  </span>
                  <span className="w-full truncate text-center text-[11px] leading-tight text-neutral-600 dark:text-neutral-300">
                    {t(`nav.${action.key}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="space-y-1 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            {infoRows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 text-sm">
                <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{label}</span>
                <span className="min-w-0 truncate text-right text-neutral-900 dark:text-neutral-100">
                  {value}
                </span>
              </div>
            ))}
            {detail.hardware && (
              <div className="pt-2">
                <HardwareAccordion hardware={detail.hardware} t={t} />
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 rounded-none px-4 py-3 h-auto"
              onPress={() => void runTask('Restart', 'restart', 'agents.restartConfirm', 'agents.restartFailed')}
            >
              <ArrowRotateLeft className="size-4 shrink-0 text-warning" />
              <span className="text-sm font-medium">{t('agents.restart')}</span>
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 rounded-none border-t border-neutral-200 px-4 py-3 h-auto dark:border-neutral-800"
              onPress={() => void runTask('KillAndClean', 'kill_and_clean', 'agents.destroyConfirm', 'agents.destroyFailed')}
            >
              <Flame className="size-4 shrink-0 text-danger" />
              <span className="text-sm font-medium text-danger">{t('agents.destroy')}</span>
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 rounded-none border-t border-neutral-200 px-4 py-3 h-auto text-danger dark:border-neutral-800"
              onPress={() => void handleRemove()}
            >
              <TrashBin className="size-4 shrink-0 text-danger" />
              <span className="text-sm font-medium text-danger">{t('agents.remove')}</span>
            </Button>
          </div>
        </>
      )}

      {DialogComponent}
    </div>
  );
}
