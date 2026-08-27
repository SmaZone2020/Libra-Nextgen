import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAgentTraffic } from '../../api/agents';
import { getTasks } from '../../api/tasks';
import { StatsCards } from './StatsCards';
import { TrafficChart, RANGES } from './TrafficChart';
import { SystemDistributionChart } from './SystemDistributionChart';
import { TopologyGraph } from './TopologyGraph';
import { useAgent } from '../../contexts/AgentContext';
import type { TimeRange } from './TrafficChart';

export default function Dashboard() {
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
      <StatsCards stats={stats} />

      {/* 系统分布（饼图）与拓扑图共享一行：左=系统分布，右=拓扑图 */}
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
