import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@heroui/react';
import { ListView } from '../../components/list-view';
import { AttackChart } from './AttackChart';
import type { StressAgentStatus, StressTestCampaign } from '../../types/models';

interface ChartPoint {
  ts: number;
  mbps: number;
}

interface Props {
  campaign: StressTestCampaign | null;
  agentStatuses: StressAgentStatus[];
  chartHistory: ChartPoint[];
}

function formatMbps(mbps: number): string {
  if (mbps >= 1000) return (mbps / 1000).toFixed(2) + ' Gbps';
  return mbps.toFixed(1) + ' Mbps';
}

function calcElapsed(campaign: StressTestCampaign | null): number {
  if (!campaign) return 0;
  return Math.floor((Date.now() - new Date(campaign.createdAt).getTime()) / 1000);
}

export function StatusPanel({ campaign, agentStatuses, chartHistory }: Props) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(() => calcElapsed(campaign));

  // Tick elapsed timer every 1s for real-time display
  useEffect(() => {
    if (!campaign) { setElapsed(0); return; }
    const timer = setInterval(() => setElapsed(calcElapsed(campaign)), 1000);
    return () => clearInterval(timer);
  }, [campaign]);

  const totals = useMemo(() => {
    const acc = agentStatuses.reduce(
      (a, s) => ({
        packets: a.packets + s.packetsSent,
        bytes: a.bytes + s.bytesSent,
        conns: a.conns + s.connectionsOpen,
        mbps: a.mbps + s.mbps,
      }),
      { packets: 0, bytes: 0, conns: 0, mbps: 0 }
    );
    return acc;
  }, [agentStatuses]);

  return (
    <div className="space-y-4">
      {/* Overview stats */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">
          {t('stressTest.status.title')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatBox
            label={t('stressTest.status.elapsed')}
            value={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
          />
          <StatBox label={t('stressTest.status.totalTraffic')} value={formatMbps(totals.mbps)} />
          <StatBox label={t('stressTest.status.totalPackets')} value={totals.packets.toLocaleString()} />
          <StatBox label={t('stressTest.status.connections')} value={totals.conns.toLocaleString()} />
        </div>
      </Card>

      {/* Agent status list */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">
          {t('stressTest.selectAgents')} ({agentStatuses.length})
        </h3>
        {agentStatuses.length > 0 ? (
          <ListView
            aria-label={t('stressTest.selectAgents')}
            items={agentStatuses}
            selectionMode="none"
            variant="primary"
          >
            {(s: StressAgentStatus) => (
              <ListView.Item id={s.agentId} textValue={s.hostname}>
                <ListView.ItemContent>
                  <ListView.Title>{s.hostname}</ListView.Title>
                  <ListView.Description>
                    {formatMbps(s.mbps)} · {s.packetsSent.toLocaleString()} pkt
                  </ListView.Description>
                </ListView.ItemContent>
              </ListView.Item>
            )}
          </ListView>
        ) : (
          <p className="text-xs text-neutral-400 py-4 text-center">
            {campaign ? t('stressTest.status.waiting') : t('stressTest.status.idle')}
          </p>
        )}
      </Card>

      {/* Live throughput chart */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">
          {t('stressTest.chart')}
        </h3>
        <div className="h-48">
          <AttackChart agentStatuses={agentStatuses} history={chartHistory} />
        </div>
      </Card>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-sm font-semibold text-neutral-800 mt-0.5">{value}</div>
    </div>
  );
}
