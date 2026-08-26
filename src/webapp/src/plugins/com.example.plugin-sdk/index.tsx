import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Accordion, Alert, Button, Card, Chip, ComboBox, Description, Input, Label, ListBox,
  Modal, ProgressCircle, Skeleton, Spinner, Switch, Table, Tabs, TextArea, TextField, Tooltip,
} from '@heroui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usePluginHost, type PluginOutput } from '../../hooks/usePluginHost';
import { api, API_ORIGIN } from '../../api/client';
import { listPlugins, type PluginRecord } from '../../api/plugins';

/**
 * 插件 SDK 全能力演示（活文档）。
 *
 * 本页同时是【示例】和【文档】：把插件作者能用的所有宿主 API、组件与
 * 可选项都真实渲染出来，作者照着抄即可。分五个页签：
 *   1. 总览        —— 三层架构 / 包目录结构 / 接入流程（简版，详见文档页签）
 *   2. 文档        —— 活文档：在线拉取 assets/docs/*.md 渲染（随 zip 分发）
 *   3. Agent 端    —— JS 能力目录 + 实时执行（dispatchTask + WS 推送）
 *   4. 服务端脚本  —— service/*.cs 全函数目录 + 实时调用（/api/plugin/*）
 *   5. 前端 API    —— usePluginHost / api client / 插件管理
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

/** 插件包内静态资源端点（与 com.libra.aitoken 的 assets 用法一致，匿名可访问）。 */
function assetUrl(file: string): string {
  return `${API_ORIGIN}/api/plugins/${SDK_ID}/assets/${file}`;
}

/** 在包内 assets/docs/ 下按文件名顺序加载六篇文档。 */
const DOC_FILES: { id: string; label: string; file: string }[] = [
  { id: '01', label: '总览', file: 'docs/01-overview.md' },
  { id: '02', label: '插件契约', file: 'docs/02-plugin-contract.md' },
  { id: '03', label: 'Agent JS API', file: 'docs/03-agent-js-api.md' },
  { id: '04', label: '服务端脚本', file: 'docs/04-server-script.md' },
  { id: '05', label: '前端宿主', file: 'docs/05-frontend-host.md' },
  { id: '06', label: '打包发布', file: 'docs/06-pack-publish.md' },
];

const DIR_TREE = `com.example.plugin-sdk/
├── meta.json               # 插件契约（必需）
├── module/                 # Agent 端模块
│   └── plugin_sdk.js       #   script 通道：JS 源码，QuickJS 内存执行
├── service/                # 服务端逻辑（C# 脚本，随包分发）
│   ├── sdk_utils.cs        #   工具类/静态状态（按文件名排序，先拼接）
│   └── main.cs             #   导出函数（末尾 return Dictionary）
├── page/                   # 前端页面源码（分发用，需重建前端）
│   └── index.tsx
├── assets/                 # 静态资源（经 /api/plugins/<id>/assets/ 动态加载）
│   └── docs/               #   活文档（markdown，本页「文档」页签在线渲染）
├── data/                   # 随包分发的数据/配置文件（脚本 file 函数可读）
└── README.md               # 插件说明`;

const STEPS: [string, string][] = [
  ['建包', '写好 meta.json + module/（script 或 native）+ service/*.cs + page/index.tsx，npm run pack 打成 zip'],
  ['导入', '控制台 → 插件管理 → 上传插件 / 从 Git 导入 / 从市场安装'],
  ['启用', '插件登记到后端，动作可下发到 Agent'],
  ['写页面', 'src/webapp/src/plugins/<pluginId>/index.tsx（import.meta.glob 收集，需重建前端）'],
  ['调 Agent', '页面里 usePluginHost().dispatchTask(pluginId, action, args)'],
  ['调服务', '页面里 api.post(\'/plugin/<pluginId>/<fn>\', params) 驱动 service/*.cs'],
  ['发布', '把 zip 提交到 Libra-Plugins 仓库 plugins/<pluginId>/，CI 生成 index.json 即上架市场'],
];

// ── Agent 能力清单（与 module/plugin_sdk.js 的 capability 分支一致）──
const AGENT_CAPS: { value: string; label: string; desc: string; needsCommand?: boolean }[] = [
  { value: 'whoami', label: 'whoami', desc: '当前用户' },
  { value: 'fs', label: 'fs', desc: '文件系统：写 /tmp/libra_sdk_probe.txt → 读 → 列目录 → 存在性' },
  { value: 'proc', label: 'proc', desc: '进程列表 + PATH 环境变量' },
  { value: 'network', label: 'network', desc: '网络信息（按平台自动选命令）' },
  { value: 'system', label: 'system', desc: '系统信息（按平台自动选命令）' },
  { value: 'env', label: 'env', desc: '环境变量集合 + 当前用户（新增）' },
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
  ['__platform()', '运行时平台分支："windows"|"linux"|"macos"|"unknown"'],
];

const WINDOWS_API: [string, string][] = [
  ['cmd(cmdline)', '执行 CMD 命令'],
  ['powershell(script)', '进程内 CLR 执行 PowerShell（无 powershell.exe 进程）'],
  ['reg_query(key, name)', '查询注册表值'],
  ['reg_set(key, name, data)', '写注册表值，返回 bool'],
  ['reg_delete(key, name)', '删注册表值，返回 bool'],
  ['ipconfig()', '网络配置（/all）'],
  ['wmic(query)', '执行 WMIC 查询（Win11 24H2 已移除，注意空返回）'],
  ['tasklist()', '任务列表'],
];

const LINUX_API: [string, string][] = [
  ['shell(cmdline)', '执行 /bin/sh -c'],
  ['bash(script)', '执行 /bin/bash -c'],
  ['uname()', '内核/主机/架构（uname -a）'],
  ['ip_route()', '网络接口/IP，等价 ip addr'],
  ['ss(path)', '读 /proc 或 /sys 文件'],
  ['hostname()', '主机名'],
  ['dns()', '/etc/resolv.conf'],
];

// ── 主页面 ─────────────────────────────────────────────────────────────

export default function PluginSdkPage() {
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">插件开发 SDK 示例（全能力演示）</h1>
        <p className="text-sm text-default-500 mt-1">
          这是一个"活文档"插件：五个页签覆盖插件能用的所有能力与可选项 —— Agent 端
          <code className="font-mono text-xs">module/plugin_sdk.js</code>（QuickJS，多平台）、服务端
          <code className="font-mono text-xs">service/*.cs</code>（C# 脚本多文件，经
          <code className="font-mono text-xs">/api/plugin/com.example.plugin-sdk/&lt;fn&gt;</code> 驱动）、
          前端 <code className="font-mono text-xs">page/index.tsx</code>（HeroUI + usePluginHost +
          在线文档渲染）。
        </p>
      </Card>

      <Tabs defaultSelectedKey="overview" className="w-full">
        <Tabs.ListContainer>
          <Tabs.List aria-label="sdk sections">
            <Tabs.Tab id="overview">总览<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="docs">文档<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="agent">Agent 端<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="service">服务端脚本<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="frontend">前端 API<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="overview"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel id="docs"><DocsTab /></Tabs.Panel>
        <Tabs.Panel id="agent"><AgentTab /></Tabs.Panel>
        <Tabs.Panel id="service"><ServiceTab /></Tabs.Panel>
        <Tabs.Panel id="frontend"><FrontendApiTab /></Tabs.Panel>
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
            <li>script 通道：.js 源码，QuickJS 内存执行，无需编译</li>
            <li>native 通道：Rust cdylib，按平台目录分发（x64/x86/linux-x64）</li>
            <li>能力：文件/进程/环境/Shell/注册表/网络/系统信息…</li>
            <li>__platform() 运行时平台分支（无需 #if 预处理）</li>
          </ul>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Chip size="sm" color="warning">服务端</Chip>
            <h3 className="font-semibold">service/*.cs</h3>
          </div>
          <ul className="text-sm text-default-500 mt-2 space-y-1 list-disc list-inside">
            <li>随包分发的 C# 脚本（Roslyn 解析执行，多文件拼接编译）</li>
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
            <li>活文档在线渲染（assets/docs/*.md + react-markdown）</li>
            <li>源码分发：import.meta.glob 构建期收集，需重建前端</li>
          </ul>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">插件包目录结构</h3>
        <pre className="text-xs font-mono overflow-auto bg-default-50 dark:bg-default-900 p-3 rounded">{DIR_TREE}</pre>
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
            完整文档见「文档」页签（assets/docs/*.md 随包分发，在线渲染）。
          </Alert.Description>
        </Alert.Content>
      </Alert>
    </div>
  );
}

// ── 2. 文档：活文档在线渲染 ───────────────────────────────────────────

function DocsTab() {
  const [docId, setDocId] = useState(DOC_FILES[0]?.id ?? '01');
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: string) => {
    const doc = DOC_FILES.find((d) => d.id === id);
    if (!doc) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(assetUrl(doc.file));
      if (!res.ok) throw new Error(`加载失败：HTTP ${res.status}`);
      setMd(await res.text());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMd(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(docId);
  }, [docId, load]);

  return (
    <div className="space-y-4">
      <Alert status="accent">
        <Alert.Content>
          <Alert.Title>活文档（随 zip 分发）</Alert.Title>
          <Alert.Description>
            六篇 markdown 存放在插件包 <code className="font-mono text-xs">assets/docs/</code>，
            经 <code className="font-mono text-xs">/api/plugins/com.example.plugin-sdk/assets/docs/&lt;file&gt;</code>
            在线拉取渲染（react-markdown + remark-gfm）。文档只写一份，页面与仓库共用 ——
            改文档 → 重新打包 → 刷新页面即可，无需重建前端。
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <Card className="p-2 self-start">
          <div className="flex flex-col gap-1">
            {DOC_FILES.map((d) => (
              <Button
                key={d.id}
                variant={docId === d.id ? 'primary' : 'tertiary'}
                size="sm"
                className="justify-start"
                onPress={() => setDocId(d.id)}
              >
                <span className="font-mono">{d.id}</span>
                <span className="ml-2">{d.label}</span>
              </Button>
            ))}
          </div>
        </Card>

        <Card className="p-5 min-w-0">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-8 rounded-lg w-1/2" />
              <Skeleton className="h-5 rounded-lg" />
              <Skeleton className="h-5 rounded-lg w-3/4" />
              <Skeleton className="h-5 rounded-lg w-1/2" />
            </div>
          )}
          {err && <p className="text-danger text-sm">{err}（服务端未重启/插件未启用/包内缺 docs？）</p>}
          {md !== null && !loading && (
            <article className="prose-sdk max-w-none text-sm leading-relaxed space-y-3 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_pre]:bg-default-50 [&_pre]:dark:bg-default-900 [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-auto [&_code]:font-mono [&_code]:text-[12px] [&_table]:w-full [&_table]:text-xs [&_th]:text-left [&_th]:border-b [&_th]:border-default-200 [&_th]:pb-1 [&_td]:py-1 [&_td]:pr-3 [&_a]:text-primary [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-default-200 [&_blockquote]:pl-3 [&_blockquote]:text-default-500">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
            </article>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── 3. Agent 端：能力目录 + 实时执行 ───────────────────────────────────

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

// ── 4. 服务端脚本：全函数目录 + 实时调用 ──────────────────────────────

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
          <Alert.Title>如何驱动 service/*.cs（多文件拼接编译）</Alert.Title>
          <Alert.Description>
            POST /api/plugin/&lt;pluginId&gt;/&lt;fn&gt;，body 任意 JSON 会变成脚本函数的 p（dynamic）；
            返回 {'{ ok:true, data }'}；脚本抛异常返回 {'{ ok:false, error }'}。宿主把 service/ 下所有
            .cs 按文件名排序拼接为单个脚本编译，文件变更自动失效。
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
          <h3 className="font-semibold">GET /api/plugin/list — 已导入且含 service/*.cs 的插件</h3>
          <Button size="sm" variant="secondary" onPress={loadList}>加载</Button>
        </div>
        {listErr && <p className="text-danger text-sm mb-2">{listErr}</p>}
        {list && (
          list.length === 0 ? (
            <p className="text-sm text-default-500">没有插件带 service/*.cs。</p>
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

// ── 5. 前端 API：宿主 / api client / 管理 ─────────────────────────────

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

const RESOURCE_API: { member: string; desc: string; sample: string }[] = [
  { member: 'GET /api/plugins/<id>/assets/<file>', desc: '包内静态资源（图标/图片/markdown），匿名可访问', sample: "fetch(`${API_ORIGIN}/api/plugins/com.example.plugin-sdk/assets/docs/01-overview.md`)" },
];

function FrontendApiTab() {
  const { selectedAgent, lastOutput } = usePluginHost();
  const [plugins, setPlugins] = useState<PluginRecord[] | null>(null);
  const [pluginsErr, setPluginsErr] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
    setPluginsErr(null);
    try { setPlugins(await listPlugins()); } catch (e) { setPluginsErr(e instanceof Error ? e.message : String(e)); }
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

      {/* 资源端点（活文档的加载方式） */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">包内资源端点（assets 动态加载）</h3>
        <div className="divide-y divide-default-100">
          {RESOURCE_API.map((c) => (
            <div key={c.member} className="py-2">
              <code className="font-mono text-xs">{c.member}</code>
              <p className="text-sm text-default-500 mt-0.5">{c.desc}</p>
              <pre className="text-[11px] font-mono bg-default-50 dark:bg-default-900 rounded px-2 py-1 mt-1 overflow-auto">{c.sample}</pre>
            </div>
          ))}
        </div>
        <p className="text-xs text-default-400 mt-2">
          图标/图片：<code className="font-mono">{`<img src={assetUrl('icons/foo.svg')} />`}</code>（参见 com.libra.aitoken 的 assets 用法）；
          活文档：fetch + react-markdown 渲染（本页「文档」页签即此模式）。
        </p>
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
    </div>
  );
}

// ── 通用小组件 ─────────────────────────────────────────────────────────

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
