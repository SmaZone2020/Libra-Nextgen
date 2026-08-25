import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { Card } from '@heroui/react';
import type { AgentListItem } from '../../types/models';

/**
 * Session Graph 拓扑（ECharts force graph），Card 包裹。
 * 节点颜色语义：绿=在线 / 灰=离线；pivot 边在 Phase 6 引入后添加
 * （紫=pivot 链路），当前为平级节点。
 */
export function TopologyGraph({ agents }: { agents: AgentListItem[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || agents.length === 0) return;
    const chart = echarts.init(ref.current);

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(17,24,39,0.92)',
        borderColor: 'rgba(75,85,99,0.5)',
        textStyle: { color: '#e5e7eb' },
        formatter: (p: unknown) => {
          const d = (p as { data: Record<string, unknown> }).data;
          const status = d.status === 'Online' ? '在线' : '离线';
          const region = (d.region as string) || '—';
          return [
            `<b>${d.name ?? 'unknown'}</b>`,
            `IP：${d.ip ?? '—'}`,
            `系统：${d.os ?? '—'}`,
            `地域：${region}`,
            `状态：${status}`,
          ].join('<br/>');
        },
      },
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        data: agents.map((a) => ({
          id: a.id,
          name: a.hostname,
          ip: a.ipAddress,
          os: a.osVersion,
          region: a.geo?.region,
          status: a.status,
          symbolSize: a.status === 'Online' ? 46 : 34,
          itemStyle: {
            color: a.status === 'Online' ? '#10b981' : '#6b7280',
            shadowBlur: 14,
            shadowColor: a.status === 'Online' ? 'rgba(16,185,129,0.5)' : 'rgba(107,114,128,0.25)',
            borderColor: '#1f2937',
            borderWidth: 2,
          },
        })),
        edges: [],
        force: { repulsion: 320, edgeLength: 120, gravity: 0.06 },
        label: { show: true, position: 'bottom', fontSize: 11, color: '#9ca3af' },
        emphasis: { focus: 'adjacency' },
      }],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [agents]);

  const online = agents.filter((a) => a.status === 'Online').length;

  return (
    <Card>
      <Card.Header className="flex items-center justify-between">
        <Card.Title>会话拓扑</Card.Title>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            在线 {online}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-neutral-500 inline-block" />
            离线 {agents.length - online}
          </span>
        </div>
      </Card.Header>
      <Card.Content className="pt-0">
        {agents.length === 0 ? (
          <div className="flex items-center justify-center h-[440px] text-neutral-500">
            暂无 Agent
          </div>
        ) : (
          <div ref={ref} className="w-full h-[440px]" />
        )}
      </Card.Content>
    </Card>
  );
}
