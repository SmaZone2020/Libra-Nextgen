'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAgentTraffic } from '../../api/agents';
import { getTasks } from '../../api/tasks';
import { StatsCards } from './StatsCards';
import { TrafficChart, RANGES } from './TrafficChart';
import { SystemDistributionChart } from './SystemDistributionChart';
import { TopologyGraph } from './TopologyGraph';
import { useAgent } from '../../contexts/AgentContext';
import type { TimeRange } from './TrafficChart';
import { Button, Card } from '@heroui/react';
import { Check, Heart, StarFill } from '@gravity-ui/icons';

export default function Dashboard() {
  const { t } = useTranslation();
  // Use shared agent context (real-time via WebSocket)
  const { agents } = useAgent();

  const [trafficData, setTrafficData] = useState<Record<string, number | string>[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [agentHosts, setAgentHosts] = useState<Record<string, string>>({});
  const [range, setRange] = useState<TimeRange>('today');
  const [taskStats, setTaskStats] = useState({ tasks: 0, pending: 0 });

  const rangeCfg = useMemo(() => RANGES.find(r => r.key === range)!, [range]);

  // Compute stats from real-time agents
  const stats = useMemo(() => ({
    agents: agents.length,
    online: agents.filter(a => a.status === 'Online').length,
    tasks: taskStats.tasks,
    pending: taskStats.pending,
  }), [agents, taskStats]);

  // Fetch tasks periodically
  useEffect(() => {
    let cancelled = false;
    async function fetchTasks() {
      try {
        const taskRes = await getTasks(undefined, undefined, 1, 50);
        if (!cancelled) {
          setTaskStats({
            tasks: taskRes.total,
            pending: taskRes.tasks?.filter((t: { status: string }) => t.status === 'Pending').length ?? 0,
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

        const ids = [...new Set(records.map(r => r.agentId))];
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
        for (let t = startBucket; t <= endBucket; t += bucketMs) {
          chartData.push({
            time: fmt(new Date(t)),
            ...zeroFill,
            ...(buckets.get(t) ?? {}),
          });
        }
        setTrafficData(chartData);
      } catch { /* ignore */ }
    }

    fetchTraffic();
    const timer = setInterval(fetchTraffic, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [rangeCfg]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,450px)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="relative flex h-full w-full flex-col overflow-hidden border border-accent/20 bg-linear-to-br from-accent/12 via-surface to-surface-secondary shadow-lg shadow-accent/10 dark:border-accent/30 dark:from-accent/20 dark:via-surface dark:to-accent/8 dark:shadow-accent/5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-accent/20 blur-3xl dark:bg-accent/30"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-8 -left-8 size-28 rounded-full bg-accent/10 blur-2xl dark:bg-accent/20"
          />
          <Card.Header className="relative gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-32 shrink-0 items-center justify-center">
                <img
                  alt="icon"
                  className="pointer-events-none h-full w-full object-cover select-none dark:invert"
                  loading="lazy"
                  src="/images/icon2.webp"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div>
                  <Card.Title>{t('dashboard.sponsor.title')}</Card.Title>
                  <Card.Description>{t('dashboard.sponsor.description')}</Card.Description>
                </div>
                <ul className="flex flex-col gap-1.5">
                  <li className="flex items-center gap-2 text-sm text-muted">
                    <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />
                    {t('dashboard.sponsor.benefits.plugins')}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-muted">
                    <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />
                    {t('dashboard.sponsor.benefits.consulting')}
                  </li>
                </ul>
              </div>
            </div>
          </Card.Header>
          <Card.Footer className="mb-auto ml-auto flex gap-2">
            <Button variant="secondary" isIconOnly className="transition-all duration-200 hover:w-24 overflow-hidden group">
              <StarFill className='size-5 text-[#E3B341]'/>
              <span className="ml-1 hidden group-hover:block transition-opacity duration-200 whitespace-nowrap">{t('dashboard.sponsor.star')}</span>
            </Button>
            <Button variant="secondary" isIconOnly className="transition-all duration-200 hover:w-24 overflow-hidden group">
              <Heart className='size-5 text-[#FF4BBE]'/>
              <span className="ml-1 hidden group-hover:block transition-opacity duration-200 whitespace-nowrap">{t('dashboard.sponsor.upgrade')}</span>
            </Button>
          </Card.Footer>
        </Card>
        <StatsCards
          stats={stats}
          compact
          className="min-w-0 lg:col-span-2"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SystemDistributionChart agents={agents} />
        <TopologyGraph agents={agents} />
      </div>

      {agentIds.length > 0 && (
        <TrafficChart
          trafficData={trafficData}
          agentIds={agentIds}
          agentHosts={agentHosts}
          range={range}
          onRangeChange={setRange}
        />
      )}
    </div>
  );
}
