import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@heroui/react';
import { AgentSelector } from './AgentSelector';
import { ConfigForm, type FormData } from './ConfigForm';
import { AttackChart } from './AttackChart';
import { StatusPanel } from './StatusPanel';
import { consoleWs } from '../../ws/consoleWs';
import { startStressTest, stopStressTest, getStressStatus } from '../../api/stressTest';
import type { StressTestCampaign, StressAgentStatus } from '../../types/models';

interface ChartPoint {
  ts: number;
  mbps: number;
}

export default function StressTestPage() {
  const { t } = useTranslation();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [campaign, setCampaign] = useState<StressTestCampaign | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<StressAgentStatus[]>([]);
  const [chartHistory, setChartHistory] = useState<ChartPoint[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [attacking, setAttacking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(null);
  const historyRef = useRef<ChartPoint[]>([]);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-100), msg]);
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

      addLog(`Campaign created: ${result.campaignId}`);
      addLog(`Dispatched to ${selectedIds.length} agents`);

      // Fetch initial campaign state
      const detail = await getStressStatus(result.campaignId);
      setCampaign(detail.campaign);
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setAttacking(false);
    }
  }, [selectedIds, addLog]);

  const handleStop = useCallback(async () => {
    if (!campaign?.id) return;

    addLog('Stopping attack...');
    try {
      await stopStressTest(campaign.id);
      setAttacking(false);
      addLog('Attack stopped.');
    } catch (err: any) {
      addLog(`Stop error: ${err.message}`);
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

      {/* Middle: Config + Chart */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <ConfigForm
          disabled={attacking}
          onStart={handleStart}
          onStop={handleStop}
        />

        <Card className="flex-1 p-4 min-h-0">
          {attacking || chartHistory.length > 0 ? (
            <AttackChart agentStatuses={agentStatuses} history={chartHistory} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-neutral-400">
              {t('stressTest.chartPlaceholder')}
            </div>
          )}
        </Card>
      </div>

      {/* Right: Status Panel */}
      <div className="w-[320px] shrink-0 overflow-y-auto">
        <StatusPanel
          campaign={campaign}
          agentStatuses={agentStatuses}
          logs={logs}
        />
      </div>
    </div>
  );
}
