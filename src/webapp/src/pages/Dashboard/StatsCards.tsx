'use client';

import { useTranslation } from 'react-i18next';
import { KPI } from '../../components/kpi';

interface StatsCardsProps {
  stats: { agents: number; online: number; tasks: number; pending: number };
  /**
   * 与赞助卡片并排时使用 2x2 紧凑布局；
   * 未开启时保持原 4 列布局。
   */
  compact?: boolean;
  className?: string;
}

export function StatsCards({ stats, compact = false, className }: StatsCardsProps) {
  const { t } = useTranslation();
  const cards = [
    { title: t('dashboard.totalAgents'), value: stats.agents, trend: 'up' as const },
    { title: t('dashboard.online'), value: stats.online, trend: 'up' as const },
    { title: t('dashboard.totalTasks'), value: stats.tasks, trend: 'neutral' as const },
    { title: t('dashboard.pending'), value: stats.pending, trend: 'neutral' as const },
  ];

  return (
    <div
      className={
        compact
          ? `grid grid-cols-1 gap-3 sm:grid-cols-2${className ? ` ${className}` : ''}`
          : `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4${className ? ` ${className}` : ''}`
      }
    >
      {cards.map((c) => (
        <KPI key={c.title}>
          <KPI.Header>
            <KPI.Title>{c.title}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value value={c.value} />
            <KPI.Trend trend={c.trend}>{c.trend === 'up' ? t('dashboard.active') : t('dashboard.steady')}</KPI.Trend>
          </KPI.Content>
        </KPI>
      ))}
    </div>
  );
}
