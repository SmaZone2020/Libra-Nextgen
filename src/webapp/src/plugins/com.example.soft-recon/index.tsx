import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Input, Label, Spinner, TextField } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';
import type { PluginOutput } from '../../hooks/usePluginHost';

/**
 * Example plugin page: "某软件信息探测" (soft Recon).
 *
 * Demonstrates the plugin shell contract:
 *  - usePluginHost() reuses the console's selected agent (shared state).
 *  - dispatchTask() invokes the backend plugin action gateway → agent module.
 *  - subscribeOutput() streams live results pushed back over the console WS.
 */
export default function SoftReconPage() {
  const { t } = useTranslation();
  const { selectedAgent, dispatchTask, subscribeOutput } = usePluginHost();
  const [target, setTarget] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [stream, setStream] = useState<PluginOutput[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runProbe = async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setStream([]);

    // Live updates (agent may push plugin.result over WS as well).
    const unsub = subscribeOutput((out) => {
      setStream((prev) => [...prev, out]);
    }, 'probe');

    try {
      const res = await dispatchTask('com.example.soft-recon', 'probe', { target });
      setResult(res.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Probe failed');
    } finally {
      unsub();
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="text-lg font-semibold">{t('softRecon.title')}</h2>
        <p className="text-sm text-default-500">
          {selectedAgent
            ? t('softRecon.targetHint', { agent: selectedAgent.hostname })
            : t('softRecon.noAgent')}
        </p>

        <div className="mt-4 space-y-3">
          <TextField variant="secondary">
            <Label>{t('softRecon.target')}</Label>
            <Input
              value={target}
              onChange={(e) => setTarget((e.target as HTMLInputElement).value)}
              placeholder="UIN / 账号 / 目标标识"
            />
          </TextField>

          <Button
            variant="primary"
            isPending={running}
            isDisabled={!selectedAgent}
            onPress={runProbe}
          >
            {t('softRecon.probe')}
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border border-danger">
          <p className="text-danger text-sm">{error}</p>
        </Card>
      )}

      {stream.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">Live stream</h3>
          <div className="space-y-1 max-h-64 overflow-auto">
            {stream.map((s, i) => (
              <div key={i} className="text-xs font-mono">
                <Chip size="sm" variant="secondary">{s.action}</Chip>{' '}
                <span className="text-default-600">{JSON.stringify(s.data)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {result !== null && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">{t('softRecon.result')}</h3>
          <pre className="text-xs font-mono overflow-auto max-h-96 bg-default-50 dark:bg-default-900 p-3 rounded">
            {JSON.stringify(result, null, 2)}
          </pre>
        </Card>
      )}

      {running && (
        <div className="flex items-center gap-2 text-default-500">
          <Spinner size="sm" /> {t('softRecon.running')}
        </div>
      )}
    </div>
  );
}
