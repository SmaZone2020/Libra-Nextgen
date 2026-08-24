import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Chip,
  Input,
  Label,
  Link,
  ProgressCircle,
  Spinner,
  Switch,
  Tabs,
  TextField,
} from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';

/**
 * 插件 SDK 标准示例 — 前端"活文档"页。
 *
 * 本页同时是【示例】和【文档】：它把插件作者能用的所有宿主 API 与 HeroUI
 * 组件都真实渲染出来，作者照着抄即可。
 *
 * 分四块：
 *   1. 概览      —— 插件如何接入（meta.json / registry / usePluginHost）
 *   2. Shell 演示 —— 通过 dispatchTask 调用插件 shell 动作，终端样式执行命令
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
            <Tabs.Tab id="host">Shell 演示<Tabs.Indicator /></Tabs.Tab>
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
const DIR_TREE = `com.example.plugin-sdk/
├── meta.json               # 插件契约（必需）
├── module/                 # Agent 端模块
│   ├── plugin_sdk.rhai     #   script 通道：Rhai，无需编译
│   ├── x64/plugin.dll      #   native 通道：按平台目录
│   ├── x86/plugin.dll
│   └── linux-x64/plugin.so
├── page/index.tsx          # 前端页面（源码分发，需重建前端）
├── service/                # 服务端逻辑（占位）
└── assets/logo.svg         # 静态资源（经 assets 端点访问）`;

const META_SAMPLE = `{
  "schemaVersion": 1,
  "pluginId": "com.example.plugin-sdk",   // 仅 [A-Za-z0-9.-_]
  "name": "插件开发 SDK 示例",
  "version": "1.0.0",
  "author": "libra",
  "description": "标准示例插件",
  "entry": {                                // 前端入口
    "route": "plugin-sdk",                  //  /plugins/plugin-sdk
    "label": "nav.pluginSdk",               //  i18n 键
    "icon": "Puzzle",                       //  @gravity-ui/icons 图标名
    "apiRoot": "/api/plugins/com.example.plugin-sdk"
  },
  "i18n": { "zh": { "nav.pluginSdk": "插件 SDK 示例" } },
  "actions": [                              // 动作 = 按钮 + 转发 + 模块调用
    {
      "action": "showcase",                 //  前端 dispatchTask 用
      "label": "运行能力展示",
      "method": "POST",
      "argsSchema": {                       //  参数表单（type/properties/required）
        "type": "object",
        "properties": { "capability": { "type": "string", "title": "能力名称" } }
      },
      "module": {
        "kind": "script",                   //  script=Rhai / native=cdylib
        "name": "plugin_sdk",               //  .rhai stem 或 .dll/.so 名
        "op": "showcase",                   //  注入输入 JSON 的 op
        "entry": "main"                     //  脚本入口函数
      }
    }
  ]
}`;

function OverviewTab() {
  const steps = [
    ['meta.json', '写明 pluginId / entry.route / actions（含 module.kind=script|native）'],
    ['前端页面', '在 src/webapp/src/plugins/<pluginId>/index.tsx 写 HeroUI 页面'],
    ['registry 自动发现', 'import.meta.glob 收集页面 + 运行时对齐后端 enabled 清单'],
    ['usePluginHost()', '页面里拿到 selectedAgent / dispatchTask / subscribeOutput'],
    ['Agent 模块', 'script 通道写 .rhai；native 通道写 .rs 编译 cdylib'],
  ];
  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-3">
        <h3 className="font-semibold">接入流程</h3>
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

      <Card className="p-4">
        <h3 className="font-semibold mb-2">插件目录结构</h3>
        <pre className="text-xs font-mono overflow-auto bg-default-50 dark:bg-default-900 p-3 rounded">
          {DIR_TREE}
        </pre>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">meta.json 编写</h3>
        <p className="text-sm text-default-500 mb-2">
          meta.json 是插件唯一契约：服务端登记插件、前端渲染按钮、Agent 执行模块都靠它。
          完整逐字段说明见 <code className="font-mono text-xs">examples/plugin-sdk/README.md</code>。
        </p>
        <pre className="text-xs font-mono overflow-auto bg-default-50 dark:bg-default-900 p-3 rounded">
          {META_SAMPLE}
        </pre>
      </Card>
    </div>
  );
}

// ── 2. Shell 执行演示 ─────────────────────────────────────────────────
function HostApiTab() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [command, setCommand] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!selectedAgent) return;
    const cmd = command.trim();
    if (!cmd) return;

    setRunning(true);
    setErr(null);
    setLines((prev) => [...prev, `$ ${cmd}`]);

    try {
      const res = await dispatchTask('com.example.plugin-sdk', 'shell', { command: cmd });
      const output = (res.result as { output?: string } | undefined)?.output ?? JSON.stringify(res.result);
      setLines((prev) => [...prev, output, '']);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed';
      setErr(msg);
      setLines((prev) => [...prev, `[error] ${msg}`, '']);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 终端样式的 shell 执行演示 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-1">Shell 执行演示</h3>
        <p className="text-sm text-default-500 mb-3">
          {selectedAgent
            ? <>目标设备：<Chip size="sm" color="success">{selectedAgent.hostname} ({selectedAgent.ipAddress})</Chip></>
            : <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
          {' '}· 通过 <code className="font-mono text-xs">dispatchTask</code> 调用插件 shell 动作，Agent 端脚本执行命令并返回输出。
        </p>

        <div className="flex gap-2 mb-3">
          <TextField variant="secondary" className="flex-1">
            <Label className="sr-only">命令</Label>
            <Input
              value={command}
              onChange={(e) => setCommand((e.target as HTMLInputElement).value)}
              placeholder={selectedAgent ? '输入命令，如 whoami / ipconfig / ls' : '请先选择设备'}
              disabled={!selectedAgent}
              onKeyDown={(e) => { if (e.key === 'Enter' && !running) run(); }}
            />
          </TextField>
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent || !command.trim()} onPress={run}>
            执行
          </Button>
        </div>

        {/* 终端输出区 */}
        <div className="bg-neutral-900 dark:bg-black rounded-lg p-3 min-h-48 max-h-96 overflow-auto font-mono text-xs text-neutral-100">
          {lines.length === 0 ? (
            <span className="text-neutral-500">// 输入命令后回车，输出显示在这里</span>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all leading-5">{l || '\u00A0'}</div>
            ))
          )}
          {running && (
            <div className="text-neutral-400 animate-pulse">…执行中</div>
          )}
        </div>

        {err && <p className="text-danger text-sm mt-2">{err}</p>}
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
          <code className="font-mono text-xs"> @heroui/react</code> 导入。
          完整组件列表与用法详见{' '}
          <Link href="https://heroui.com/cn/docs/react/components" target="_blank">
            https://heroui.com/cn/docs/react/components
          </Link>
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
