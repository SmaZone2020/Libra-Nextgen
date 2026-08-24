import { useState } from 'react';
import { Button, Card, Chip, Spinner, Table } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';

interface QQKeyItem {
  uin: string;
  clientkey: string;
  pid: number;
  source: string;
  skey: string;
  p_skey: string;
  bkn: number;
  ptsigx: string;
  valid: boolean;
}

interface QQKeyResult {
  total: number;
  items: QQKeyItem[];
  uins: string[];
}

/**
 * QQ ClientKey 探测插件页面。
 * 通过 usePluginHost().dispatchTask 调用 native 插件 qqkey 的 collect 动作。
 */
export default function QQKeyPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QQKeyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const res = await dispatchTask('com.libra.qqkey', 'collect', {});
      setResult(res.result as QQKeyResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '采集失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">QQ ClientKey 探测</h1>
        <p className="text-sm text-default-500 mt-1">
          探测本机 QQ 快速登录端口（4300-4310）+ QQ.exe 进程内存扫描，经 ptlogin2 jump 兑换 skey/p_skey/bkn。
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={run}>
            采集 QQ ClientKey
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
        </div>
      </Card>

      {err && <Card className="p-4 border border-danger"><p className="text-danger text-sm">{err}</p></Card>}

      {running && (
        <div className="flex items-center gap-2 text-default-500"><Spinner size="sm" /> 采集与兑换中…</div>
      )}

      {result && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">采集结果</h2>
            <Chip size="sm" variant="secondary">{result.total} 条</Chip>
            {result.uins.length > 0 && (
              <Chip size="sm" color="success">UIN: {result.uins.join(', ')}</Chip>
            )}
          </div>

          {result.items.length === 0 ? (
            <p className="text-sm text-default-500">未发现有效的 clientkey（本机可能未运行 QQ 或未登录）。</p>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="qq keys" className="min-w-[700px]">
                <Table.Header>
                  <Table.Column>UIN</Table.Column>
                  <Table.Column>ClientKey</Table.Column>
                  <Table.Column>SKey</Table.Column>
                  <Table.Column>BKN</Table.Column>
                  <Table.Column>来源</Table.Column>
                  <Table.Column>有效</Table.Column>
                </Table.Header>
                <Table.Body>
                  {result.items.map((it, i) => (
                    <Table.Row key={i}>
                      <Table.Cell>{it.uin || '-'}</Table.Cell>
                      <Table.Cell className="font-mono text-xs max-w-[180px] truncate">{it.clientkey || '-'}</Table.Cell>
                      <Table.Cell className="font-mono text-xs max-w-[160px] truncate">{it.skey || '-'}</Table.Cell>
                      <Table.Cell>{it.bkn || '-'}</Table.Cell>
                      <Table.Cell>{it.source}</Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" color={it.valid ? 'success' : 'danger'}>{it.valid ? '有效' : '无效'}</Chip>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
