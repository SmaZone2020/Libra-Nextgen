'use client';

import { useTranslation } from 'react-i18next';
import { KPI } from '../../components/kpi';

interface StatsCardsProps {
  stats: { agents: number; online: number; tasks: number; pending: number };
  compact?: boolean;
  /** On <sm only agent/online cards are shown, side by side in one row. */
  minimalOnMobile?: boolean;
  className?: string;
}

export function StatsCards({ stats, compact = false, minimalOnMobile = false, className }: StatsCardsProps) {
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
        minimalOnMobile && compact
          ? `grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-2${className ? ` ${className}` : ''}`
          : compact
            ? `grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2${className ? ` ${className}` : ''}`
            : `grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4${className ? ` ${className}` : ''}`
      }
    >
      {cards.map((c, i) => (
        <KPI
          key={c.title}
          className={`min-w-0 ${minimalOnMobile && i >= 2 ? 'hidden sm:block' : ''}`}
        >
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
