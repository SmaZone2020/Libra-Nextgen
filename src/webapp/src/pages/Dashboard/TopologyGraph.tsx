import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { AgentListItem } from '../../types/models';

/**
 * Session Graph 拓扑（ECharts force graph）。
 * 节点颜色语义：绿=在线 / 红=离线；pivot 边在 Phase 6 引入后添加
 * （紫=pivot 链路），当前为平级节点。
 */
export function TopologyGraph({ agents }: { agents: AgentListItem[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);

    chart.setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        data: agents.map((a) => ({
          id: a.id,
          name: a.hostname,
          symbolSize: 42,
          itemStyle: {
            color: a.status === 'Online' ? '#10b981' : '#ef4444',
            shadowBlur: 8,
            shadowColor: a.status === 'Online' ? 'rgba(16,185,129,0.45)' : 'rgba(239,68,68,0.35)',
          },
          tooltip: {
            formatter: `<b>${a.hostname}</b><br/>${a.ipAddress ?? '-'}<br/>${a.osVersion ?? '-'}`,
          },
        })),
        edges: [],
        force: { repulsion: 280, edgeLength: 110, gravity: 0.08 },
        label: { show: true, position: 'bottom', fontSize: 11 },
      }],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [agents]);

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-[440px] text-neutral-500">
        暂无 Agent
      </div>
    );
  }

  return <div ref={ref} className="w-full h-[440px]" />;
}
