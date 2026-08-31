import { api, getApiOrigin } from '../../api/client';


export const SDK_ID = 'com.example.plugin-sdk';
const SERVICE_BASE = `/plugin/${SDK_ID}`;

export interface ScriptResult { ok: boolean; data?: unknown; error?: string; plugin?: string; fn?: string; }
export async function callScript<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<ScriptResult> {
  return api.post<ScriptResult>(`${SERVICE_BASE}/${fn}`, params ?? {});
}

export function tryParse(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

export function pretty(data: unknown): string {
  const parsed = tryParse(data);
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed ?? '(empty)', null, 2);
}

export function assetUrl(file: string): string {
  return `${getApiOrigin()}/api/plugins/${SDK_ID}/assets/${file}`;
}

export const DOC_FILES: { id: string; label: string; file: string }[] = [
  { id: '01', label: '总览', file: 'docs/01-overview.md' },
  { id: '02', label: '插件契约', file: 'docs/02-plugin-contract.md' },
  { id: '03', label: 'Agent JS API', file: 'docs/03-agent-js-api.md' },
  { id: '04', label: '服务端脚本', file: 'docs/04-server-script.md' },
  { id: '05', label: '前端宿主', file: 'docs/05-frontend-host.md' },
  { id: '06', label: '打包发布', file: 'docs/06-pack-publish.md' },
];

export const DIR_TREE = `com.example.plugin-sdk/
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

export const STEPS: [string, string][] = [
  ['建包', '写好 meta.json + module/（script 或 native）+ service/*.cs + page/index.tsx，npm run pack 打成 zip'],
  ['导入', '控制台 → 插件管理 → 上传插件 / 从 Git 导入 / 从市场安装'],
  ['启用', '插件登记到后端，动作可下发到 Agent'],
  ['写页面', 'src/webapp/src/plugins/<pluginId>/index.tsx（import.meta.glob 收集，需重建前端）'],
  ['调 Agent', '页面里 usePluginHost().dispatchTask(pluginId, action, args)'],
  ['调服务', '页面里 api.post(\'/plugin/<pluginId>/<fn>\', params) 驱动 service/*.cs'],
  ['发布', '把 zip 提交到 Libra-Plugins 仓库 plugins/<pluginId>/，CI 生成 index.json 即上架市场'],
];

export const AGENT_CAPS: { value: string; label: string; desc: string; needsCommand?: boolean }[] = [
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

export const COMMON_API: [string, string][] = [
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

export const WINDOWS_API: [string, string][] = [
  ['cmd(cmdline)', '执行 CMD 命令'],
  ['powershell(script)', '进程内 CLR 执行 PowerShell（无 powershell.exe 进程）'],
  ['reg_query(key, name)', '查询注册表值'],
  ['reg_set(key, name, data)', '写注册表值，返回 bool'],
  ['reg_delete(key, name)', '删注册表值，返回 bool'],
  ['ipconfig()', '网络配置（/all）'],
  ['wmic(query)', '执行 WMIC 查询（Win11 24H2 已移除，注意空返回）'],
  ['tasklist()', '任务列表'],
];

export const LINUX_API: [string, string][] = [
  ['shell(cmdline)', '执行 /bin/sh -c'],
  ['bash(script)', '执行 /bin/bash -c'],
  ['uname()', '内核/主机/架构（uname -a）'],
  ['ip_route()', '网络接口/IP，等价 ip addr'],
  ['ss(path)', '读 /proc 或 /sys 文件'],
  ['hostname()', '主机名'],
  ['dns()', '/etc/resolv.conf'],
];
