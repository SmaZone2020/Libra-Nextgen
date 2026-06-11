import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner } from '@heroui/react';
import { createTask, getTask } from '../../api/tasks';

interface Props {
  agentId: string;
}

export function LocalAccountsTab({ agentId }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDump = useCallback(async () => {
    setLoading(true);
    setOutput(null);
    setError(null);
    try {
      const task = await createTask({ agentId, commandType: 'CredDump', command: '' });
      const taskId = task.id;

      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const t = await getTask(taskId);
          if (t.status === 'Completed') {
            setOutput(t.output || '[No output]');
            return;
          }
          if (t.status === 'Failed') {
            setError(t.error || 'Task failed');
            return;
          }
        } catch {
          /* retry */
        }
      }
      setError('Timed out waiting for agent response');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          isDisabled={loading}
          onPress={handleDump}
        >
          {loading && <Spinner className="mr-2" />}
          {t('system.dumpCredentials')}
        </Button>
        <span className="text-xs text-default-400">
          {t('system.credDumpNote')}
        </span>
      </div>

      {error && (
        <div className="p-3 bg-danger-50 text-danger-700 rounded text-sm font-mono whitespace-pre-wrap">
          {error}
        </div>
      )}

      {output && (
        <div className="p-3 bg-default-50 border border-default-200 rounded text-sm font-mono whitespace-pre-wrap max-h-96 overflow-auto">
          {output}
        </div>
      )}

      {!loading && !output && !error && (
        <div className="flex justify-center py-8 text-default-500 text-sm">
          {t('system.noCredentials')}
        </div>
      )}
    </div>
  );
}
