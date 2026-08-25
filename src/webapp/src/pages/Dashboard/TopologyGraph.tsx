import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { Card } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import type { AgentListItem } from '../../types/models';

// @gravity-ui/icons logo-windows / logo-linux / logo-macos 的 SVG path（16x16 viewBox）
const PATH_WINDOWS =
  'm11.788 2.974-3.038.434V7.25h4.75V4.459a1.5 1.5 0 0 0-1.712-1.485M13.5 8.75H8.75v3.842l3.038.434A1.5 1.5 0 0 0 13.5 11.54zm-6.25-1.5V3.622l-3.462.495A1.5 1.5 0 0 0 2.5 5.602V7.25zM2.5 8.75h4.75v3.628l-3.462-.495A1.5 1.5 0 0 1 2.5 10.398zm1.076-6.118A3 3 0 0 0 1 5.602v4.796a3 3 0 0 0 2.576 2.97l8 1.143A3 3 0 0 0 15 11.54V4.459a3 3 0 0 0-3.424-2.97z';
const PATH_LINUX =
  'M6.854 3.47a2.7 2.7 0 0 1 1.934.102l.618.275q.108.048.205.11.004-.188.023-.377l.05-.495a1.441 1.441 0 1 0-2.868 0zm3.243 2.725a1.6 1.6 0 0 1-.423.433L7.95 7.835a1 1 0 0 1-1.468-.372l-.23-.46-.99 2.226a3.04 3.04 0 0 0-.217 1.758c.46.333.81.817.968 1.393l.123.451c.52.419 1.181.669 1.901.669h.54q.053 0 .105-.002l.305-1.118a2.564 2.564 0 0 1 2.98-1.829q.033-.233.033-.473c0-.714-.223-1.41-.637-1.99l-.842-1.177a5 5 0 0 1-.424-.716m3.242 5.135a4.93 4.93 0 0 0-.756-4.114l-.841-1.177a3.4 3.4 0 0 1-.615-2.31l.05-.495a2.941 2.941 0 1 0-5.854 0l.08.8a3.67 3.67 0 0 1-.298 1.854L3.891 8.62a4.5 4.5 0 0 0-.39 1.88A2.54 2.54 0 0 0 1 13.027c0 1.16.79 2.17 1.914 2.452l1.92.48a1.396 1.396 0 0 0 1.727-1.204c.463.159.96.245 1.476.245h.451a1.396 1.396 0 0 0 1.679.958l1.919-.48A2.53 2.53 0 0 0 14 13.028c0-.653-.25-1.248-.66-1.697M8.18 4.943l.617.275c.03.013.04.025.044.032q.013.016.018.053a.1.1 0 0 1-.007.056c-.004.008-.01.022-.037.04l-1.25.875-.549-1.097a.127.127 0 0 1 .048-.166 1.21 1.21 0 0 1 1.115-.068m-4.901 9.08 1.747.437-.46-1.685A1.064 1.064 0 0 0 3.542 12c-.578 0-1.041.47-1.041 1.027 0 .471.32.882.778.996m6.697.437 1.747-.437c.457-.114.778-.525.778-.996 0-.557-.463-1.027-1.04-1.027-.482 0-.903.324-1.026.775z';
const PATH_MACOS =
  'M9.063 3.5H12A1.5 1.5 0 0 1 13.5 5v6a1.5 1.5 0 0 1-1.5 1.5h-1.441l-.029-.03c-.75-.75-.78-1.425-.78-3.22A.75.75 0 0 0 9 8.5H7.753c.018-1.895.162-3.441 1.31-5m-1.777 0H4A1.5 1.5 0 0 0 2.5 5v6A1.5 1.5 0 0 0 4 12.5h4.714c-.38-.76-.45-1.574-.462-2.5H7a.75.75 0 0 1-.75-.75v-.07c0-1.89 0-3.791 1.036-5.68M1 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3zm9.25 2.25a.75.75 0 0 0 1.5 0v-1a.75.75 0 0 0-1.5 0zM4.75 8A.75.75 0 0 1 4 7.25v-1a.75.75 0 0 1 1.5 0v1a.75.75 0 0 1-.75.75';

function osSymbol(os?: string): string {
  const o = (os ?? '').toLowerCase();
  if (o.includes('windows') || o.includes('win32')) return `path://${PATH_WINDOWS}`;
  if (o.includes('darwin') || o.includes('macos') || o.includes('mac os') || o.includes('osx')) return `path://${PATH_MACOS}`;
  if (o.includes('linux') || o.includes('ubuntu') || o.includes('debian') || o.includes('centos') || o.includes('kali') || o.includes('alpine')) return `path://${PATH_LINUX}`;
  return 'circle';
}

/**
 * Session Graph 拓扑（ECharts force graph），Card 包裹。
 * 节点用 OS Logo（Windows/Linux/macOS），绿=在线 / 灰=离线；
 * pivot 边在 Phase 6 引入后添加（紫=pivot 链路）。
 */
export function TopologyGraph({ agents }: { agents: AgentListItem[] }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const prevKey = useRef<string>('');

  useEffect(() => {
    // 只比较拓扑关心的稳定字段（排除 LastSeen 等每轮心跳都在变的字段），
    // 否则 /api/agents 每次轮询都会触发重建。
    const key = JSON.stringify(agents.map((a) => ({
      id: a.id,
      hostname: a.hostname,
      status: a.status,
      ip: a.ipAddress,
      os: a.osVersion,
      region: a.geo?.region,
    })));
    if (key === prevKey.current) return;
    prevKey.current = key;

    if (!ref.current || agents.length === 0) return;
    const chart = echarts.init(ref.current);

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        borderRadius: 15,
        backgroundColor: 'rgba(75,85,99,0.5)',
        borderColor: 'rgba(75,85,99,0.5)',
        textStyle: { color: '#e5e7eb' },
        formatter: (p: unknown) => {
          const d = (p as { data: Record<string, unknown> }).data;
          const status = d.status === 'Online'
            ? t('topology.statusOnline')
            : t('topology.statusOffline');
          const region = (d.region as string) || '—';
          return [
            `<b>${d.name ?? 'unknown'}</b>`,
            `${t('topology.ip')}：${d.ip ?? '—'}`,
            `${t('topology.os')}：${d.os ?? '—'}`,
            `${t('topology.region')}：${region}`,
            `${t('topology.status')}：${status}`,
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
          symbol: osSymbol(a.osVersion),
          symbolSize: a.status === 'Online' ? 30 : 22,
          itemStyle: {
            color: a.status === 'Online' ? '#10b981' : '#6b7280',
            shadowBlur: 12,
            shadowColor: a.status === 'Online' ? 'rgba(16,185,129,0.45)' : 'rgba(107,114,128,0.2)',
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
  }, [agents, t]);

  const online = agents.filter((a) => a.status === 'Online').length;

  return (
    <Card>
      <Card.Header className="flex items-center justify-between">
        <Card.Title>{t('nav.topology.title')}</Card.Title>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            {t('topology.online')} {online}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-neutral-500 inline-block" />
            {t('topology.offline')} {agents.length - online}
          </span>
        </div>
      </Card.Header>
      <Card.Content className="pt-0">
        {agents.length === 0 ? (
          <div className="flex items-center justify-center h-[440px] text-neutral-500">
            {t('topology.noAgents')}
          </div>
        ) : (
          <div ref={ref} className="w-full h-[440px]" />
        )}
      </Card.Content>
    </Card>
  );
}
