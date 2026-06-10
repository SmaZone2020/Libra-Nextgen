import { KPI } from '../../components/kpi';

interface StatsCardsProps {
  stats: { agents: number; online: number; tasks: number; pending: number };
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    { title: 'Total Agents', value: stats.agents, trend: 'up' as const },
    { title: 'Online', value: stats.online, trend: 'up' as const },
    { title: 'Total Tasks', value: stats.tasks, trend: 'neutral' as const },
    { title: 'Pending', value: stats.pending, trend: 'neutral' as const },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <KPI key={c.title}>
          <KPI.Header>
            <KPI.Title>{c.title}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value value={c.value} />
            <KPI.Trend trend={c.trend}>{c.trend === 'up' ? 'Active' : 'Steady'}</KPI.Trend>
          </KPI.Content>
        </KPI>
      ))}
    </div>
  );
}
