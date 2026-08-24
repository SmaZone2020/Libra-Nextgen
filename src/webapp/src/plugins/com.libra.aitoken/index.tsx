import { useMemo, useState } from 'react';
import { Accordion, Button, Card, Chip, Spinner } from '@heroui/react';
import { ChevronDown } from '@gravity-ui/icons';
import { API_ORIGIN } from '../../api/client';
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

/** vendor → 图标文件名（打包在插件 assets/ 目录，经资源端点请求） */
const VENDOR_META: Record<string, { icon: string; label: string }> = {
  ClaudeCode: { icon: 'claude.svg', label: 'Claude Code' },
  OpenCode: { icon: 'opencode-logo-light.svg', label: 'OpenCode' },
  MimoCode: { icon: 'xiaomimimo.svg', label: 'MimoCode' },
  CodeX: { icon: 'openai.svg', label: 'CodeX' },
  Gemini: { icon: 'gemini.svg', label: 'Gemini' },
  OpenClaw: { icon: 'claw.svg', label: 'OpenClaw' },
  HermesAgent: { icon: 'hermes.png', label: 'Hermes Agent' },
  CCSwitch: { icon: 'ccs.ico', label: 'CC Switch' },
  DeepSeekHarness: { icon: 'deepseek.svg', label: 'DeepSeek Harness' },
};

const PLUGIN_ID = 'com.libra.aitoken';

function assetUrl(file: string): string {
  return `${API_ORIGIN}/api/plugins/${PLUGIN_ID}/assets/${file}`;
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

/**
 * AI 软件 API Key 探测插件页面。
 * 结果按 vendor 分组，以手风琴展示（同一软件一个手风琴项），图标从插件
 * 打包的 assets/ 资源目录经服务端资源端点加载。
 */
export default function AITokenPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AITokenResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const run = async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    setShowRaw(false);
    try {
      const res = await dispatchTask(PLUGIN_ID, 'collect', {});
      setResult(res.result as AITokenResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '扫描失败');
    } finally {
      setRunning(false);
    }
  };

  const groups = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, AITokenItem[]>();
    for (const it of result.items) {
      const vendor = it.vendor || 'Unknown';
      if (!map.has(vendor)) map.set(vendor, []);
      map.get(vendor)!.push(it);
    }
    return Array.from(map.entries()).map(([vendor, items]) => ({ vendor, items }));
  }, [result]);

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
          {result && (
            <Button size="sm" variant="ghost" onPress={() => setShowRaw(s => !s)}>
              {showRaw ? '隐藏明文' : '显示明文'}
            </Button>
          )}
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

          {groups.length === 0 ? (
            <p className="text-sm text-default-500">未发现 AI 软件 API Key。</p>
          ) : (
            <Accordion className="w-full">
              {groups.map(({ vendor, items }) => {
                const meta = VENDOR_META[vendor] ?? { icon: '', label: vendor };
                return (
                  <Accordion.Item key={vendor}>
                    <Accordion.Heading>
                      <Accordion.Trigger>
                        {meta.icon && (
                          <img
                            src={assetUrl(meta.icon)}
                            alt={meta.label}
                            className="mr-3 size-5 shrink-0 rounded-sm object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                        <span className="font-semibold">{meta.label}</span>
                        <Chip size="sm" variant="secondary" className="ml-2">{items.length}</Chip>
                        <Accordion.Indicator>
                          <ChevronDown />
                        </Accordion.Indicator>
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body>
                        <div className="space-y-2">
                          {items.map((it, i) => (
                            <div key={i} className="rounded-lg border border-default-100 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs text-default-700 break-all">{it.keyName}</span>
                                <Chip size="sm" variant="soft" color={it.source === 'config-file' ? 'accent' : 'warning'}>
                                  {it.source === 'config-file' ? 'Config' : 'Env'}
                                </Chip>
                              </div>
                              <div className="mt-1 font-mono text-xs text-default-500 break-all">
                                {showRaw ? it.keyValue : maskKey(it.keyValue)}
                              </div>
                              <div className="mt-1 text-[11px] text-default-400 truncate">{it.path}</div>
                            </div>
                          ))}
                        </div>
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>
          )}
        </Card>
      )}
    </div>
  );
}
