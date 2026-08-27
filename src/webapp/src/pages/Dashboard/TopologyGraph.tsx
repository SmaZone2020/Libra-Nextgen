import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { Card } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import type { AgentListItem } from '../../types/models';

const LOGO_BASE = `${import.meta.env.BASE_URL}icon/`;
const LOGO_URLS: Record<string, string> = {
  windows: `${LOGO_BASE}logo-windows.svg`,
  linux: `${LOGO_BASE}logo-linux.svg`,
  macos: `${LOGO_BASE}logo-macos.svg`,
};

function osType(os?: string): string | null {
  const o = (os ?? '').toLowerCase();
  if (o.includes('windows') || o.includes('win32')) return 'windows';
  if (o.includes('darwin') || o.includes('macos') || o.includes('mac os') || o.includes('osx')) return 'macos';
  if (o.includes('linux') || o.includes('ubuntu') || o.includes('debian') || o.includes('centos') || o.includes('kali') || o.includes('alpine')) return 'linux';
  return null;
}

// 缓存：os -> SVG path（避免每次重建都 fetch）
const logoPathCache = new Map<string, Promise<string>>();

async function logoPathFromPublic(os: string): Promise<string> {
  let p = logoPathCache.get(os);
  if (!p) {
    p = (async () => {
      const resp = await fetch(LOGO_URLS[os]!);
      if (!resp.ok) throw new Error(`logo fetch failed: ${LOGO_URLS[os]}`);
      const svg = await resp.text();
      const m = svg.match(/d="([^"]+)"/);
      if (!m) throw new Error('no path in logo svg');
      return m[1]!;
    })();
    logoPathCache.set(os, p);
  }
  return p;
}

const ONLINE_COLOR = '#10b981';
const OFFLINE_COLOR = '#6b7280';

export function TopologyGraph({ agents }: { agents: AgentListItem[] }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  const stableKey = useMemo(
    () => JSON.stringify(agents.map((a) => ({
      id: a.id,
      hostname: a.hostname,
      status: a.status,
      ip: a.ipAddress,
      os: a.osVersion,
      region: a.geo?.region,
    }))),
    [agents],
  );

  useEffect(() => {
    if (!ref.current || agents.length === 0) return;
    const chart = echarts.init(ref.current);
    let disposed = false;

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        borderRadius: 15,
        backgroundColor: 'rgba(75,85,99,0.5)',
        borderColor: 'rgba(75,85,99,0.5)',
        textStyle: { color: '#e5e7eb' },
        fontSize: 18,
        formatter: (p: unknown) => {
          const d = (p as { data: Record<string, unknown> }).data;
          const status = d.status === 'Online'
            ? t('nav.topology.statusOnline')
            : t('nav.topology.statusOffline');
          const region = (d.region as string) || '—';
          return [
            `<b>${d.name ?? 'unknown'}</b>`,
            `${t('nav.topology.ip')}：${d.ip ?? '—'}`,
            `${t('nav.topology.os')}：${d.os ?? '—'}`,
            `${t('nav.topology.region')}：${region}`,
            `${t('nav.topology.status')}：${status}`,
          ].join('<br/>');
        },
      },
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        scaleLimit: { min: 0.8, max: 4.5 },
        data: [],
        edges: [],
        force: { repulsion: 320, edgeLength: 120, gravity: 0.06 },
        label: { show: true, position: 'bottom', fontSize: 11, color: '#9ca3af' },
        emphasis: { focus: 'adjacency' },
      }],
    });

    (async () => {
      const nodes = await Promise.all(agents.map(async (a) => {
        const os = osType(a.osVersion);
        let symbol: string = 'circle';
        if (os) {
          try {
            symbol = `path://${await logoPathFromPublic(os)}`;
          } catch {
            
          }
        }
        return {
          id: a.id,
          name: a.hostname,
          ip: a.ipAddress,
          os: a.osVersion,
          region: a.geo?.region,
          status: a.status,
          symbol,
          symbolSize: a.status === 'Online' ? 18 : 22,
          itemStyle: {
            color: a.status === 'Online' ? ONLINE_COLOR : OFFLINE_COLOR,
            shadowBlur: 12,
            shadowColor: a.status === 'Online'
              ? 'rgba(16,185,129,0.45)'
              : 'rgba(107,114,128,0.2)',
          },
        };
      }));
      if (disposed) return;
      chart.setOption({ series: [{ data: nodes }] });
    })();

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [stableKey, t]);

  const online = agents.filter((a) => a.status === 'Online').length;

  return (
    <Card>
      <Card.Header className="flex items-center justify-between">
        <Card.Title className="text-base">{t('nav.topology.title')}</Card.Title>
        <div className="flex items-center gap-3 text-xs text-neutral-400 mt-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            {t('nav.topology.online')} {online}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-neutral-500 inline-block" />
            {t('nav.topology.offline')} {agents.length - online}
          </span>
        </div>
      </Card.Header>
      <Card.Content className="pt-0">
        {agents.length === 0 ? (
          <div className="flex items-center justify-center h-[240px] text-neutral-500">
            {t('nav.topology.noAgents')}
          </div>
        ) : (
          <div ref={ref} className="w-full h-[240px]" />
        )}
      </Card.Content>
      <Card.Footer className="flex items-center justify-end text-xs text-neutral-400"></Card.Footer>
    </Card>
  );
}
