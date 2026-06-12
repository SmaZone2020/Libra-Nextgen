import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, Chip, Table } from '@heroui/react';
import { createTask, getTask } from '../../api/tasks';
import type { LocalAccount } from '../../types/models';

interface Props {
  agentId: string;
}

interface AccountRow extends LocalAccount {
  id: string;
}

function fmtDate(raw: string | undefined): string {
  if (!raw) return '-';
  const m = /\/Date\((\d+)\)\//.exec(raw);
  if (m?.[1]) return new Date(+m[1]).toLocaleString();
  // Handle ISO 8601 dates too
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toLocaleString();
  return raw;
}

function extractJson(raw: string): Record<string, unknown> | unknown[] {
  // Try direct parse first
  try { return JSON.parse(raw); } catch { /* fall through */ }

  // Find JSON object by counting braces from the first '{'
  const objStart = raw.indexOf('{');
  if (objStart >= 0) {
    let depth = 0;
    for (let i = objStart; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(raw.slice(objStart, i + 1)); } catch { break; } } }
    }
  }

  // Find JSON array by counting brackets from the first '['
  const arrStart = raw.indexOf('[');
  if (arrStart >= 0) {
    let depth = 0;
    for (let i = arrStart; i < raw.length; i++) {
      if (raw[i] === '[') depth++;
      else if (raw[i] === ']') { depth--; if (depth === 0) { try { return JSON.parse(raw.slice(arrStart, i + 1)); } catch { break; } } }
    }
  }

  throw new Error('No JSON found in output');
}

export function LocalAccountsTab({ agentId }: Props) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<LocalAccount[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credOutput, setCredOutput] = useState<string | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);

  const rows = useMemo<AccountRow[]>(
    () => (accounts ?? []).map((a, i) => ({ ...a, id: a.sidValue || a.Name || String(i) })),
    [accounts],
  );

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const task = await createTask({ agentId, commandType: 'LocalAccounts', command: '' });
      const taskId = task.id;

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const t = await getTask(taskId);
          if (t.status === 'Completed' || t.status === 'Failed') {
            try {
              const raw = extractJson(t.output || '[]');
              const list: Record<string, unknown>[] = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : ((raw as Record<string, unknown>).accounts as Record<string, unknown>[] ?? []);
              const normalized: LocalAccount[] = list.map((a) => ({
                Name: (a.Name || a.name || '') as string,
                FullName: (a.FullName || a.fullName || '') as string,
                Description: (a.Description || a.description || '') as string,
                Enabled: (a.Enabled ?? a.enabled ?? false) as boolean,
                isAdmin: (a.isAdmin ?? false) as boolean,
                sidValue: (a.sidValue || a.sid || '') as string,
                groups: (Array.isArray(a.groups) ? a.groups : []) as string[],
                PasswordRequired: (a.PasswordRequired ?? a.passwordRequired ?? false) as boolean,
                LastLogon: (a.LastLogon || a.lastLogon || null) as string | undefined,
                AccountExpires: (a.AccountExpires || a.accountExpires || null) as string | undefined,
              }));
              setAccounts(normalized);
              if (t.status === 'Failed') {
                setError(t.error || 'Task reported failure but returned partial data');
              }
            } catch {
              setAccounts([]);
              if (t.status === 'Failed') {
                setError(t.error || 'Task failed');
              }
            }
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
          if (t.status === 'Completed' || t.status === 'Failed') {
            setCredOutput(t.output || '[No output]');
            if (t.status === 'Failed') {
              setCredError(t.error || 'Task reported failure');
            }
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
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">{t('system.localAccounts')}</h3>
          <Button size="sm" variant="ghost" isDisabled={loading} onPress={loadAccounts}>
            {t('common.refresh')}
          </Button>
        </div>

        {loading && (
          <div className="flex justify-center py-8"><Spinner /></div>
        )}

        {error && (
          <div className="p-3 bg-danger-50 text-danger-700 rounded text-sm">{error}</div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="text-sm text-default-500 py-8 text-center">
            {t('system.noLocalAccounts')}
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <Table>
            <Table.ScrollContainer>
              <Table.Content
                aria-label={t('system.localAccounts')}
                className="min-w-[600px]"
              >
                <Table.Header>
                  <Table.Column isRowHeader>{t('system.accountName')}</Table.Column>
                  <Table.Column>{t('system.description')}</Table.Column>
                  <Table.Column>{t('system.lastLogon')}</Table.Column>
                  <Table.Column>{t('system.administrator')}</Table.Column>
                </Table.Header>
                <Table.Body>
                  {rows.map((a) => (
                    <Table.Row key={a.id} id={a.id}>
                        <Table.Cell>
                          <span className="font-medium">{a.Name}</span>
                        </Table.Cell>
                        <Table.Cell className="text-sm max-w-[240px] truncate">{a.Description || '-'}</Table.Cell>
                        <Table.Cell className="text-xs text-default-500">{fmtDate(a.LastLogon)}</Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft" color={a.isAdmin ? 'warning' : 'default'}>
                            {a.isAdmin ? t('common.yes') : t('common.no')}
                          </Chip>
                        </Table.Cell>
                      </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </div>

      <hr className="border-default-200" />

      <div>
        <div className="flex items-center gap-3 mb-2">
          <Button variant="primary" isDisabled={credLoading} onPress={handleCredDump}>
            {t('system.dumpCredentials')}
          </Button>
          <span className="text-xs text-default-400">{t('system.credDumpNote')}</span>
        </div>

        {credLoading && <div className="flex justify-center py-4"><Spinner /></div>}

        {credError && (
          <div className="p-3 bg-danger-50 text-danger-700 rounded text-sm font-mono whitespace-pre-wrap">{credError}</div>
        )}

        {credOutput && (
          <div className="p-3 bg-default-50 border border-default-200 rounded text-sm font-mono whitespace-pre-wrap max-h-96 overflow-auto">{credOutput}</div>
        )}
      </div>
    </div>
  );
}
