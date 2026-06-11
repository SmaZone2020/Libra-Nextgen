import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { StressAgentStatus, StressTestCampaign } from '../../types/models';

interface Props {
  campaign: StressTestCampaign | null;
  agentStatuses: StressAgentStatus[];
  logs: string[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatMbps(mbps: number): string {
  if (mbps >= 1000) return (mbps / 1000).toFixed(2) + ' Gbps';
  return mbps.toFixed(1) + ' Mbps';
}

export function StatusPanel({ campaign, agentStatuses, logs }: Props) {
  const { t } = useTranslation();

  const totals = useMemo(() => {
    return agentStatuses.reduce(
      (acc, s) => ({
        packets: acc.packets + s.packetsSent,
        bytes: acc.bytes + s.bytesSent,
        conns: acc.conns + s.connectionsOpen,
        mbps: acc.mbps + s.mbps,
      }),
      { packets: 0, bytes: 0, conns: 0, mbps: 0 }
    );
  }, [agentStatuses]);

  const elapsed = campaign
    ? Math.floor((Date.now() - new Date(campaign.createdAt).getTime()) / 1000)
    : 0;

  return (
    <div className="space-y-4">
      {/* Overview stats */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('stressTest.status.title')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatBox
            label={t('stressTest.status.elapsed')}
            value={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
          />
          <StatBox label={t('stressTest.status.totalTraffic')} value={formatMbps(totals.mbps)} />
          <StatBox label={t('stressTest.status.totalPackets')} value={totals.packets.toLocaleString()} />
          <StatBox label={t('stressTest.status.connections')} value={totals.conns.toLocaleString()} />
        </div>
      </div>

      {/* Agent status list */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">
          {t('stressTest.selectAgents')} ({agentStatuses.length})
        </h3>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {agentStatuses.map(s => (
            <div key={s.agentId} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-neutral-50 border border-neutral-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate text-neutral-700">{s.hostname}</div>
                <div className="text-[10px] text-neutral-500">
                  {formatMbps(s.mbps)} · {s.packetsSent.toLocaleString()} pkt
                </div>
              </div>
            </div>
          ))}
          {agentStatuses.length === 0 && (
            <p className="text-xs text-neutral-400 py-4 text-center">
              {campaign ? t('stressTest.status.waiting') : t('stressTest.status.idle')}
            </p>
          )}
        </div>
      </div>

      {/* Console log */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">{t('stressTest.log')}</h3>
        <div className="bg-neutral-900 text-emerald-400 text-xs font-mono rounded-lg p-3 max-h-48 overflow-y-auto space-y-0.5">
          {logs.length === 0 && (
            <span className="text-neutral-500">{t('stressTest.logPlaceholder')}</span>
          )}
          {logs.map((log, i) => (
            <div key={i}>
              <span className="text-neutral-500">
                {new Date().toLocaleTimeString()}
              </span>{' '}
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2">
      <div className="text-[10px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold text-neutral-800 mt-0.5">{value}</div>
    </div>
  );
}
