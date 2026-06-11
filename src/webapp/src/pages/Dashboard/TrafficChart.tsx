import { useTranslation } from 'react-i18next';
import { Button, Card } from '@heroui/react';
import { ComposedChart } from '../../components/composed-chart';
import { ChartTooltip } from '../../components/chart-tooltip';

const AGENT_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
];

function formatBytes(bytes: number, t: (key: string) => string): string {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + ' ' + t('common.byteUnits.GB');
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + ' ' + t('common.byteUnits.MB');
  if (bytes >= 1_024) return (bytes / 1_024).toFixed(1) + ' ' + t('common.byteUnits.KB');
  return bytes + ' ' + t('common.byteUnits.B');
}

export type TimeRange = '14d' | '7d' | '3d' | 'today' | '12h';

export const RANGES: { key: TimeRange; i18nKey: string; minutes: number; bucketMs: number; xfmt: (d: Date) => string }[] = [
  { key: '14d',   i18nKey: 'dashboard.ranges.14d',   minutes: 20160, bucketMs: 120960000, xfmt: (d) => `${d.getMonth() + 1}/${d.getDate()}` },
  { key: '7d',    i18nKey: 'dashboard.ranges.7d',    minutes: 10080, bucketMs: 60480000,  xfmt: (d) => `${d.getMonth() + 1}/${d.getDate()}` },
  { key: '3d',    i18nKey: 'dashboard.ranges.3d',    minutes: 4320,  bucketMs: 25920000,  xfmt: (d) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00` },
  { key: 'today', i18nKey: 'dashboard.ranges.today', minutes: 1440,  bucketMs: 8640000,   xfmt: (d) => `${String(d.getHours()).padStart(2, '0')}:00` },
  { key: '12h',   i18nKey: 'dashboard.ranges.12h',   minutes: 720,   bucketMs: 4320000,   xfmt: (d) => `${String(d.getHours()).padStart(2, '0')}:00` },
];

interface TrafficChartProps {
  trafficData: Record<string, number | string>[];
  agentIds: string[];
  agentHosts: Record<string, string>;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
}

export function TrafficChart({ trafficData, agentIds, agentHosts, range, onRangeChange }: TrafficChartProps) {
  const { t } = useTranslation();
  return (
    <Card className="w-full rounded-2xl">
      <Card.Header>
        <Card.Title className="text-base">{t('dashboard.traffic')}</Card.Title>
        <div className="flex items-center gap-3">
          {agentIds.map((id, i) => (
            <div className="flex items-center gap-1.5" key={id}>
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: AGENT_COLORS[i % AGENT_COLORS.length] }}
              />
              <span className="text-muted text-xs">{agentHosts[id] ?? id.slice(0, 8)}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            {RANGES.map(r => (
              <Button
                key={r.key}
                size="sm"
                variant={range === r.key ? 'primary' : 'ghost'}
                onPress={() => onRangeChange(r.key)}
              >
                {t(r.i18nKey)}
              </Button>
            ))}
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <ComposedChart data={trafficData} height={300}>
          <ComposedChart.Grid vertical={false} />
          <ComposedChart.XAxis dataKey="time" tickMargin={8} />
          <ComposedChart.YAxis
            tickFormatter={(v: number) => formatBytes(v, t)}
            width={60}
          />
          {agentIds.map((id, i) => (
            <ComposedChart.Line
              key={id}
              dataKey={id}
              dot={false}
              name={agentHosts[id] ?? id.slice(0, 8)}
              stroke={AGENT_COLORS[i % AGENT_COLORS.length]}
              strokeWidth={2}
              type="monotone"
              connectNulls
            />
          ))}
          <ComposedChart.Tooltip
            content={({ active, label, payload }) => {
              if (!active || !payload?.length) return null;

              return (
                <ChartTooltip>
                  <ChartTooltip.Header>{label}</ChartTooltip.Header>
                  {payload.map((entry) => (
                    <ChartTooltip.Item key={String(entry.dataKey)}>
                      <ChartTooltip.Indicator
                        color={entry.color ?? entry.fill ?? entry.stroke}
                      />
                      <ChartTooltip.Label>{entry.name}</ChartTooltip.Label>
                      <ChartTooltip.Value>
                        {formatBytes(Number(entry.value), t)}
                      </ChartTooltip.Value>
                    </ChartTooltip.Item>
                  ))}
                </ChartTooltip>
              );
            }}
          />
        </ComposedChart>
      </Card.Content>
    </Card>
  );
}
