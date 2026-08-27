'use client';

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Input, Label, Table, TextField } from '@heroui/react';
import {
  impersonateToken, listTokens, makeToken, revertToken, stealToken, type TokenItem,
} from '../../api/token';

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

export function TokenTab({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [pid, setPid] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('.');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setMessage('');
    try {
      const r = await fn() as { success?: boolean; error?: string };
      setMessage(r?.error ?? (r?.success ? 'OK' : 'failed'));
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(null);
    }
  };

  const doList = () => run('list', async () => {
    const r = await listTokens(agentId);
    if (r.success) setTokens(r.tokens ?? []);
    return r;
  });

  const doSteal = () => run('steal', async () => {
    const r = await stealToken(agentId, Number(pid));
    if (r.success && r.token) setTokens((t) => [...t, r.token!]);
    return r;
  });

  const doMake = () => run('make', async () => {
    const r = await makeToken(agentId, username, password, domain);
    if (r.success && r.token) setTokens((t) => [...t, r.token!]);
    return r;
  });

  const doImpersonate = (t: TokenItem) => run('impersonate', () =>
    impersonateToken(agentId, t.id, t.pid));

  const doRevert = () => run('revert', () => revertToken(agentId));

  return (
    <div className="space-y-3">

      <div className="flex flex-wrap items-center gap-2">
        <Button variant='secondary' isPending={busy === 'list'} onPress={doList}>{t('othersoft.enumerateTokens')}</Button>
        <Button variant='secondary' isPending={busy === 'revert'} onPress={doRevert}>{t('othersoft.revertIdentity')}</Button>
        <Label>PID</Label>
        <TextField variant="secondary" value={pid} onChange={setPid} className="w-36">
          <Input placeholder="0" />
        </TextField>
        <Button variant='secondary' isPending={busy === 'steal'} onPress={doSteal}>{t('othersoft.steal')}</Button>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
          <TextField variant="secondary" value={username} onChange={setUsername} className="w-40">
            <Label>{t('othersoft.username')}</Label>
            <Input placeholder="user" />
          </TextField>
          <TextField variant="secondary" type="password" value={password} onChange={setPassword} className="w-40">
            <Label>{t('othersoft.password')}</Label>
            <Input type="password" placeholder="pass" />
          </TextField>
          <TextField variant="secondary" value={domain} onChange={setDomain} className="w-32">
            <Label>{t('othersoft.tokenDomain')}</Label>
            <Input placeholder="." />
          </TextField>
        </div>

          <Button isPending={busy === 'make'} onPress={doMake}>
            {t('othersoft.forgeLogin')}
          </Button>
      </Card>
      {message && <div className="text-sm text-neutral-500">{message}</div>}

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Token 列表" className="min-w-[560px]">
            <Table.Header>
              <Table.Column isRowHeader>ID</Table.Column>
              <Table.Column>PID</Table.Column>
              <Table.Column>{t('othersoft.user')}</Table.Column>
              <Table.Column>{t('othersoft.action')}</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => (
              <div className="py-8 text-center text-neutral-500">{t('othersoft.noTokens')}</div>
            )}>
              {tokens.map((item) => (
                <Table.Row key={`${item.pid}-${item.id}`} id={`${item.pid}-${item.id}`}>
                  <Table.Cell>{String(item.id)}</Table.Cell>
                  <Table.Cell><Chip size="sm" variant="soft">{String(item.pid)}</Chip></Table.Cell>
                  <Table.Cell>{item.username}</Table.Cell>
                  <Table.Cell>
                    <Action loading={busy === 'impersonate'} onClick={() => doImpersonate(item)} variant="primary">
                      {t('othersoft.impersonate')}
                    </Action>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}
