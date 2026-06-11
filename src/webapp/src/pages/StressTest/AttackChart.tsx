import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { StressAgentStatus } from '../../types/models';

echarts.use([LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

interface Props {
  agentStatuses: StressAgentStatus[];
  history: { ts: number; mbps: number }[];
}

export function AttackChart({ agentStatuses, history }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current);
    }

    const totalMbps = agentStatuses.reduce((sum, s) => sum + s.mbps, 0);
    const now = Date.now();
    const seriesData = history.map((p, i) => [p.ts, p.mbps]);

    instanceRef.current.setOption({
      tooltip: { trigger: 'axis' },
      grid: { top: 8, right: 16, bottom: 24, left: 48 },
      xAxis: {
        type: 'time',
        axisLabel: { fontSize: 10, color: '#737373' },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Mbps',
        axisLabel: { fontSize: 10, color: '#737373' },
        splitLine: { lineStyle: { color: '#e5e5e5' } },
      },
      series: [
        {
          name: 'Total Mbps',
          type: 'line',
          data: seriesData,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#6366f1', width: 2 },
          areaStyle: { color: 'rgba(99, 102, 241, 0.08)' },
        },
      ],
    }, true);
  }, [agentStatuses, history]);

  return <div ref={chartRef} className="w-full h-48" />;
}
