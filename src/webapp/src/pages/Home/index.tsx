import { motion } from 'motion/react';
import { Widget } from '@components/widget';
import { KPI } from '@components/kpi';
import { LineChart } from '@components/line-chart';
import { ChartTooltip } from '@components/chart-tooltip';
import { fadeInScale, staggerContainer } from '../../shared/lib/animations';

const revenueCards = [
  { change: '+33%', title: 'Total Revenue', trend: 'up' as const, value: 228451 },
  { change: '+13.0%', title: 'Total Expenses', trend: 'down' as const, value: 71887 },
  { change: '0.0%', title: 'Total Profit', trend: 'neutral' as const, value: 156540 },
  { change: '+1.0%', title: 'New Customers', trend: 'up' as const, value: 1234 },
];

const tokensData = [
  { date: '2025-09-01', input: 35000, output: 22000 },
  { date: '2025-09-05', input: 15000, output: 5000 },
  { date: '2025-09-10', input: 40000, output: 15000 },
  { date: '2025-09-15', input: 90000, output: 40000 },
  { date: '2025-09-20', input: 70000, output: 20000 },
  { date: '2025-09-25', input: 45000, output: 18000 },
  { date: '2025-09-30', input: 28000, output: 8000 },
];

export function HomePage() {
  return (
    <motion.div
      animate="show"
      className="space-y-6"
      initial="hidden"
      variants={staggerContainer}
    >
      <motion.div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        variants={staggerContainer}
      >
        {revenueCards.map((card, i) => (
          <motion.div
            key={card.title}
            variants={{
              hidden: { opacity: 0, y: 24, scale: 0.95 },
              show: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: {
                  duration: 0.5,
                  delay: i * 0.08,
                  ease: [0.25, 0.46, 0.45, 0.94],
                },
              },
            }}
          >
            <KPI>
              <KPI.Header>
                <KPI.Title>{card.title}</KPI.Title>
              </KPI.Header>
              <KPI.Content>
                <KPI.Value
                  currency={card.title.includes('Customer') ? undefined : 'USD'}
                  maximumFractionDigits={0}
                  style={card.title.includes('Customer') ? 'decimal' : 'currency'}
                  value={card.value}
                />
                <KPI.Trend trend={card.trend}>{card.change}</KPI.Trend>
              </KPI.Content>
            </KPI>
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={fadeInScale}>
        <Widget>
          <Widget.Header>
            <Widget.Title>Tokens Over Time</Widget.Title>
            <Widget.Legend>
              <Widget.LegendItem color="var(--chart-4)">Input</Widget.LegendItem>
              <Widget.LegendItem color="var(--chart-1)">Output</Widget.LegendItem>
            </Widget.Legend>
          </Widget.Header>
          <Widget.Content>
            <LineChart data={tokensData} height={260}>
              <LineChart.Grid vertical={false} />
              <LineChart.XAxis
                dataKey="date"
                tickMargin={8}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' });
                }}
              />
              <LineChart.YAxis
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
                }
                width={40}
              />
              <LineChart.Line
                animationDuration={1200}
                dataKey="input"
                dot={false}
                name="Input"
                stroke="var(--chart-4)"
                strokeWidth={2}
                type="monotone"
              />
              <LineChart.Line
                animationDuration={1500}
                dataKey="output"
                dot={false}
                name="Output"
                stroke="var(--chart-1)"
                strokeWidth={2}
                type="monotone"
              />
              <LineChart.Tooltip
                content={({ active, label, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <ChartTooltip>
                      <ChartTooltip.Header>{label}</ChartTooltip.Header>
                      {payload.map((entry) => (
                        <ChartTooltip.Item key={String(entry.dataKey)}>
                          <ChartTooltip.Indicator color={entry.color ?? entry.stroke} />
                          <ChartTooltip.Label>{entry.name}</ChartTooltip.Label>
                          <ChartTooltip.Value>
                            {Number(entry.value).toLocaleString()}
                          </ChartTooltip.Value>
                        </ChartTooltip.Item>
                      ))}
                    </ChartTooltip>
                  );
                }}
              />
            </LineChart>
          </Widget.Content>
        </Widget>
      </motion.div>
    </motion.div>
  );
}
