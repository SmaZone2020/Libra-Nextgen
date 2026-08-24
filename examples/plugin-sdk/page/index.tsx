import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Chip,
  Input,
  Label,
  ProgressCircle,
  Spinner,
  Switch,
  Tabs,
  TextField,
} from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';
import type { PluginOutput } from '../../hooks/usePluginHost';

/**
 * 插件 SDK 标准示例 — 前端"活文档"页。
 *
 * 本页同时是【示例】和【文档】：它把插件作者能用的所有宿主 API 与 HeroUI
 * 组件都真实渲染出来，作者照着抄即可。
 *
 * 分四块：
 *   1. 概览      —— 插件如何接入（meta.json / registry / usePluginHost）
 *   2. 宿主 API  —— usePluginHost 每个成员 + 真实演示
 *   3. HeroUI    —— 可用的组件样例
 *   4. 脚本 API  —— Agent 端平台 API 表（Windows/Linux/通用）+ #if 语法
 */

// ── 脚本平台 API 静态清单（与 modules/script/src/platform_*.rs 保持一致）──
const COMMON_API = [
  ['fs.read(path)', '读文件，返回字符串'],
  ['fs.write(path, content)', '写文件，返回 bool'],
  ['fs.list(path)', '列目录，返回数组'],
  ['fs.exists(path)', '判断是否存在，返回 bool'],
  ['proc.list()', '枚举进程，返回 [{pid,name}]'],
  ['proc.kill(pid)', '杀进程，返回 bool'],
  ['env.get(name)', '读环境变量，返回字符串'],
  ['whoami()', '当前用户名'],
  ['log(msg)', '打印到 agent 日志'],
];

const WINDOWS_API = [
  ['cmd(cmdline)', '执行 CMD 命令'],
  ['powershell(script)', '执行 PowerShell 脚本'],
  ['reg_query(key, name)', '查询注册表值'],
  ['reg_set(key, name, data)', '写注册表值，返回 bool'],
  ['reg_delete(key, name)', '删注册表值，返回 bool'],
  ['ipconfig()', '网络配置'],
  ['wmic(query)', '执行 WMIC 查询'],
  ['tasklist()', '任务列表'],
];

const LINUX_API = [
  ['shell(cmdline)', '执行 /bin/sh'],
  ['bash(script)', '执行 /bin/bash'],
  ['uname()', '内核/主机/架构'],
  ['ip_route()', '网络接口/IP，等价 ip addr'],
  ['ss(path)', '读 /proc 或 /sys 文件'],
  ['hostname()', '主机名'],
  ['dns()', '/etc/resolv.conf'],
];

const IFDEF_EXAMPLE = `#if(WINDOWS)
    let net = ipconfig();
#elif(LINUX)
    let net = ip_route() + "\\n" + dns();
#else
    let net = "unsupported";
#endif`;

export default function PluginSdkPage() {
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">插件开发 SDK 示例</h1>
        <p className="text-sm text-default-500 mt-1">
          这是一个"活文档"插件：本页展示插件作者能用的所有组件与 API，Agent 端模块
          <code className="font-mono text-xs">plugin_sdk.rhai</code> 展示所有平台能力与
          多平台 <code className="font-mono text-xs">#if</code> 写法。
        </p>
      </Card>

      <Tabs defaultSelectedKey="overview" className="w-full">
        <Tabs.ListContainer>
          <Tabs.List aria-label="sdk sections">
            <Tabs.Tab id="overview">概览<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="host">宿主 API<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="heroui">HeroUI 组件<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="script">平台脚本 API<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="overview"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel id="host"><HostApiTab /></Tabs.Panel>
        <Tabs.Panel id="heroui"><HeroUiTab /></Tabs.Panel>
        <Tabs.Panel id="script"><ScriptApiTab /></Tabs.Panel>
      </Tabs>
    </div>
  );
}

// ── 1. 概览 ────────────────────────────────────────────────────────────
function OverviewTab() {
  const steps = [
    ['meta.json', '写明 pluginId / entry.route / actions（含 module.kind=script|native）'],
    ['前端页面', '在 src/webapp/src/plugins/<pluginId>/index.tsx 写 HeroUI 页面'],
    ['registry 自动发现', 'import.meta.glob 收集页面 + 运行时对齐后端 enabled 清单'],
    ['usePluginHost()', '页面里拿到 selectedAgent / dispatchTask / subscribeOutput'],
    ['Agent 模块', 'script 通道写 .rhai；native 通道写 .rs 编译 cdylib'],
  ];
  return (
    <Card className="p-6 space-y-3">
      {steps.map(([title, desc], i) => (
        <div key={title} className="flex gap-3">
          <Chip size="sm" variant="secondary">{i + 1}</Chip>
          <div>
            <div className="font-mono text-sm">{title}</div>
            <div className="text-sm text-default-500">{desc}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}

// ── 2. 宿主 API（真实演示）────────────────────────────────────────────
function HostApiTab() {
  const { selectedAgent, selectAgent, dispatchTask, subscribeOutput, lastOutput } = usePluginHost();
  const [result, setResult] = useState<unknown>(null);
  const [stream, setStream] = useState<PluginOutput[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!selectedAgent) return;
    setRunning(true); setErr(null); setResult(null); setStream([]);
    const unsub = subscribeOutput((o) => setStream((p) => [...p, o]), 'showcase');
    try {
      const res = await dispatchTask('com.example.plugin-sdk', 'showcase', { capability: 'all' });
      setResult(res.result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      unsub(); setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* selectedAgent / selectAgent */}
      <Card className="p-4">
        <h3 className="font-semibold">selectedAgent（共享选中设备）</h3>
        <p className="text-sm text-default-500 mb-2">
          与顶部设备选择器共享：<code>usePluginHost().selectedAgent</code>
        </p>
        {selectedAgent
          ? <Chip color="success">{selectedAgent.hostname} ({selectedAgent.ipAddress})</Chip>
          : <Chip color="warning">未选择设备（请在顶部选择）</Chip>}
      </Card>

      {/* dispatchTask + subscribeOutput */}
      <Card className="p-4">
        <h3 className="font-semibold">dispatchTask / subscribeOutput（调用后端 → Agent）</h3>
        <p className="text-sm text-default-500 mb-2">
          <code className="font-mono text-xs">dispatchTask(pluginId, action, args)</code> 走动作网关；
          <code className="font-mono text-xs">subscribeOutput(cb, action)</code> 订阅 Agent 流式回传。
        </p>
        <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={run}>
          运行 showcase 动作
        </Button>
        {running && <Spinner size="sm" className="ml-2" />}
        {err && <p className="text-danger text-sm mt-2">{err}</p>}
      </Card>

      {stream.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">流式输出（subscribeOutput）</h3>
          <div className="space-y-1 max-h-40 overflow-auto font-mono text-xs">
            {stream.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Chip size="sm" variant="secondary">{s.action}</Chip>
                <span>{JSON.stringify(s.data)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {result !== null && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">同步结果（dispatchTask 返回值）</h3>
          <pre className="text-xs font-mono overflow-auto max-h-64 bg-default-50 dark:bg-default-900 p-3 rounded">
            {JSON.stringify(result, null, 2)}
          </pre>
        </Card>
      )}

      {/* lastOutput */}
      <Card className="p-4">
        <h3 className="font-semibold">lastOutput（最近一次插件结果）</h3>
        <p className="text-xs font-mono text-default-500 mt-2 break-all">
          {lastOutput ? JSON.stringify(lastOutput.data) : '（尚无结果）'}
        </p>
      </Card>
    </div>
  );
}

// ── 3. HeroUI 组件样例 ─────────────────────────────────────────────────
function HeroUiTab() {
  const [switchOn, setSwitchOn] = useState(false);
  const [input, setInput] = useState('');
  return (
    <Card className="p-6 space-y-6">
      <div>
        <h3 className="font-semibold mb-2">Button / Chip / Badge</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">primary</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="outline">outline</Button>
          <Button variant="ghost">ghost</Button>
          <Chip color="success">success chip</Chip>
          <Chip color="warning">warning chip</Chip>
          <Badge>badge</Badge>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-2">Input / TextField</h3>
        <TextField variant="secondary">
          <Label>示例输入</Label>
          <Input variant="secondary" value={input} onChange={(e) => setInput((e.target as HTMLInputElement).value)} />
        </TextField>
      </div>

      <div>
        <h3 className="font-semibold mb-2">Switch / ProgressCircle / Spinner</h3>
        <div className="flex items-center gap-4">
          <Switch isSelected={switchOn} onChange={setSwitchOn}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch>
          <ProgressCircle value={70} />
          <Spinner size="sm" />
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-2">更多组件</h3>
        <p className="text-sm text-default-500">
          Card、Tabs、Modal、Table、Dropdown、Tooltip、Accordion、Select、ListBox、
          Alert、Skeleton、Divider 等 —— 全部从
          <code className="font-mono text-xs"> @heroui/react</code> 导入，用法见本项目其余页面。
        </p>
      </div>
    </Card>
  );
}

// ── 4. 平台脚本 API ────────────────────────────────────────────────────
function ScriptApiTab() {
  return (
    <div className="space-y-4">
      <ApiTable title="通用 API（所有平台）" rows={COMMON_API} />
      <ApiTable title="Windows 专属（core feature）" rows={WINDOWS_API} />
      <ApiTable title="Linux 专属（core feature）" rows={LINUX_API} />

      <Card className="p-4">
        <h3 className="font-semibold mb-2">多平台条件编译（#if）</h3>
        <p className="text-sm text-default-500 mb-2">
          非本平台的代码块在【解析前】被裁剪，不会进入引擎，也不会因为调用不存在
          的函数而报错。
        </p>
        <pre className="text-xs font-mono overflow-auto bg-default-50 dark:bg-default-900 p-3 rounded">
          {IFDEF_EXAMPLE}
        </pre>
      </Card>
    </div>
  );
}

function ApiTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-2">{title}</h3>
      <div className="divide-y divide-default-100">
        {rows.map(([sig, desc]) => (
          <div key={sig} className="py-1.5">
            <code className="font-mono text-xs">{sig}</code>
            <span className="text-sm text-default-500 ml-3">{desc}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
