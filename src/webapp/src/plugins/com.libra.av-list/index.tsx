import { useCallback, useState } from 'react';
import {
  Alert, Button, Card, Chip, Table, Tag, TagGroup,
} from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';

/**
 * 杀软检测插件页面（page/index.tsx）—— com.libra.av-list。
 *
 * 数据流：
 *   1. dispatchTask 调 Agent 端 module/main.js（QuickJS），proc.list() 枚举进程，
 *      按内置杀软进程库匹配，返回按产品分组的 { av: [{product, processes:[{name,pid}]}] }。
 *   2. dispatchTask 返回值已做 JSON 反序列化，直接渲染。
 */
const PLUGIN_ID = 'com.libra.av-list';

interface AvProcess {
  name: string;
  pid: number;
}

interface AvProduct {
  product: string;
  processes: AvProcess[];
}

interface DetectResult {
  ok: boolean;
  platform: string;
  total_processes: number;
  av: AvProduct[];
  unmatched: string[];
}

/**
 * 插件结果可能是 JSON 字符串（服务端透传）或已是对象，统一解析。
 * 宿主网关会把 Agent 输出再包一层 { ok, result }，需解包取 result。
 */
function parseResult(raw: unknown): DetectResult | null {
  let obj: unknown = raw;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const rec = obj as Record<string, unknown>;
    const inner = rec.result && typeof rec.result === 'object'
      ? rec.result as Record<string, unknown>
      : rec;
    if (Array.isArray(inner.av)) return inner as unknown as DetectResult;
  }
  return null;
}

/** 按平台归类的识别阈值展示（统计用）。 */
function productName(platform: string): string {
  return platform === 'windows' ? 'Windows' : 'Linux/macOS';
}

export default function AvListPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const res = await dispatchTask(PLUGIN_ID, 'detect', {});
      const parsed = parseResult(res.result);
      if (!parsed || !Array.isArray(parsed.av)) {
        throw new Error('检测结果格式异常（未返回 av 列表）');
      }
      setResult(parsed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '检测失败');
    } finally {
      setRunning(false);
    }
  }, [selectedAgent, dispatchTask]);

  const avCount = result?.av.length ?? 0;
  const procCount = result?.av.reduce((n, p) => n + p.processes.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold">杀软检测</h1>
            <p className="text-sm text-default-500 mt-1">
              获取 Agent 进程列表，按内置杀软进程库匹配目标主机安装的杀毒软件 / 安全防护产品。
            </p>
          </div>
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={run}>
            检测杀毒软件
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
        </div>

        {result && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip size="sm" variant="soft" color="accent">识别产品 {avCount} 个</Chip>
            <Chip size="sm" variant="soft" color="warning">匹配进程 {procCount} 个</Chip>
            <Chip size="sm" variant="secondary">进程总数 {result.total_processes}</Chip>
            <Chip size="sm" variant="soft">{productName(result.platform)} 平台</Chip>
          </div>
        )}
      </Card>

      {err && (
        <Card className="p-4 border border-danger">
          <Alert status="danger"><Alert.Content><Alert.Description>{err}</Alert.Description></Alert.Content></Alert>
        </Card>
      )}

      {result && avCount === 0 && (
        <Card className="p-4">
          <p className="text-sm text-default-500">
            未检测到已知杀毒软件进程（已枚举 {result.total_processes} 个进程）。
          </p>
        </Card>
      )}

      {result && avCount > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold mb-3">检测结果</h2>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="av products" className="min-w-[560px]">
                <Table.Header>
                  <Table.Column isRowHeader>杀软产品</Table.Column>
                  <Table.Column>进程数</Table.Column>
                  <Table.Column>进程列表</Table.Column>
                </Table.Header>
                <Table.Body>
                  {result.av.map((item) => (
                    <Table.Row key={item.product}>
                      <Table.Cell className="font-medium">{item.product}</Table.Cell>
                      <Table.Cell>{item.processes.length}</Table.Cell>
                      <Table.Cell>
                        <TagGroup aria-label={`${item.product} processes`}>
                          <TagGroup.List>
                            {item.processes.map((p) => (
                              <Tag key={`${p.name}-${p.pid}`}>
                                {p.name} ({p.pid})
                              </Tag>
                            ))}
                          </TagGroup.List>
                        </TagGroup>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      )}
    </div>
  );
}
