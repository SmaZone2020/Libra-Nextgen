import { Button } from '@heroui/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Widget } from '../../components/widget';

const AGENT_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
];

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + ' GB';
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + ' MB';
  if (bytes >= 1_024) return (bytes / 1_024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function getByteUnit(maxBytes: number): string {
  if (maxBytes >= 1_073_741_824) return 'GB';
  if (maxBytes >= 1_048_576) return 'MB';
  if (maxBytes >= 1_024) return 'KB';
  return 'B';
}

export type TimeRange = '14d' | '7d' | '3d' | 'today' | '12h';

export const RANGES: { key: TimeRange; label: string; minutes: number; bucketMs: number; xfmt: (d: Date) => string }[] = [
  { key: '14d',   label: '14d',   minutes: 20160, bucketMs: 2 * 86400000, xfmt: (d) => `${d.getMonth() + 1}/${d.getDate()}` },
  { key: '7d',    label: '7d',    minutes: 10080, bucketMs: 1 * 86400000, xfmt: (d) => `${d.getMonth() + 1}/${d.getDate()}` },
  { key: '3d',    label: '3d',    minutes: 4320,  bucketMs: 8 * 3600000,  xfmt: (d) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00` },
  { key: 'today', label: 'Today', minutes: 1440,  bucketMs: 4 * 3600000,  xfmt: (d) => `${String(d.getHours()).padStart(2, '0')}:00` },
  { key: '12h',   label: '12h',   minutes: 720,   bucketMs: 2 * 3600000,  xfmt: (d) => `${String(d.getHours()).padStart(2, '0')}:00` },
];

interface TrafficChartProps {
  trafficData: Record<string, number | string>[];
  agentIds: string[];
  agentHosts: Record<string, string>;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export function TrafficChart({ trafficData, agentIds, agentHosts, range, onRangeChange }: TrafficChartProps) {
  const maxBytes = trafficData.reduce((max, d) => {
    for (const id of agentIds) {
      const v = (d as Record<string, number>)[id];
      if (v && v > max) max = v;
    }
    return max;
  }, 0);

  const unit = getByteUnit(maxBytes);

  return (
    <Widget>
      <Widget.Header>
        <Widget.Title>Traffic</Widget.Title>
        <div className="flex items-center gap-1">
          {RANGES.map(r => (
            <Button
              key={r.key}
              size="sm"
              variant={range === r.key ? 'primary' : 'ghost'}
              onPress={() => onRangeChange(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </Widget.Header>
      <Widget.Content>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trafficData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" fontSize={12} />
            <YAxis
              fontSize={12}
              tickFormatter={(v: number) => v + ' ' + unit}
            />
            <Tooltip
              formatter={(value: number) => [formatBytes(value), '']}
              labelFormatter={(label) => 'Time: ' + label}
            />
            <Legend />
            {agentIds.map((id, i) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                name={agentHosts[id] ?? id.slice(0, 8)}
                stroke={AGENT_COLORS[i % AGENT_COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Widget.Content>
    </Widget>
  );
}
