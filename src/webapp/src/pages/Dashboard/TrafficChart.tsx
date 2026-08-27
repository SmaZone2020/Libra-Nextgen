import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Tabs } from '@heroui/react';
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
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // 当前区间内每个 agent 的总流量（用于过滤 0 流量设备）
  const agentTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const point of trafficData) {
      for (const id of agentIds) {
        const v = Number(point[id] ?? 0);
        if (v > 0) totals[id] = (totals[id] ?? 0) + v;
      }
    }
    return totals;
  }, [trafficData, agentIds]);

  // 区间内流量为 0 的设备：底部图例不显示（Hover Tooltip 同样不出现）
  const visibleAgentIds = useMemo(
    () => agentIds.filter(id => (agentTotals[id] ?? 0) > 0),
    [agentIds, agentTotals],
  );

  const toggleAgent = useCallback((id: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <Card className="w-full rounded-2xl">
      <Card.Header>
        <Card.Title className="text-base">{t('dashboard.traffic')}</Card.Title>
      </Card.Header>
      {/* Tabs 与图表横向排列：左侧竖排时间范围 Tabs，右侧图表 */}
      <Card.Content className="flex flex-row items-stretch gap-4">
        <Tabs
          selectedKey={range}
          orientation="vertical"
          className="shrink-0"
          onSelectionChange={(key) => onRangeChange(key as TimeRange)}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label={t('dashboard.trafficRange')}>
              {RANGES.map((r) => (
                <Tabs.Tab key={r.key} id={r.key}>
                  {t(r.i18nKey)}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
        <div className="flex min-w-0 flex-1 flex-col">
          <ComposedChart data={trafficData} height={300}>
            <ComposedChart.Grid vertical={false} />
            <ComposedChart.XAxis dataKey="time" tickMargin={8} />
            <ComposedChart.YAxis
              tickFormatter={(v: number) => formatBytes(v, t)}
              width={60}
            />
            {visibleAgentIds.map((id, i) => (
              <ComposedChart.Line
                key={id}
                dataKey={id}
                dot={false}
                hide={hidden.has(id)}
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

                // Hover 时只显示该时间点流量 > 0 的设备
                const nonzero = payload.filter((p) => Number(p.value) > 0);
                if (!nonzero.length) return null;

                return (
                  <ChartTooltip>
                    <ChartTooltip.Header>{label}</ChartTooltip.Header>
                    {nonzero.map((entry) => (
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

          {/* Agent legend below chart：区间内流量为 0 的设备不显示 */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            {visibleAgentIds.map((id, i) => {
              const active = !hidden.has(id);
              return (
                <Button
                  key={id}
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 px-1.5 text-xs ${active ? 'opacity-100' : 'opacity-30'}`}
                  onPress={() => toggleAgent(id)}
                >
                  <span
                    className="size-3 rounded-full shrink-0"
                    style={{ backgroundColor: AGENT_COLORS[i % AGENT_COLORS.length] }}
                  />
                  <span className={active ? 'text-neutral-600' : 'text-neutral-400 line-through'}>
                    {agentHosts[id] ?? id.slice(0, 8)}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}
