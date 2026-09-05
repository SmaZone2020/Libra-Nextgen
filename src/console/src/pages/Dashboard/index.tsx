'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Modal } from '@heroui/react';
import { Heart, StarFill } from '@gravity-ui/icons';
import { getAgentTraffic } from '../../api/agents';
import { getTasks } from '../../api/tasks';
import { clearRecentEvents, getRecentEvents, type EventItem } from '../../api/events';
import { consoleWs } from '../../ws/consoleWs';
import { TrafficChart, RANGES } from './TrafficChart';
import { SystemDistributionChart } from './SystemDistributionChart';
import { TopologyGraph } from './TopologyGraph';
import { useAgent } from '../../contexts/AgentContext';
import { relativeTime } from '../../utils/relativeTime';
import type { TimeRange } from './TrafficChart';

const GITHUB_REPO_URL = 'https://github.com/SmaZone2020/Libra-Nextgen';

const KIND_DOT: Record<string, string> = {
  agent: 'bg-emerald-500',
  task: 'bg-sky-500',
  operator: 'bg-amber-500',
  shell: 'bg-violet-500',
};

/** Newest first ordering for the recent-activity feed. */
function byNewest(a: EventItem, b: EventItem): number {
  return new Date(b.ts).getTime() - new Date(a.ts).getTime();
}

interface Stat {
  key: string;
  value: number;
  accent?: boolean;
}

export default function Dashboard() {
  const { t } = useTranslation();
  // Shared agent context (real-time via WebSocket)
  const { agents } = useAgent();

  const [donateOpen, setDonateOpen] = useState(false);
  const [trafficData, setTrafficData] = useState<Record<string, number | string>[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [agentHosts, setAgentHosts] = useState<Record<string, string>>({});
  const [range, setRange] = useState<TimeRange>('today');
  const [taskStats, setTaskStats] = useState({ tasks: 0, pending: 0 });
  const [activity, setActivity] = useState<EventItem[]>([]);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const rangeCfg = useMemo(() => RANGES.find((r) => r.key === range)!, [range]);

  // Live stats from the real-time agent list
  const stats = useMemo(() => ({
    agents: agents.length,
    online: agents.filter((a) => a.status === 'Online').length,
    tasks: taskStats.tasks,
    pending: taskStats.pending,
  }), [agents, taskStats]);

  // Recent activity: newest first, mirroring the header event viewer.
  useEffect(() => {
    let cancelled = false;
    getRecentEvents(30)
      .then((r) => {
        if (cancelled) return;
        setActivity((prev) => {
          const ids = new Set(prev.map((e) => e.id));
          const fresh = (r.events ?? []).filter((e) => !ids.has(e.id));
          return [...prev, ...fresh].sort(byNewest).slice(0, 40);
        });
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const off = consoleWs.on('event.item', (msg) => {
      const e = msg.data as unknown as EventItem;
      if (!e?.id || !e?.text) return;
      setActivity((prev) =>
        prev.some((x) => x.id === e.id) ? prev : [e, ...prev].sort(byNewest).slice(0, 40),
      );
    });
    return off;
  }, []);

  // Fetch task totals periodically
  useEffect(() => {
    let cancelled = false;
    async function fetchTasks() {
      try {
        const taskRes = await getTasks(undefined, undefined, 1, 50);
        if (!cancelled) {
          setTaskStats({
            tasks: taskRes.total,
            pending: taskRes.tasks?.filter((x: { status: string }) => x.status === 'Pending').length ?? 0,
          });
        }
      } catch { /* ignore */ }
    }
    fetchTasks();
    const timer = setInterval(fetchTasks, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Fetch traffic data periodically
  useEffect(() => {
    let cancelled = false;
    async function fetchTraffic() {
      try {
        const trafficRes = await getAgentTraffic(rangeCfg.minutes);
        if (cancelled) return;

        const records = trafficRes.traffic ?? [];
        const hosts: Record<string, string> = {};
        for (const r of records) {
          if (r.hostname) hosts[r.agentId] = r.hostname;
        }
        setAgentHosts(hosts);

        const ids = [...new Set(records.map((r) => r.agentId))];
        setAgentIds(ids);

        const bucketMs = rangeCfg.bucketMs;
        const fmt = rangeCfg.xfmt;
        const buckets = new Map<number, Record<string, number>>();
        for (const r of records) {
          const ts = new Date(r.timestamp).getTime();
          const bucketKey = Math.floor(ts / bucketMs) * bucketMs;
          if (!buckets.has(bucketKey)) buckets.set(bucketKey, {});
          const entry = buckets.get(bucketKey)!;
          entry[r.agentId] = (entry[r.agentId] ?? 0) + (r.bytesSent + r.bytesReceived);
        }

        const now = Date.now();
        const startTime = now - rangeCfg.minutes * 60 * 1000;
        const startBucket = Math.floor(startTime / bucketMs) * bucketMs;
        const endBucket = Math.floor(now / bucketMs) * bucketMs;

        const zeroFill: Record<string, number> = {};
        for (const id of ids) zeroFill[id] = 0;

        const chartData: Record<string, number | string>[] = [];
        for (let time = startBucket; time <= endBucket; time += bucketMs) {
          chartData.push({
            time: fmt(new Date(time)),
            ...zeroFill,
            ...(buckets.get(time) ?? {}),
          });
        }
        setTrafficData(chartData);
      } catch { /* ignore */ }
    }

    fetchTraffic();
    const timer = setInterval(fetchTraffic, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [rangeCfg]);

  // Soft-clear on the server first, then drop the local list. Audit logs and
  // other collaborators' feeds are untouched by the backend.
  const handleClearActivity = async () => {
    setClearing(true);
    setClearError(null);
    try {
      await clearRecentEvents();
      setActivity([]);
      setClearOpen(false);
    } catch (err) {
      setClearError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  };

  const metricItems: Stat[] = useMemo(() => [
    { key: t('dashboard.totalAgents'), value: stats.agents },
    { key: t('dashboard.online'), value: stats.online },
    { key: t('dashboard.totalTasks'), value: stats.tasks },
    { key: t('dashboard.pending'), value: stats.pending },
  ], [stats, t]);

  return (
    <div className="flex min-w-0 flex-col gap-6 py-1 sm:gap-8 sm:py-2">
      {/* Typographic metric strip — part of the workspace, not cards. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="lw-metrics" aria-label={t('pageMeta.dashboard.subtitle')}>
          {metricItems.map((m) => (
            <div key={m.key} className="lw-metric">
              <span className="lw-metric-value">{m.value}</span>
              <span className="lw-metric-label">{m.key}</span>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-[10px] text-[12.5px] text-neutral-500 dark:text-neutral-400"
            onPress={() => window.open(GITHUB_REPO_URL, '_blank', 'noopener,noreferrer')}
          >
            <StarFill className="size-4 text-[#E3B341]" />
            <span className="hidden sm:inline">{t('dashboard.sponsor.star')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-[10px] text-[12.5px] text-neutral-500 dark:text-neutral-400"
            onPress={() => setDonateOpen(true)}
          >
            <Heart className="size-4 text-[#FF4BBE]" />
            <span className="hidden sm:inline">{t('dashboard.sponsor.upgrade')}</span>
          </Button>
        </div>
      </div>

      {/* Recent activity — an inner panel like the charts. */}
      <Card className="w-full">
        <Card.Header className="flex-row items-center justify-between gap-3">
          <Card.Title className="font-semibold">{t('dashboard.activityTitle')}</Card.Title>
          {activity.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-[9px] px-2 text-[12px] text-neutral-400 hover:text-danger dark:text-neutral-500"
              onPress={() => {
                setClearError(null);
                setClearOpen(true);
              }}
            >
              {t('dashboard.activityClear')}
            </Button>
          )}
        </Card.Header>
        <Card.Content>
          {activity.length === 0 ? (
            <p className="py-4 text-[13px] text-neutral-400 dark:text-neutral-500">
              {t('dashboard.activityEmpty')}
            </p>
          ) : (
            <div className="lw-activity-scroll">
              {activity.map((e) => {
                const rel = relativeTime(e.ts);
                return (
                  <div key={e.id} className="lw-activity-row">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${KIND_DOT[e.kind] ?? 'bg-neutral-400'}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{e.text}</span>
                    <span className="lw-activity-time">
                      {rel ? t(rel.key, { count: rel.count }) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card.Content>
      </Card>

      {/* Session / system visuals — inner panels, one level under the workspace. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5 lg:gap-5">
        <div className="min-w-0 lg:col-span-2">
          <SystemDistributionChart agents={agents} />
        </div>
        {/* Session topology is desktop-only; mobile stays light. */}
        <div className="hidden min-w-0 sm:block lg:col-span-3">
          <TopologyGraph agents={agents} />
        </div>
      </div>

      {/* Traffic chart (with its range tabs) is desktop-only. */}
      {agentIds.length > 0 && (
        <div className="hidden sm:block">
          <TrafficChart
            trafficData={trafficData}
            agentIds={agentIds}
            agentHosts={agentHosts}
            range={range}
            onRangeChange={setRange}
          />
        </div>
      )}

      <Modal.Backdrop isOpen={donateOpen} onOpenChange={setDonateOpen}>
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('dashboard.sponsor.donateTitle')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col items-center gap-4">
                <img
                  alt={t('dashboard.sponsor.donateTitle')}
                  className="size-64 rounded-2xl border border-default-200 object-contain dark:border-default-800"
                  src="/images/payqr.png"
                />
                <p className="text-sm text-default-500">{t('dashboard.sponsor.donateDesc')}</p>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* Clear-activity confirmation: destructive, requires a second
          confirmation before soft-clearing the current user's events. */}
      <Modal.Backdrop
        isOpen={clearOpen}
        onOpenChange={(open) => {
          if (!open && !clearing) setClearOpen(false);
        }}
      >
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{t('dashboard.activityClearTitle')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-default-500">{t('dashboard.activityClearDesc')}</p>
              {clearError && <p className="mt-2 text-sm text-danger">{clearError}</p>}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={clearing} onPress={() => setClearOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" isPending={clearing} onPress={() => void handleClearActivity()}>
                {t('dashboard.activityClear')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
