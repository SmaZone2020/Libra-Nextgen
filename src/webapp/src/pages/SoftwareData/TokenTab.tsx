import { useState, type ReactNode } from 'react';
import { Button, Card, Chip, Input, Label, TextField } from '@heroui/react';
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
        <Button variant='secondary' isPending={busy === 'list'} onPress={doList}>枚举 Token</Button>
        <Button variant='secondary' isPending={busy === 'revert'} onPress={doRevert}>还原身份</Button>
        <Label>PID</Label>
        <TextField variant="secondary" value={pid} onChange={setPid} className="w-36">
          <Input placeholder="0" />
        </TextField>
        <Button variant='secondary' isPending={busy === 'steal'} onPress={doSteal}>窃取</Button>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
          <TextField variant="secondary" value={username} onChange={setUsername} className="w-40">
            <Label>用户名</Label>
            <Input placeholder="user" />
          </TextField>
          <TextField variant="secondary" type="password" value={password} onChange={setPassword} className="w-40">
            <Label>密码</Label>
            <Input type="password" placeholder="pass" />
          </TextField>
          <TextField variant="secondary" value={domain} onChange={setDomain} className="w-32">
            <Label>域</Label>
            <Input placeholder="." />
          </TextField>
        </div>

          <Button isPending={busy === 'make'} onPress={doMake}>
            伪造登录
          </Button>
      </Card>
      {message && <div className="text-sm text-neutral-500">{message}</div>}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-400">
            <th className="text-left py-1.5 px-2">ID</th>
            <th className="text-left py-1.5 px-2">PID</th>
            <th className="text-left py-1.5 px-2">用户</th>
            <th className="text-left py-1.5 px-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-center text-neutral-500 py-8">
                暂无 token，先点「枚举 Token」
              </td>
            </tr>
          ) : tokens.map((t) => (
            <tr key={`${t.pid}-${t.id}`} className="border-b border-neutral-900">
              <td className="py-1.5 px-2">{String(t.id)}</td>
              <td className="py-1.5 px-2"><Chip size="sm" variant="soft">{String(t.pid)}</Chip></td>
              <td className="py-1.5 px-2">{t.username}</td>
              <td className="py-1.5 px-2">
                <Action loading={busy === 'impersonate'} onClick={() => doImpersonate(t)} variant="primary">
                  模拟
                </Action>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
