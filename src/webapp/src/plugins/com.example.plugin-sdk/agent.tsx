import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Chip, ComboBox, Description, Input, Label, ListBox, Spinner, TextField,
} from '@heroui/react';
import { usePluginHost, type PluginOutput } from '../../hooks/usePluginHost';
import { AGENT_CAPS, COMMON_API, LINUX_API, SDK_ID, WINDOWS_API, pretty } from './shared';
import { ApiTable } from './components';

// ── 3. Agent 端：能力目录 + 实时执行 ───────────────────────────────────

export function AgentTab() {
  const { selectedAgent, dispatchTask, subscribeOutput } = usePluginHost();
  const [cap, setCap] = useState('whoami');
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<PluginOutput[]>([]);

  // WS 实时推送演示：subscribeOutput(回调, action?) —— 不传 action 收全部 plugin.result
  useEffect(
    () =>
      subscribeOutput((out) => setEvents((prev) => [out, ...prev].slice(0, 12))),
    [subscribeOutput],
  );

  const run = useCallback(async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const isShell = cap === 'shell';
      const res = await dispatchTask(
        SDK_ID,
        isShell ? 'shell' : 'showcase',
        isShell ? { command: command || 'echo hello' } : { capability: cap },
      );
      setResult(res.result ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [selectedAgent, dispatchTask, cap, command]);

  const current = AGENT_CAPS.find((c) => c.value === cap);

  return (
    <div className="space-y-4">
      {/* 能力目录 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">能力与可选项（capability）</h3>
        <div className="divide-y divide-default-100">
          {AGENT_CAPS.map((c) => (
            <div key={c.value} className="py-1.5 flex items-baseline gap-3">
              <code className="font-mono text-xs w-40 shrink-0">{c.label}{c.needsCommand ? '(command)' : ''}</code>
              <span className="text-sm text-default-500">{c.desc}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 实时执行 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-1">实时执行（dispatchTask → Agent 内存执行 JS → WS 推送）</h3>
        <p className="text-sm text-default-500 mb-3">
          {selectedAgent
            ? <>目标设备：<Chip size="sm" color="success">{selectedAgent.hostname} ({selectedAgent.ipAddress})</Chip></>
            : <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
          {' '}· 选择 capability（可选项），点执行；结果与 WS 推送都在下方。
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <ComboBox
            className="w-[220px]"
            selectedKey={cap}
            onSelectionChange={(k) => { if (k) setCap(String(k)); }}
          >
            <Label>capability</Label>
            <ComboBox.InputGroup>
              <Input />
              <ComboBox.Trigger />
            </ComboBox.InputGroup>
            <ComboBox.Popover>
              <ListBox aria-label="capabilities">
                {AGENT_CAPS.map((c) => (
                  <ListBox.Item key={c.value} id={c.value} textValue={c.label}>
                    <div className="flex flex-col">
                      <Label className="font-mono">{c.label}</Label>
                      <Description>{c.desc}</Description>
                    </div>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </ComboBox.Popover>
          </ComboBox>

          {current?.needsCommand && (
            <TextField variant="secondary" className="w-64">
              <Label className="sr-only">command</Label>
              <Input value={command} onChange={(e) => setCommand((e.target as HTMLInputElement).value)} placeholder="要执行的命令（如 whoami）" />
            </TextField>
          )}

          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={run}>
            执行
          </Button>
          {running && <Spinner size="sm" />}
        </div>

        {err && <p className="text-danger text-sm mt-3">{err}</p>}

        {result !== null && (
          <div className="mt-3">
            <div className="text-xs text-default-400 mb-1">dispatchTask 返回（result）</div>
            <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-neutral-900 dark:bg-black text-neutral-100 p-3 rounded max-h-80 overflow-auto">
              {pretty(result)}
            </pre>
          </div>
        )}

        <div className="mt-4">
          <div className="text-xs text-default-400 mb-1">
            WebSocket 实时推送（subscribeOutput，共 {events.length} 条 · 无需手动刷新）
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-default-500">暂无推送 —— 执行上面的能力后，Agent 的结果会实时出现在这里。</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-auto">
              {events.map((ev, i) => (
                <div key={ev.ts + '-' + i} className="flex gap-2 items-start text-xs font-mono bg-default-50 dark:bg-default-900 rounded px-2 py-1">
                  <span className="text-default-400 shrink-0">{new Date(ev.ts).toLocaleTimeString()}</span>
                  <Chip size="sm" variant="secondary">{ev.action || '(untagged)'}</Chip>
                  <span className="text-default-500 shrink-0">{ev.agentId.slice(0, 8)}</span>
                  <span className="min-w-0 break-all">{pretty(ev.data).slice(0, 220)}{pretty(ev.data).length > 220 ? '…' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 平台 API 静态清单 */}
      <ApiTable title="通用 API（所有平台）" rows={COMMON_API} />
      <div className="grid gap-4 md:grid-cols-2">
        <ApiTable title="Windows 专属" rows={WINDOWS_API} />
        <ApiTable title="Linux 专属" rows={LINUX_API} />
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">跨平台写法（__platform 运行时分支）</h3>
        <p className="text-sm text-default-500 mb-2">
          平台 API 按运行平台注册：Windows 上调用 shell() 会得到 "not a function" 错误，反之亦然。
          跨平台脚本用 __platform() 运行时分支（不需要 #if 预处理）。
        </p>
        <pre className="text-xs font-mono overflow-auto bg-default-50 dark:bg-default-900 p-3 rounded">{`function main(args) {
    if (args.capability === "network") {
        var net;
        if (__platform() === "windows") {
            net = ipconfig();
        } else if (__platform() === "linux") {
            net = ip_route() + "\\n" + dns();
        } else {
            net = "unsupported platform";
        }
        return { "network": net };
    }
    return { "ok": true };
}`}</pre>
      </Card>
    </div>
  );
}
