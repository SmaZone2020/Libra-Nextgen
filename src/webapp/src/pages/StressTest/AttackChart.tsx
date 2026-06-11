import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { StressAgentStatus } from '../../types/models';

interface Props {
  agentStatuses: StressAgentStatus[];
  history: { ts: number; mbps: number }[];
}

export function AttackChart({ agentStatuses, history }: Props) {
  const totalMbps = agentStatuses.reduce((sum, s) => sum + s.mbps, 0);

  const data = history.length > 0
    ? history.map(p => ({ time: new Date(p.ts).toLocaleTimeString(), mbps: +p.mbps.toFixed(1) }))
    : [{ time: '--:--:--', mbps: 0 }];

  return (
    <div className="w-full h-full">
      <div className="text-xs text-neutral-500 mb-1">
        Live Throughput: <span className="font-semibold text-primary-600">{totalMbps.toFixed(1)} Mbps</span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#a3a3a3" />
          <YAxis tick={{ fontSize: 10 }} stroke="#a3a3a3" width={48} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e5e5' }}
            formatter={(value: number) => [`${value.toFixed(1)} Mbps`, 'Throughput']}
          />
          <Line
            type="monotone"
            dataKey="mbps"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
