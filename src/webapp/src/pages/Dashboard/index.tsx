import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getAgents, getAgentTraffic } from '../../api/agents';
import { getTasks } from '../../api/tasks';
import { StatsCards } from './StatsCards';
import { TrafficChart, RANGES } from './TrafficChart';
import { GeoMap } from './GeoMap';
import type { TimeRange } from './TrafficChart';
import type { AgentListItem, AgentStatus } from '../../types/models';

export default function Dashboard() {
  const [stats, setStats] = useState({ agents: 0, online: 0, tasks: 0, pending: 0 });
  const [trafficData, setTrafficData] = useState<Record<string, number | string>[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [agentHosts, setAgentHosts] = useState<Record<string, string>>({});
  const [range, setRange] = useState<TimeRange>('today');
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const agentMap = useRef<Map<string, AgentListItem>>(new Map());

  const mergeAgents = useCallback((incoming: AgentListItem[]) => {
    const current = agentMap.current;
    const incomingIds = new Set(incoming.map(a => a.id));

    for (const a of incoming) {
      current.set(a.id, a);
    }

    for (const [id, a] of current) {
      if (!incomingIds.has(id) && a.status === 'Online') {
        current.set(id, { ...a, status: 'Offline' as AgentStatus });
      }
    }

    return Array.from(current.values());
  }, []);

  const rangeCfg = useMemo(() => RANGES.find(r => r.key === range)!, [range]);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const [agentRes, taskRes, trafficRes] = await Promise.all([
          getAgents(1, 50),
          getTasks(undefined, undefined, 1, 50),
          getAgentTraffic(rangeCfg.minutes),
        ]);

        if (cancelled) return;

        mergeAgents(agentRes.agents);
        const allAgents = Array.from(agentMap.current.values());
        setAgents(allAgents);
        setStats({
          agents: agentRes.total,
          online: agentRes.online,
          tasks: taskRes.total,
          pending: taskRes.tasks?.filter((t: { status: string }) => t.status === 'Pending').length ?? 0,
        });

        const records = trafficRes.traffic ?? [];
        const hosts: Record<string, string> = {};
        for (const r of records) {
          if (r.hostname) hosts[r.agentId] = r.hostname;
        }
        setAgentHosts(hosts);

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

        const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
        const chartData: Record<string, number | string>[] = sortedKeys.map(key => ({
          time: fmt(new Date(key)),
          ...(buckets.get(key) ?? {}),
        }));
        setTrafficData(chartData);

        const ids = [...new Set(records.map(r => r.agentId))];
        setAgentIds(ids);
      } catch { /* ignore */ }
    }

    tick();
    const timer = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [mergeAgents, rangeCfg]);

  return (
    <div className="space-y-6">
      <StatsCards stats={stats} />

      <GeoMap agents={agents} />

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
