import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@heroui/react';
import { AgentSelector } from './AgentSelector';
import { ConfigForm, type FormData } from './ConfigForm';
import { StatusPanel } from './StatusPanel';
import { consoleWs } from '../../ws/consoleWs';
import { startStressTest, stopStressTest, getStressStatus } from '../../api/stressTest';
import type { StressTestCampaign, StressAgentStatus } from '../../types/models';

interface ChartPoint {
  ts: number;
  mbps: number;
}

type LogLevel = 'info' | 'success' | 'error';

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: number;
}

const LEVEL_STYLES: Record<LogLevel, string> = {
  info: 'text-neutral-700',
  success: 'text-emerald-600',
  error: 'text-red-600',
};

export default function StressTestPage() {
  const { t } = useTranslation();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [campaign, setCampaign] = useState<StressTestCampaign | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<StressAgentStatus[]>([]);
  const [chartHistory, setChartHistory] = useState<ChartPoint[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [attacking, setAttacking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(null);
  const historyRef = useRef<ChartPoint[]>([]);

  const addLog = useCallback((msg: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-100), { level, msg, ts: Date.now() }]);
  }, []);

  // Listen for WebSocket stress updates
  useEffect(() => {
    const unsub = consoleWs.on('stress.update', (msg: { channel: string; data: any }) => {
      try {
        const status = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
        if (status) {
          setAgentStatuses(prev => {
            const idx = prev.findIndex(s => s.agentId === status.agentId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = status;
              return next;
            }
            return [...prev, status];
          });

          // Add to chart history
          const totalMbps = (status.mbps || 0);
          const point = { ts: Date.now(), mbps: totalMbps };
          historyRef.current = [...historyRef.current.slice(-120), point];
          setChartHistory(historyRef.current);
        }
      } catch { /* ignore malformed messages */ }
    });

    return () => { unsub(); };
  }, []);

  // Poll campaign status every 5s when attacking
  useEffect(() => {
    if (campaign?.id && attacking) {
      pollRef.current = setInterval(async () => {
        try {
          const data = await getStressStatus(campaign.id);
          setCampaign(data.campaign);
          setAgentStatuses(data.agentStatuses);
        } catch { /* polling may fail transiently */ }
      }, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [campaign?.id, attacking]);

  const handleStart = useCallback(async (form: FormData) => {
    if (selectedIds.length === 0) return;

    setAttacking(true);
    setChartHistory([]);
    historyRef.current = [];
    addLog(`Starting attack: ${form.methods.join(', ')} → ${form.targetHost}:${form.targetPort}`);

    try {
      const result = await startStressTest({
        name: form.name,
        targetHost: form.targetHost,
        targetPort: form.targetPort,
        methods: form.methods,
        agentIds: selectedIds,
        durationSeconds: form.durationSeconds,
        continueAfterClose: form.continueAfterClose,
        threadsPerAgent: form.threadsPerAgent,
        packetSize: form.packetSize,
      });

      addLog(`Campaign created: ${result.campaignId}`, 'success');
      addLog(`Dispatched to ${selectedIds.length} agents`, 'success');

      // Fetch initial campaign state
      const detail = await getStressStatus(result.campaignId);
      setCampaign(detail.campaign);
    } catch (err: any) {
      addLog(`Error: ${err.message}`, 'error');
      setAttacking(false);
    }
  }, [selectedIds, addLog]);

  const handleStop = useCallback(async () => {
    if (!campaign?.id) return;

    addLog('Stopping attack...');
    try {
      await stopStressTest(campaign.id);
      setAttacking(false);
      addLog('Attack stopped.', 'success');
    } catch (err: any) {
      addLog(`Stop error: ${err.message}`, 'error');
    }

    // Final status fetch
    try {
      const detail = await getStressStatus(campaign.id);
      setCampaign(detail.campaign);
      setAgentStatuses(detail.agentStatuses);
    } catch { }
  }, [campaign?.id, addLog]);

  return (
    <div className="flex gap-4 h-[calc(100vh-160px)]">
      {/* Left: Agent Selector */}
      <AgentSelector
        selectedIds={selectedIds}
        onChange={setSelectedIds}
      />

      {/* Middle: Config + Console Log */}
      <div className="w-[50%] shrink-0 flex flex-col gap-4 min-w-0">
        <ConfigForm
          disabled={attacking}
          onStart={handleStart}
          onStop={handleStop}
        />

        <Card className="flex-1 p-4 min-h-0 overflow-y-auto">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">
            {t('stressTest.log')}
          </h3>
          <div className="text-sm font-mono rounded-lg p-3 space-y-0.5">
            {logs.length === 0 ? (
              <span className="text-neutral-400">{t('stressTest.logPlaceholder')}</span>
            ) : (
              logs.map((entry, i) => (
                <div key={i}>
                  <span className="text-neutral-400 select-none">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </span>{' '}
                  <span className={LEVEL_STYLES[entry.level]}>{entry.msg}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Right: Status Panel + Chart */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <StatusPanel
          campaign={campaign}
          agentStatuses={agentStatuses}
          chartHistory={chartHistory}
        />
      </div>
    </div>
  );
}
