import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Accordion, Alert, Avatar, Badge, Button, Card, Checkbox, Chip, ComboBox, Description,
  Dropdown, Input, Kbd, Label, Link, ListBox, Modal, ProgressCircle, Skeleton, Slider,
  Spinner, Surface, Switch, Table, Tabs, TextArea, TextField, Tooltip,
} from '@heroui/react';
import { usePluginHost, type PluginOutput } from '../../hooks/usePluginHost';
import { api, API_ORIGIN } from '../../api/client';
import {
  getPluginRegistry, installPluginFromRegistry, listPlugins,
  type PluginRecord, type PluginRegistryIndex,
} from '../../api/plugins';

/**
 * 插件 SDK 全能力演示（活文档）。
 *
 * 本页同时是【示例】和【文档】：把插件作者能用的所有宿主 API、组件与
 * 可选项都真实渲染出来，作者照着抄即可。分五个页签：
 *   1. 总览        —— 三层架构 / 包目录结构 / meta.json 全字段与可选项
 *   2. Agent 模块  —— Rhai 脚本能力目录 + 实时执行（dispatchTask + WS 推送）
 *   3. 服务端脚本  —— service/main.cs 全函数目录 + 实时调用（/api/plugin/*）
 *   4. 前端 API    —— usePluginHost / api client / 插件管理 / 插件市场
 *   5. HeroUI 组件 —— 可用组件画廊（每个组件列出可选项）
 */

const SDK_ID = 'com.example.plugin-sdk';
const SERVICE_BASE = `/plugin/${SDK_ID}`;

// ── 服务端脚本调用封装（POST /api/plugin/<pluginId>/<fn>）───────────────
interface ScriptResult { ok: boolean; data?: unknown; error?: string; plugin?: string; fn?: string; }
async function callScript<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<ScriptResult> {
  return api.post<ScriptResult>(`${SERVICE_BASE}/${fn}`, params ?? {});
}

/** 剥掉可能的 JSONP 外壳 / 解析 JSON 字符串。 */
function tryParse(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

function pretty(data: unknown): string {
  const parsed = tryParse(data);
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed ?? '(empty)', null, 2);
}

// ── 目录/清单常量 ───────────────────────────────────────────────────────

const DIR_TREE = `com.example.plugin-sdk/
├── meta.json               # 插件契约（必需）
├── module/                 # Agent 端模块
│   ├── plugin_sdk.rhai     #   script 通道：Rhai，无需编译，内存执行
│   ├── x64/plugin.dll      #   native 通道：按平台目录放 cdylib
│   ├── x86/plugin.dll
│   └── linux-x64/plugin.so
├── service/                # 服务端逻辑（C# 脚本，随包分发）
│   └── main.cs             #   由 ServerScriptService 执行：/api/plugin/<pluginId>/<fn>
├── page/                   # 前端页面源码（分发用，需重建前端）
│   └── index.tsx
├── data/                   # 随包分发的数据/配置文件（脚本可读）
├── assets/                 # 静态资源（图标等）
└── README.md               # 插件说明`;

const META_FIELDS: { field: string; required: string; desc: string; options: string }[] = [
  { field: 'schemaVersion', required: '是', desc: '契约版本', options: '恒为 1' },
  { field: 'pluginId', required: '是', desc: '全局唯一 ID，也是包目录名 / 脚本目录名', options: '仅 [A-Za-z0-9.-_]，建议 com.作者.插件' },
  { field: 'name', required: '是', desc: '插件显示名', options: '任意字符串' },
  { field: 'version', required: '是', desc: '插件版本', options: '语义化版本号，如 1.0.0' },
  { field: 'author', required: '是', desc: '作者', options: '任意字符串' },
  { field: 'description', required: '是', desc: '一句话说明（市场列表显示）', options: '任意字符串' },
  { field: 'entry.route', required: '是', desc: '前端路由', options: '/plugins/<route>' },
  { field: 'entry.label', required: '是', desc: '导航名', options: 'i18n 键，如 nav.pluginSdk' },
  { field: 'entry.icon', required: '否', desc: '导航图标', options: '@gravity-ui/icons 图标名，如 Puzzle' },
  { field: 'entry.apiRoot', required: '否', desc: '页面 API 前缀（约定，页面自行使用）', options: '/api/plugins/<pluginId>' },
  { field: 'i18n', required: '否', desc: '多语言文案', options: '{ zh: {...}, en: {...} }' },
  { field: 'actions[]', required: '是', desc: '动作 = 按钮 + 转发 + Agent 模块调用', options: '见下方 actions 表' },
];

const ACTION_FIELDS: { field: string; required: string; desc: string; options: string }[] = [
  { field: 'action', required: '是', desc: '动作 ID（前端 dispatchTask 用）', options: '任意字符串，如 showcase' },
  { field: 'label', required: '是', desc: '按钮/动作显示名', options: '任意字符串' },
  { field: 'method', required: '是', desc: 'HTTP 方法', options: 'GET / POST' },
  { field: 'argsSchema', required: '否', desc: '参数表单（JSON Schema 子集）', options: 'type: object；properties: {字段: {type, title}}；required: [字段]' },
  { field: 'module.kind', required: '是', desc: 'Agent 模块通道', options: 'script（.rhai，无需编译）/ native（cdylib .dll/.so）' },
  { field: 'module.name', required: '是', desc: '模块名', options: '.rhai 文件 stem 或 .dll/.so 名' },
  { field: 'module.op', required: '否', desc: '注入模块输入 JSON 的 op 字段', options: '任意字符串，模块内分支用' },
  { field: 'module.entry', required: '否', desc: '脚本入口函数', options: '如 main' },
];

const STEPS: [string, string][] = [
  ['建包', '写好 meta.json + module/（script 或 native）+ service/main.cs + page/index.tsx，打成 zip'],
  ['导入', '控制台 → 插件管理 → 上传插件 / 从 Git 导入 / 从市场安装'],
  ['启用', '插件登记到后端，动作可下发到 Agent'],
  ['写页面', 'src/webapp/src/plugins/<pluginId>/index.tsx（import.meta.glob 收集，需重建前端）'],
  ['调 Agent', '页面里 usePluginHost().dispatchTask(pluginId, action, args)'],
  ['调服务', '页面里 api.post(\'/plugin/<pluginId>/<fn>\', params) 驱动 service/main.cs'],
  ['发布', '把 zip 提交到 Libra-Plugins 仓库，CI 生成 index.json 即上架市场'],
];

// ── Agent 能力清单（与 module/plugin_sdk.rhai 的 capability 分支一致）──
const AGENT_CAPS: { value: string; label: string; desc: string; needsCommand?: boolean }[] = [
  { value: 'whoami', label: 'whoami', desc: '当前用户' },
  { value: 'fs', label: 'fs', desc: '文件系统：写 /tmp/libra_sdk_probe.txt → 读 → 列目录 → 存在性' },
  { value: 'proc', label: 'proc', desc: '进程列表 + PATH 环境变量' },
  { value: 'network', label: 'network', desc: '网络信息（按平台自动选命令）' },
  { value: 'system', label: 'system', desc: '系统信息（按平台自动选命令）' },
  { value: 'shell', label: 'shell', desc: '执行任意命令（可选项 command）', needsCommand: true },
  { value: 'log', label: 'log', desc: '写一条 Agent 日志（控制台日志流可见）' },
  { value: 'all', label: 'all', desc: '全量自检（默认）' },
  { value: 'manifest', label: 'manifest', desc: '返回能力目录（自描述）' },
];

const COMMON_API: [string, string][] = [
  ['fs.read(path)', '读文件，返回字符串'],
  ['fs.write(path, content)', '写文件，返回 bool'],
  ['fs.list(path)', '列目录，返回数组'],
  ['fs.exists(path)', '判断是否存在，返回 bool'],
  ['proc.list()', '枚举进程，返回 [{pid,name}]'],
  ['proc.kill(pid)', '杀进程，返回 bool（危险操作）'],
  ['env.get(name)', '读环境变量，返回字符串'],
  ['env.set(name, value)', '写环境变量（多线程下安全 no-op 占位）'],
  ['whoami()', '当前用户名'],
  ['log(msg)', '打印到 Agent 日志'],
];

const WINDOWS_API: [string, string][] = [
  ['cmd(cmdline)', '执行 CMD 命令'],
  ['powershell(script)', '执行 PowerShell 脚本'],
  ['reg_query(key, name)', '查询注册表值'],
  ['reg_set(key, name, data)', '写注册表值，返回 bool'],
  ['reg_delete(key, name)', '删注册表值，返回 bool'],
  ['ipconfig()', '网络配置'],
  ['wmic(query)', '执行 WMIC 查询'],
  ['tasklist()', '任务列表'],
];

const LINUX_API: [string, string][] = [
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

// ── 主页面 ─────────────────────────────────────────────────────────────

export default function PluginSdkPage() {
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">插件开发 SDK 示例（全能力演示）</h1>
        <p className="text-sm text-default-500 mt-1">
          这是一个"活文档"插件：五个页签覆盖插件能用的所有能力与可选项 —— Agent 端
          <code className="font-mono text-xs">module/plugin_sdk.rhai</code>（Rhai 脚本，多平台）、服务端
          <code className="font-mono text-xs">service/main.cs</code>（C# 脚本，经
          <code className="font-mono text-xs">/api/plugin/com.example.plugin-sdk/&lt;fn&gt;</code> 驱动）、
          前端 <code className="font-mono text-xs">page/index.tsx</code>（HeroUI + usePluginHost + 市场）。
        </p>
      </Card>

      <Tabs defaultSelectedKey="overview" className="w-full">
        <Tabs.ListContainer>
          <Tabs.List aria-label="sdk sections">
            <Tabs.Tab id="overview">总览<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="agent">Agent 模块<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="service">服务端脚本<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="frontend">前端 API<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="heroui">HeroUI 组件<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="overview"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel id="agent"><AgentTab /></Tabs.Panel>
        <Tabs.Panel id="service"><ServiceTab /></Tabs.Panel>
        <Tabs.Panel id="frontend"><FrontendApiTab /></Tabs.Panel>
        <Tabs.Panel id="heroui"><HeroUiTab /></Tabs.Panel>
      </Tabs>
    </div>
  );
}

// ── 1. 总览 ────────────────────────────────────────────────────────────

function OverviewTab() {
  return (
    <div className="space-y-4">
      {/* 三层架构 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Chip size="sm" color="accent">Agent 端</Chip>
            <h3 className="font-semibold">module/</h3>
          </div>
          <ul className="text-sm text-default-500 mt-2 space-y-1 list-disc list-inside">
            <li>script 通道：.rhai 脚本，无需编译，随动作下发内存执行</li>
            <li>native 通道：Rust cdylib，按平台目录分发（x64/x86/linux-x64）</li>
            <li>能力：文件/进程/环境/Shell/注册表/网络/系统信息…</li>
            <li>#if(WINDOWS)/#elif(LINUX) 解析期条件编译</li>
          </ul>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Chip size="sm" color="warning">服务端</Chip>
            <h3 className="font-semibold">service/main.cs</h3>
          </div>
          <ul className="text-sm text-default-500 mt-2 space-y-1 list-disc list-inside">
            <li>随包分发的 C# 脚本（Roslyn 解析执行，编译缓存）</li>
            <li>POST /api/plugin/&lt;pluginId&gt;/&lt;fn&gt; 驱动</li>
            <li>可引用库：HttpClient / System.Text.Json / Linq…</li>
            <li>服务端发起网络请求（无 CORS）、读包内文件、跨调用状态</li>
          </ul>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Chip size="sm" color="success">前端</Chip>
            <h3 className="font-semibold">page/index.tsx</h3>
          </div>
          <ul className="text-sm text-default-500 mt-2 space-y-1 list-disc list-inside">
            <li>HeroUI 组件 + usePluginHost（设备/任务/WS 推送）</li>
            <li>dispatchTask 调 Agent 模块；api.post 调服务端脚本</li>
            <li>可直接 fetch 插件市场（localStorage 1h 缓存）</li>
            <li>源码分发：import.meta.glob 构建期收集，需重建前端</li>
          </ul>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">插件包目录结构</h3>
        <pre className="text-xs font-mono overflow-auto bg-default-50 dark:bg-default-900 p-3 rounded">{DIR_TREE}</pre>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">meta.json 全字段（契约）</h3>
        <MetaTable rows={META_FIELDS} />
        <h4 className="font-semibold mt-4 mb-2">actions[] 子字段</h4>
        <MetaTable rows={ACTION_FIELDS} />
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">接入流程（7 步）</h3>
        <div className="space-y-2">
          {STEPS.map(([title, desc], i) => (
            <div key={title} className="flex gap-3 items-start">
              <Chip size="sm" variant="secondary">{i + 1}</Chip>
              <div>
                <div className="font-mono text-sm">{title}</div>
                <div className="text-sm text-default-500">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Alert status="accent">
        <Alert.Content>
          <Alert.Title>分发须知</Alert.Title>
          <Alert.Description>
            module/ 与 service/ 随 zip 运行时分发；page/index.tsx 是源码分发，需放入前端仓库
            src/webapp/src/plugins/&lt;pluginId&gt;/index.tsx 并重建前端才会生效（本插件仓库内已内置）。
          </Alert.Description>
        </Alert.Content>
      </Alert>
    </div>
  );
}

function MetaTable({ rows }: { rows: { field: string; required: string; desc: string; options: string }[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="meta fields" className="min-w-[720px]">
          <Table.Header>
            <Table.Column isRowHeader>字段</Table.Column>
            <Table.Column>必填</Table.Column>
            <Table.Column>说明</Table.Column>
            <Table.Column>可选项</Table.Column>
          </Table.Header>
          <Table.Body>
            {rows.map((r, i) => (
              <Table.Row key={r.field} id={`mf-${i}`}>
                <Table.Cell><code className="font-mono text-xs">{r.field}</code></Table.Cell>
                <Table.Cell>{r.required === '是' ? <Chip size="sm" color="danger" variant="soft">必填</Chip> : <Chip size="sm" variant="secondary">可选</Chip>}</Table.Cell>
                <Table.Cell className="text-sm">{r.desc}</Table.Cell>
                <Table.Cell className="text-sm text-default-500">{r.options}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

// ── 2. Agent 模块：能力目录 + 实时执行 ────────────────────────────────

function AgentTab() {
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
        <h3 className="font-semibold mb-1">实时执行（dispatchTask → Agent 内存执行 Rhai → WS 推送）</h3>
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
        <h3 className="font-semibold mb-2">多平台条件编译（#if，解析期裁剪）</h3>
        <p className="text-sm text-default-500 mb-2">
          非本平台的代码块在解析前被裁剪，不会进入引擎，也不会因为调用不存在的函数而报错。
        </p>
        <pre className="text-xs font-mono overflow-auto bg-default-50 dark:bg-default-900 p-3 rounded">{IFDEF_EXAMPLE}</pre>
      </Card>
    </div>
  );
}

// ── 3. 服务端脚本：全函数目录 + 实时调用 ──────────────────────────────

interface SdkManifest {
  pluginId: string;
  host: string;
  endpoint: string;
  callCount: number;
  funcs: { name: string; desc: string; options: { name: string; type: string; optional: boolean; default?: string; desc: string }[] }[];
}

function ServiceTab() {
  const [manifest, setManifest] = useState<SdkManifest | null>(null);
  const [manifestErr, setManifestErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ title: string; ok: boolean; data: unknown; error?: string } | null>(null);
  const [list, setList] = useState<{ pluginId: string; functions: string[] }[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  // 表单状态（每个函数的可选项）
  const [echoText, setEchoText] = useState('hello sdk');
  const [echoCount, setEchoCount] = useState('3');
  const [nowFormat, setNowFormat] = useState('yyyy-MM-dd HH:mm:ss');
  const [nowUtc, setNowUtc] = useState(false);
  const [skey, setSkey] = useState('abcdef0123456789');
  const [httpUrl, setHttpUrl] = useState('https://api.ipify.org?format=json');
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpHeaders, setHttpHeaders] = useState('{"X-Demo": "plugin-sdk"}');
  const [httpBody, setHttpBody] = useState('');
  const [httpTimeout, setHttpTimeout] = useState('15');
  const [fileName, setFileName] = useState('meta.json');
  const [listCount, setListCount] = useState('5');
  const [listPrefix, setListPrefix] = useState('item');
  const [tableRows, setTableRows] = useState('3');
  const [tablePrefix, setTablePrefix] = useState('sdk');
  const [failMsg, setFailMsg] = useState('demo failure');

  // 进入页面自动拉取 manifest（服务端脚本自描述）
  useEffect(() => {
    callScript<SdkManifest>('manifest').then((res) => {
      if (res.ok) {
        const parsed = tryParse(res.data);
        setManifest(parsed as SdkManifest);
      } else {
        setManifestErr(res.error ?? 'manifest 拉取失败');
      }
    }).catch((e: unknown) => setManifestErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const run = useCallback(async (fn: string, title: string, params?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await callScript(fn, params);
      setModal({ title: `${fn} — ${title}`, ok: res.ok, data: res.data, error: res.error });
    } catch (e) {
      setModal({ title, ok: false, data: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    setListErr(null);
    try {
      const res = await api.get<{ plugins: { pluginId: string; functions: string[] }[] }>('/plugin/list');
      setList(res.plugins);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* 运行方式 */}
      <Alert status="accent">
        <Alert.Content>
          <Alert.Title>如何驱动 service/main.cs</Alert.Title>
          <Alert.Description>
            POST /api/plugin/&lt;pluginId&gt;/&lt;fn&gt;，body 任意 JSON 会变成脚本函数的 p（dynamic）；
            返回 {'{ ok:true, data }'}；脚本抛异常返回 {'{ ok:false, error }'}。编译结果按插件缓存，文件变更自动失效。
            函数是同步签名，内部可用 .GetAwaiter().GetResult() 等待异步（如 HttpClient）。
          </Alert.Description>
        </Alert.Content>
      </Alert>

      {/* 自描述目录 */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold">服务端函数目录（manifest 实时拉取）</h3>
          {busy && <Spinner size="sm" />}
          {manifest && <Chip size="sm" variant="secondary">已调用 {manifest.callCount} 次</Chip>}
        </div>
        {manifestErr && <p className="text-danger text-sm mb-2">{manifestErr}（服务端可能未重启/未启用插件）</p>}
        {manifest ? (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="script funcs" className="min-w-[720px]">
                <Table.Header>
                  <Table.Column isRowHeader>函数</Table.Column>
                  <Table.Column>说明</Table.Column>
                  <Table.Column>可选项（参数）</Table.Column>
                </Table.Header>
                <Table.Body>
                  {manifest.funcs.map((f, i) => (
                    <Table.Row key={f.name} id={`sf-${i}`}>
                      <Table.Cell><code className="font-mono text-xs">{f.name}</code></Table.Cell>
                      <Table.Cell className="text-sm">{f.desc}</Table.Cell>
                      <Table.Cell className="text-sm text-default-500">
                        {f.options.length === 0 ? <span className="text-default-400">无</span> : (
                          <div className="flex flex-wrap gap-1">
                            {f.options.map((o) => (
                              <Chip key={o.name} size="sm" variant={o.optional ? 'soft' : 'secondary'}>
                                {o.name}{o.optional ? (o.default ? `=${o.default}` : '?') : '*'}
                              </Chip>
                            ))}
                          </div>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        )}
      </Card>

      {/* 逐个函数演练 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">逐个函数演练（每个函数 = 一个能力点）</h3>
        <Accordion className="w-full">
          <Tool title="echo — 动态参数访问" desc="body 任意字段以 p.字段 读取，支持嵌套"
            fields={(
              <div className="flex flex-wrap gap-2">
                <Input value={echoText} onChange={(e) => setEchoText((e.target as HTMLInputElement).value)} placeholder="text" className="w-48" />
                <Input value={echoCount} onChange={(e) => setEchoCount((e.target as HTMLInputElement).value)} placeholder="count" className="w-24" />
              </div>
            )}
            run={() => run('echo', '参数原样回显', { text: echoText, count: Number(echoCount) || 0, nested: { deep: [1, 2, 3], ok: true } })} />
          <Tool title="now — 时间格式化" desc="可选项 format / utc"
            fields={(
              <div className="flex flex-wrap items-end gap-2">
                <Input value={nowFormat} onChange={(e) => setNowFormat((e.target as HTMLInputElement).value)} placeholder="format" className="w-56" />
                <Switch isSelected={nowUtc} onChange={setNowUtc}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  <span className="text-sm">UTC</span>
                </Switch>
              </div>
            )}
            run={() => run('now', '时间格式化', { format: nowFormat, utc: nowUtc ? 1 : 0 })} />
          <Tool title="bkn — 签名计算" desc="纯数学计算（bkn/g_tk 算法），可选项 skey"
            fields={(
              <Input value={skey} onChange={(e) => setSkey((e.target as HTMLInputElement).value)} placeholder="skey" className="w-64" />
            )}
            run={() => run('bkn', 'bkn 计算', { skey })} />
          <Tool title="state — 跨调用内存状态" desc="静态字段随脚本编译缓存保留（服务重启清零）"
            fields={null}
            run={() => run('state', '状态演示', {})} />
          <Tool title="ip — 服务端网络请求" desc="GET 外网 IP（服务端发起，无 CORS）"
            fields={null}
            run={() => run('ip', '外网 IP', {})} />
          <Tool title="http — 通用 HTTP 请求" desc="可选项 url / method / headers / body / timeoutSec"
            fields={(
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Input value={httpUrl} onChange={(e) => setHttpUrl((e.target as HTMLInputElement).value)} placeholder="url" className="w-96" />
                  <Input value={httpMethod} onChange={(e) => setHttpMethod((e.target as HTMLInputElement).value)} placeholder="method" className="w-24" />
                  <Input value={httpTimeout} onChange={(e) => setHttpTimeout((e.target as HTMLInputElement).value)} placeholder="timeoutSec" className="w-24" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <TextArea value={httpHeaders} onChange={(e) => setHttpHeaders((e.target as HTMLTextAreaElement).value)} placeholder='headers JSON，如 {"X-Demo":"1"}' rows={2} className="w-96" />
                  <TextArea value={httpBody} onChange={(e) => setHttpBody((e.target as HTMLTextAreaElement).value)} placeholder="body JSON（POST/PUT 时发送）" rows={2} className="w-96" />
                </div>
              </div>
            )}
            run={() => {
              let headers: Record<string, unknown> | undefined;
              let body: unknown;
              try { headers = httpHeaders.trim() ? JSON.parse(httpHeaders) : undefined; } catch { /* 原样忽略 */ }
              try { body = httpBody.trim() ? JSON.parse(httpBody) : undefined; } catch { body = httpBody; }
              run('http', 'HTTP 请求', { url: httpUrl, method: httpMethod, headers, body, timeoutSec: Number(httpTimeout) || 15 });
            }} />
          <Tool title="file — 读取包内文件" desc="数据/配置随 zip 分发，脚本按插件目录定位"
            fields={(
              <Input value={fileName} onChange={(e) => setFileName((e.target as HTMLInputElement).value)} placeholder="包内相对路径" className="w-64" />
            )}
            run={() => run('file', '包内文件', { name: fileName })} />
          <Tool title="list — 返回数组" desc="可选项 count / prefix"
            fields={(
              <div className="flex flex-wrap gap-2">
                <Input value={listCount} onChange={(e) => setListCount((e.target as HTMLInputElement).value)} placeholder="count" className="w-24" />
                <Input value={listPrefix} onChange={(e) => setListPrefix((e.target as HTMLInputElement).value)} placeholder="prefix" className="w-32" />
              </div>
            )}
            run={() => run('list', '数组返回', { count: Number(listCount) || 5, prefix: listPrefix })} />
          <Tool title="table — 返回对象数组" desc="前端 Table 直接渲染，可选项 rows / prefix"
            fields={(
              <div className="flex flex-wrap gap-2">
                <Input value={tableRows} onChange={(e) => setTableRows((e.target as HTMLInputElement).value)} placeholder="rows" className="w-24" />
                <Input value={tablePrefix} onChange={(e) => setTablePrefix((e.target as HTMLInputElement).value)} placeholder="prefix" className="w-32" />
              </div>
            )}
            run={() => run('table', '表格数据', { rows: Number(tableRows) || 3, prefix: tablePrefix })} />
          <Tool title="fail — 抛异常（错误契约）" desc="宿主统一转 { ok:false, error }"
            fields={(
              <Input value={failMsg} onChange={(e) => setFailMsg((e.target as HTMLInputElement).value)} placeholder="message" className="w-64" />
            )}
            run={() => run('fail', '错误契约', { message: failMsg })} />
        </Accordion>
      </Card>

      {/* 已启用插件的服务端脚本列表 */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-semibold">GET /api/plugin/list — 已导入且含 service/main.cs 的插件</h3>
          <Button size="sm" variant="secondary" onPress={loadList}>加载</Button>
        </div>
        {listErr && <p className="text-danger text-sm mb-2">{listErr}</p>}
        {list && (
          list.length === 0 ? (
            <p className="text-sm text-default-500">没有插件带 service/main.cs。</p>
          ) : (
            <div className="divide-y divide-default-100">
              {list.map((p) => (
                <div key={p.pluginId} className="py-2 flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-xs">{p.pluginId}</code>
                  {p.functions.map((f) => <Chip key={f} size="sm" variant="soft">{f}</Chip>)}
                </div>
              ))}
            </div>
          )
        )}
      </Card>

      {/* 结果模态框 */}
      <Modal.Backdrop isOpen={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading className="font-mono text-base">{modal?.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {modal && (
                <div className="space-y-3">
                  <Alert status={modal.ok ? 'success' : 'danger'}>
                    <Alert.Content>
                      <Alert.Title>{modal.ok ? '调用成功' : '调用失败'}</Alert.Title>
                      {modal.error && <Alert.Description>{modal.error}</Alert.Description>}
                    </Alert.Content>
                  </Alert>
                  <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-default-50 dark:bg-default-900 p-3 rounded max-h-[60vh] overflow-auto">
                    {pretty(modal.data)}
                  </pre>
                </div>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

// ── 4. 前端 API：宿主 / api client / 管理 / 市场 ──────────────────────

const HOST_API: { member: string; desc: string; sample: string }[] = [
  { member: 'selectedAgent', desc: '当前选中的设备（与控制台顶部选择器共享）', sample: 'selectedAgent?.hostname' },
  { member: 'selectAgent(id)', desc: '切换选中设备（与主控制台联动）', sample: 'selectAgent(agentId)' },
  { member: 'dispatchTask(pluginId, action, args?, agentId?)', desc: '调用插件动作 → Agent 内存执行模块', sample: "dispatchTask('com.example.plugin-sdk', 'showcase', { capability: 'fs' })" },
  { member: 'subscribeOutput(cb, action?)', desc: '订阅 WS 实时推送（可选按 action 过滤），返回退订函数', sample: "subscribeOutput(o => setX(o.data), 'showcase')" },
  { member: 'lastOutput', desc: '最近一条 plugin.result 推送（便捷读取）', sample: 'lastOutput?.data' },
];

const CLIENT_API: { member: string; desc: string; sample: string }[] = [
  { member: 'api.get(path)', desc: 'GET，自动带 JWT', sample: "api.get('/plugins/manager')" },
  { member: 'api.post(path, body?)', desc: 'POST JSON', sample: "api.post('/plugin/com.example.plugin-sdk/echo', { text: 'hi' })" },
  { member: 'api.put(path, body?)', desc: 'PUT JSON', sample: "api.put('/plugins/manager/<id>', { meta })" },
  { member: 'api.delete(path)', desc: 'DELETE', sample: "api.delete('/plugins/manager/<id>')" },
  { member: 'API_ORIGIN', desc: '后端地址（VITE_API_BASE 或默认 5270）', sample: 'http://127.0.0.1:5270' },
];

function FrontendApiTab() {
  const { selectedAgent, lastOutput } = usePluginHost();
  const [plugins, setPlugins] = useState<PluginRecord[] | null>(null);
  const [pluginsErr, setPluginsErr] = useState<string | null>(null);
  const [market, setMarket] = useState<{ data: PluginRegistryIndex; fromCache: boolean } | null>(null);
  const [marketErr, setMarketErr] = useState<string | null>(null);
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketMsg, setMarketMsg] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
    setPluginsErr(null);
    try { setPlugins(await listPlugins()); } catch (e) { setPluginsErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  const loadMarket = useCallback(async () => {
    setMarketBusy(true);
    setMarketErr(null);
    setMarketMsg(null);
    try {
      // 与 getPluginRegistry 相同的缓存判定：fresh 缓存存在 → 将直接从 localStorage 返回
      let fromCache = false;
      try {
        const raw = localStorage.getItem('libra.plugin.registry');
        if (raw) { const j = JSON.parse(raw) as { ts: number }; fromCache = Date.now() - j.ts < 60 * 60 * 1000; }
      } catch { /* ignore */ }
      const data = await getPluginRegistry();
      setMarket({ data, fromCache });
    } catch (e) {
      setMarketErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMarketBusy(false);
    }
  }, []);

  const clearMarketCache = useCallback(() => {
    localStorage.removeItem('libra.plugin.registry');
    setMarket(null);
    setMarketMsg('缓存已清除（libra.plugin.registry），下次加载将重新拉取');
  }, []);

  const install = useCallback(async (file: string) => {
    setMarketMsg(null);
    try {
      const rec = await installPluginFromRegistry(file);
      setMarketMsg(`安装成功：${rec.name} v${rec.version}`);
    } catch (e) {
      setMarketErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* 宿主 API */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">usePluginHost() — 页面宿主 API</h3>
        <div className="divide-y divide-default-100">
          {HOST_API.map((h) => (
            <div key={h.member} className="py-2">
              <code className="font-mono text-xs">{h.member}</code>
              <p className="text-sm text-default-500 mt-0.5">{h.desc}</p>
              <pre className="text-[11px] font-mono bg-default-50 dark:bg-default-900 rounded px-2 py-1 mt-1 overflow-auto">{h.sample}</pre>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-default-500">当前状态：</span>
          {selectedAgent
            ? <Chip size="sm" color="success">{selectedAgent.hostname} ({selectedAgent.ipAddress})</Chip>
            : <Chip size="sm" color="warning">未选择设备</Chip>}
          {lastOutput && (
            <Chip size="sm" variant="soft">lastOutput: {pretty(lastOutput.data).slice(0, 60)}{pretty(lastOutput.data).length > 60 ? '…' : ''}</Chip>
          )}
        </div>
      </Card>

      {/* api client */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">api client（自动带 JWT，出错抛异常）</h3>
        <div className="divide-y divide-default-100">
          {CLIENT_API.map((c) => (
            <div key={c.member} className="py-2">
              <code className="font-mono text-xs">{c.member}</code>
              <p className="text-sm text-default-500 mt-0.5">{c.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-default-400 mt-2">当前 API_ORIGIN：<code className="font-mono">{API_ORIGIN}</code></p>
      </Card>

      {/* 插件管理 */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-semibold">插件管理 API（listPlugins / toggle / update / delete）</h3>
          <Button size="sm" variant="secondary" onPress={loadPlugins}>加载已装插件</Button>
        </div>
        {pluginsErr && <p className="text-danger text-sm mb-2">{pluginsErr}</p>}
        {plugins && (
          plugins.length === 0 ? (
            <p className="text-sm text-default-500">暂无插件。</p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="installed plugins" className="min-w-[640px]">
                  <Table.Header>
                    <Table.Column isRowHeader>pluginId</Table.Column>
                    <Table.Column>名称</Table.Column>
                    <Table.Column>版本</Table.Column>
                    <Table.Column>状态</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {plugins.map((p, i) => (
                      <Table.Row key={p.pluginId} id={`pl-${i}`}>
                        <Table.Cell><code className="font-mono text-xs">{p.pluginId}</code></Table.Cell>
                        <Table.Cell className="text-sm">{p.name}</Table.Cell>
                        <Table.Cell className="font-mono text-xs">{p.version}</Table.Cell>
                        <Table.Cell>{p.enabled ? <Chip size="sm" color="success">enabled</Chip> : <Chip size="sm" color="danger" variant="soft">disabled</Chip>}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )
        )}
        <p className="text-xs text-default-400 mt-2">
          变更类操作示例（本页不实际执行）：togglePlugin(id, enabled) · updatePlugin(id, meta) ·
          deletePlugin(id) · importPlugin(file, enable) · importPluginFromGit(gitUrl, enable)
        </p>
      </Card>

      {/* 插件市场 */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h3 className="font-semibold">插件市场（GitHub raw 直连 + localStorage 1h 缓存）</h3>
          <Button size="sm" variant="secondary" isPending={marketBusy} onPress={loadMarket}>加载市场</Button>
          <Button size="sm" variant="tertiary" onPress={clearMarketCache}>清缓存</Button>
        </div>
        <p className="text-sm text-default-500 mb-2">
          索引 <code className="font-mono text-xs">index.json</code> 直接从 GitHub raw 拉取；结果缓存到浏览器
          <code className="font-mono text-xs"> libra.plugin.registry</code>，60 分钟内重复访问不再联网。
        </p>
        {marketErr && <p className="text-danger text-sm mb-2">{marketErr}</p>}
        {marketMsg && <p className="text-success text-sm mb-2">{marketMsg}</p>}
        {market && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Chip size="sm" variant={market.fromCache ? 'soft' : 'secondary'}>
                来源：{market.fromCache ? 'localStorage 缓存' : '网络拉取'}
              </Chip>
              <Chip size="sm" variant="soft">生成于 {new Date(market.data.generatedAt).toLocaleString()}</Chip>
              <Chip size="sm" variant="soft">{market.data.pluginCount} 个插件</Chip>
            </div>
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="market" className="min-w-[720px]">
                  <Table.Header>
                    <Table.Column isRowHeader>pluginId</Table.Column>
                    <Table.Column>名称</Table.Column>
                    <Table.Column>版本</Table.Column>
                    <Table.Column>大小</Table.Column>
                    <Table.Column>操作</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {market.data.plugins.map((p, i) => (
                      <Table.Row key={p.pluginId} id={`mk-${i}`}>
                        <Table.Cell><code className="font-mono text-xs">{p.pluginId}</code></Table.Cell>
                        <Table.Cell className="text-sm">{p.name}</Table.Cell>
                        <Table.Cell className="font-mono text-xs">{p.version}</Table.Cell>
                        <Table.Cell className="font-mono text-xs">{(p.size / 1024).toFixed(1)} KB</Table.Cell>
                        <Table.Cell>
                          <Button size="sm" variant="primary" onPress={() => install(p.file)}>安装</Button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── 5. HeroUI 组件画廊（每个组件标注可选项）────────────────────────────

function HeroUiTab() {
  const [switchOn, setSwitchOn] = useState(true);
  const [checkOn, setCheckOn] = useState(true);
  const [input, setInput] = useState('');
  const [sliderVal, setSliderVal] = useState(42);
  const [comboVal, setComboVal] = useState<string | null>('script');
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState<string | null>('a1');

  return (
    <div className="space-y-4">
      <GallerySection title="Button" note="可选项：variant（primary/secondary/tertiary，部分版本另含 ghost/outline/soft/danger）、size（sm/md/lg）、isDisabled、isPending、isIconOnly">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">primary</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="tertiary">tertiary</Button>
          <Button variant="primary" size="sm">sm</Button>
          <Button variant="primary" isDisabled>disabled</Button>
          <Button variant="primary" isPending>pending</Button>
          <Button variant="secondary" isIconOnly aria-label="icon only">⚙</Button>
        </div>
      </GallerySection>

      <GallerySection title="Chip / Badge" note="Chip 可选项：variant（secondary/soft/tertiary/primary）、color（default/accent/success/warning/danger）、size">
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant="secondary">secondary</Chip>
          <Chip variant="soft">soft</Chip>
          <Chip variant="tertiary">tertiary</Chip>
          <Chip color="success">success</Chip>
          <Chip color="warning">warning</Chip>
          <Chip color="danger" variant="soft">danger</Chip>
          <Badge>badge</Badge>
        </div>
      </GallerySection>

      <GallerySection title="Input / TextField / TextArea" note="TextField 可选项：variant（secondary 等）；Input/TextArea 均可控（value/onChange）">
        <div className="flex flex-col gap-3 max-w-xl">
          <TextField variant="secondary">
            <Label>文本框</Label>
            <Input variant="secondary" value={input} onChange={(e) => setInput((e.target as HTMLInputElement).value)} placeholder="placeholder 提示" />
          </TextField>
          <TextArea placeholder="多行文本" rows={2} />
        </div>
      </GallerySection>

      <GallerySection title="Switch / Checkbox" note="Switch：isSelected + onChange；子元素可放说明文字（需配 Control/Thumb）">
        <div className="flex flex-wrap items-center gap-6">
          <Switch isSelected={switchOn} onChange={setSwitchOn}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
            <span className="text-sm">开关：{switchOn ? '开' : '关'}</span>
          </Switch>
          <Checkbox isSelected={checkOn} onChange={setCheckOn}>
            复选框：{checkOn ? '已勾选' : '未勾选'}
            <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
          </Checkbox>
        </div>
      </GallerySection>

      <GallerySection title="ComboBox" note="可选项：selectedKey / onSelectionChange / placeholder（放内层 Input 上）；结构 InputGroup + Trigger + Popover + ListBox">
        <ComboBox className="w-64" selectedKey={comboVal} onSelectionChange={(k) => setComboVal(String(k ?? ''))}>
          <Label>选择模块通道</Label>
          <ComboBox.InputGroup>
            <Input placeholder="搜索通道…" />
            <ComboBox.Trigger />
          </ComboBox.InputGroup>
          <ComboBox.Popover>
            <ListBox aria-label="channels">
              {['script', 'native'].map((c) => (
                <ListBox.Item key={c} id={c} textValue={c}>
                  <span className="font-mono">{c}</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>
      </GallerySection>

      <GallerySection title="Slider" note="可选项：minValue / maxValue / step / value / onChange；结构 Output + Track + Fill + Thumb">
        <Slider
          className="w-full max-w-xs"
          value={sliderVal}
          minValue={0}
          maxValue={100}
          step={1}
          onChange={(v) => setSliderVal((Array.isArray(v) ? v[0] : v) ?? 0)}
        >
          <Label>数值：{sliderVal}</Label>
          <Slider.Output />
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </GallerySection>

      <GallerySection title="ProgressCircle / Spinner / Skeleton" note="ProgressCircle：value（0-100）；Spinner：size（sm/md/lg）；Skeleton：className 控制形状">
        <div className="flex flex-wrap items-center gap-4">
          <ProgressCircle value={70} />
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" />
          <div className="w-40 space-y-2">
            {showSkeleton ? (
              <>
                <Skeleton className="h-6 rounded-lg" />
                <Skeleton className="h-6 rounded-lg w-3/4" />
                <Skeleton className="h-6 rounded-lg w-1/2" />
              </>
            ) : <p className="text-sm text-default-500">已隐藏（点下面按钮）</p>}
            <Button size="sm" variant="tertiary" onPress={() => setShowSkeleton((v) => !v)}>切换 Skeleton</Button>
          </div>
        </div>
      </GallerySection>

      <GallerySection title="Alert" note="可选项：status（default/accent/success/warning/danger）；结构 Content + Title + Description">
        <div className="space-y-2">
          <Alert status="accent"><Alert.Content><Alert.Title>accent</Alert.Title><Alert.Description>提示信息</Alert.Description></Alert.Content></Alert>
          <Alert status="success"><Alert.Content><Alert.Title>success</Alert.Title><Alert.Description>操作成功</Alert.Description></Alert.Content></Alert>
          <Alert status="warning"><Alert.Content><Alert.Title>warning</Alert.Title><Alert.Description>需要注意</Alert.Description></Alert.Content></Alert>
          <Alert status="danger"><Alert.Content><Alert.Title>danger</Alert.Title><Alert.Description>发生错误</Alert.Description></Alert.Content></Alert>
        </div>
      </GallerySection>

      <GallerySection title="Tooltip / Dropdown" note="Tooltip：delay / isDisabled；Content 可 placement。Dropdown：Trigger 任意元素 + Popover + Menu + Item">
        <div className="flex flex-wrap items-center gap-4">
          <Tooltip delay={0}>
            <Button variant="secondary">悬停我</Button>
            <Tooltip.Content placement="top"><p>tooltip 内容（placement 可选项）</p></Tooltip.Content>
          </Tooltip>
          <Dropdown>
            <Button variant="secondary">下拉菜单</Button>
            <Dropdown.Popover>
              <Dropdown.Menu onAction={(key) => alert(`选择了 ${key}`)}>
                <Dropdown.Item key="a" id="a" textValue="选项 A">选项 A</Dropdown.Item>
                <Dropdown.Item key="b" id="b" textValue="选项 B">选项 B</Dropdown.Item>
                <Dropdown.Item key="c" id="c" textValue="危险项" className="text-danger">危险项</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </GallerySection>

      <GallerySection title="Tabs" note="受控：selectedKey / onSelectionChange；结构 ListContainer + List + Tab（内含 Indicator）+ Panel">
        <Tabs selectedKey={accordionOpen === 'a1' ? 't1' : 't2'} onSelectionChange={(k) => { /* 演示受控 */ }}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="mini tabs">
              <Tabs.Tab id="t1">页签一<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="t2">页签二<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel id="t1"><p className="text-sm text-default-500">页签一内容</p></Tabs.Panel>
          <Tabs.Panel id="t2"><p className="text-sm text-default-500">页签二内容</p></Tabs.Panel>
        </Tabs>
      </GallerySection>

      <GallerySection title="Accordion" note="受控：expandedKeys / onExpandedChange；结构 Item + Heading + Trigger（含 Indicator）+ Panel + Body">
        <Accordion
          className="w-full max-w-xl"
          expandedKeys={accordionOpen ? new Set([accordionOpen]) : new Set()}
          onExpandedChange={(keys) => setAccordionOpen(Array.from(keys as Set<string>)[0] ?? null)}
        >
          <Accordion.Item key="a1">
            <Accordion.Heading>
              <Accordion.Trigger>
                <span className="font-semibold">第一项</span>
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body><p className="text-sm text-default-500">第一项内容</p></Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item key="a2">
            <Accordion.Heading>
              <Accordion.Trigger>
                <span className="font-semibold">第二项</span>
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body><p className="text-sm text-default-500">第二项内容</p></Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </GallerySection>

      <GallerySection title="Table" note="结构 ScrollContainer + Content + Header + Column（isRowHeader）+ Body + Row（id）+ Cell">
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="mini table" className="min-w-[480px]">
              <Table.Header>
                <Table.Column isRowHeader>名称</Table.Column>
                <Table.Column>状态</Table.Column>
              </Table.Header>
              <Table.Body>
                {[{ n: '能力 A', s: 'online' }, { n: '能力 B', s: 'offline' }].map((r, i) => (
                  <Table.Row key={r.n} id={`tb-${i}`}>
                    <Table.Cell>{r.n}</Table.Cell>
                    <Table.Cell>{r.s}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </GallerySection>

      <GallerySection title="Surface + ListBox + Avatar" note="带头像列表（适合联系人/群组）；Item 内 Avatar.Image/Fallback + Label + Description + ItemIndicator">
        <Surface className="w-[320px] rounded-3xl shadow-surface">
          <ListBox aria-label="users" selectionMode="multiple">
            <ListBox.Item id="1" textValue="Bob">
              <Avatar size="sm">
                <Avatar.Image alt="Bob" src="https://heroui-assets.nyc3.cdn.digitaloceanspaces.com/avatars/blue.jpg" />
                <Avatar.Fallback>B</Avatar.Fallback>
              </Avatar>
              <div className="flex flex-col">
                <Label>Bob</Label>
                <Description>bob@heroui.com</Description>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
            <ListBox.Item id="2" textValue="Fred">
              <Avatar size="sm">
                <Avatar.Image alt="Fred" src="https://heroui-assets.nyc3.cdn.digitaloceanspaces.com/avatars/green.jpg" />
                <Avatar.Fallback>F</Avatar.Fallback>
              </Avatar>
              <div className="flex flex-col">
                <Label>Fred</Label>
                <Description>fred@heroui.com</Description>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          </ListBox>
        </Surface>
      </GallerySection>

      <GallerySection title="Modal / Kbd / Link / Card" note="Modal：Backdrop(isOpen/onOpenChange) + Container(size) + Dialog + CloseTrigger + Header/Heading/Body；Kbd 可放组合键；Link target=_blank">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onPress={() => setModalOpen(true)}>打开模态框</Button>
          <Kbd>Ctrl + C</Kbd>
          <Link href="https://heroui.com/cn/docs/react/components" target="_blank">HeroUI 组件文档（新窗口）</Link>
        </div>
      </GallerySection>

      <Modal.Backdrop isOpen={modalOpen} onOpenChange={(open) => { if (!open) setModalOpen(false); }}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header><Modal.Heading>模态框演示</Modal.Heading></Modal.Header>
            <Modal.Body>
              <p className="text-sm text-default-500">
                模态框可选项：Container size（sm/md/lg/xl）、Backdrop isOpen/onOpenChange。
                结果类内容（如 QQ 好友列表、服务端脚本返回值）都用它渲染。
              </p>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

// ── 通用小组件 ─────────────────────────────────────────────────────────

function GallerySection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold">{title}</h3>
      {note && <p className="text-sm text-default-500 mb-3 mt-0.5">{note}</p>}
      {children}
    </Card>
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

/** 一个可展开的演练工具（Accordion 项）。 */
function Tool({ title, desc, fields, run }: {
  title: string; desc: string; fields: ReactNode | null; run: () => void | Promise<void>;
}) {
  return (
    <Accordion.Item key={title}>
      <Accordion.Heading>
        <Accordion.Trigger>
          <span className="font-semibold">{title}</span>
          <span className="text-xs text-default-500 ml-2">{desc}</span>
          <Accordion.Indicator />
        </Accordion.Trigger>
      </Accordion.Heading>
      <Accordion.Panel>
        <Accordion.Body>
          <div className="space-y-2">
            {fields}
            <Button size="sm" variant="primary" onPress={run}>执行</Button>
          </div>
        </Accordion.Body>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
