import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@heroui/react';
import { PieChart } from '../../components/pie-chart';
import { ChartTooltip } from '../../components/chart-tooltip';
import type { AgentListItem } from '../../types/models';

// ── OS 分类（正则匹配）───────────────────────────────────────────────

/** Linux 发行版匹配表（按优先级排序，命中即归类）。 */
const LINUX_DISTROS: [string, RegExp][] = [
  ['Ubuntu', /\bubuntu\b/i],
  ['Debian', /\bdebian\b/i],
  ['Kali', /\bkali\b/i],
  ['CentOS', /\bcentos\b/i],
  ['Fedora', /\bfedora\b/i],
  ['Rocky Linux', /\brocky\b/i],
  ['AlmaLinux', /\balma(?:linux)?\b/i],
  ['Arch', /\barch\s*linux\b|\barchlinux\b/i],
  ['Linux Mint', /\blinux\s*mint\b|\bmint\b/i],
  ['openSUSE', /\bopensuse|\bsuse\b/i],
  ['RHEL', /\bred\s*hat|\brhel\b/i],
  ['Alpine', /\balpine\b/i],
  ['Manjaro', /\bmanjaro\b/i],
  ['Pop!_OS', /\bpop[! _]*os\b/i],
];

/**
 * 将 osVersion 归类为展示用的系统名：
 * - Windows 按大版本区分 7 / 10 / 11（agent 上报的 ProductName+DisplayVersion，
 *   Win11 的 ProductName 常为 "Windows 10 Pro"，需按版本号 10.0.22000+ 兜底）
 * - Linux 按发行版名匹配（PRETTY_NAME，如 "Ubuntu 22.04.3 LTS"）
 * - 其余归入 Windows/Linux/其他/未知
 */
export function classifyOs(osVersion: string): string {
  const v = (osVersion ?? '').toLowerCase();

  if (v.includes('windows')) {
    // Windows 11：显式 "Windows 11"，或内核版本 10.0.22000+（22H2/23H2/24H2）
    if (
      /\bwindows\s*11\b/.test(v) ||
      /\b11\s+(?:pro|home|enterprise|education|iot)\b/.test(v) ||
      /(?:\bnt\s*)?10\.0\.(?:2[2-9]\d{3}|[3-9]\d{4})/.test(v)
    ) {
      return 'Windows 11';
    }
    if (
      /\bwindows\s*10\b/.test(v) ||
      /\b10\s+(?:pro|home|enterprise|education|iot)\b/.test(v) ||
      /(?:\bnt\s*)?10\.0(?:\.(?:1\d{4}|2[01]\d{3}))?/.test(v)
    ) {
      return 'Windows 10';
    }
    if (
      /\bwindows\s*7\b/.test(v) ||
      /\b7\s+(?:pro|home|enterprise|ultimate)\b/.test(v) ||
      /(?:\bnt\s*)?6\.1\b/.test(v)
    ) {
      return 'Windows 7';
    }
    return 'Windows (其他)';
  }

  for (const [name, re] of LINUX_DISTROS) {
    if (re.test(v)) return name;
  }
  if (v.includes('linux')) return 'Linux (其他)';

  if (v.includes('darwin') || v.includes('mac os') || v.includes('macos') || v.includes('osx')) {
    return 'macOS';
  }
  if (v.includes('android')) return 'Android';
  return v ? '其他' : '未知';
}

// ── 饼图卡片 ─────────────────────────────────────────────────────────

const PIE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#14b8a6', '#a855f7', '#64748b',
];

interface SystemDistributionChartProps {
  agents: AgentListItem[];
}

/** 展示所有 Agent 的操作系统分布（饼图）。 */
export function SystemDistributionChart({ agents }: SystemDistributionChartProps) {
  const { t } = useTranslation();

  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents) {
      const key = classifyOs(agent.osVersion);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [agents]);

  const total = useMemo(() => agents.length, [agents]);

  return (
    <Card className="w-full rounded-2xl">
      <Card.Header>
        <Card.Title className="text-base">{t('dashboard.systemDistribution')}</Card.Title>
      </Card.Header>
      <Card.Content>
        {total === 0 ? (
          <p className="text-sm text-default-500 py-10 text-center">
            {t('dashboard.noAgents')}
          </p>
        ) : (
          <>
            <PieChart height={280}>
              <PieChart.Pie
                data={data}
                dataKey="count"
                nameKey="category"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                strokeWidth={1}
              >
                {data.map((d, i) => (
                  <PieChart.Cell
                    key={d.category}
                    fill={PIE_COLORS[i % PIE_COLORS.length]}
                  />
                ))}
              </PieChart.Pie>
              <PieChart.Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const entry = payload[0];
                  if (!entry) return null;
                  const count = Number(entry.value) || 0;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <ChartTooltip>
                      <ChartTooltip.Header>
                        {String(entry.name ?? '')}
                      </ChartTooltip.Header>
                      <ChartTooltip.Item>
                        <ChartTooltip.Indicator
                          color={(entry.payload as { fill?: string } | undefined)?.fill}
                        />
                        <ChartTooltip.Label>
                          {t('dashboard.systemRadarAgents')}
                        </ChartTooltip.Label>
                        <ChartTooltip.Value>
                          {count} ({pct}%)
                        </ChartTooltip.Value>
                      </ChartTooltip.Item>
                    </ChartTooltip>
                  );
                }}
              />
            </PieChart>

            {/* 分类图例：色点 + 名称 + 数量（占比） */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
              {data.map((d, i) => {
                const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
                return (
                  <span key={d.category} className="flex items-center gap-1.5 text-xs text-neutral-600">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    {d.category}
                    <span className="text-neutral-400">{d.count} ({pct}%)</span>
                  </span>
                );
              })}
            </div>
          </>
        )}
      </Card.Content>
    </Card>
  );
}
