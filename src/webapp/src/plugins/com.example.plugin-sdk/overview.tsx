import type { ReactNode } from 'react';
import { File, FileCode, Folder } from '@gravity-ui/icons';
import { Alert, Card, Chip } from '@heroui/react';
import { FileTree } from '../../components/file-tree';
import { STEPS } from './shared';

// ── 1. 总览 ────────────────────────────────────────────────────────────

interface PackageTreeEntry {
  name: string;
  kind: 'folder' | 'file';
  note?: string;
  children?: PackageTreeEntry[];
}

/** 插件包目录结构（与 shared.tsx 的 DIR_TREE 同源，结构化为 FileTree 数据）。 */
const PACKAGE_TREE: PackageTreeEntry = {
  name: 'com.example.plugin-sdk/',
  kind: 'folder',
  children: [
    { name: 'meta.json', kind: 'file', note: '插件契约（必需）' },
    {
      name: 'module/', kind: 'folder',
      note: 'Agent 端模块',
      children: [
        { name: 'plugin_sdk.js', kind: 'file', note: 'script 通道：JS 源码，QuickJS 内存执行' },
      ],
    },
    {
      name: 'service/', kind: 'folder',
      note: '服务端逻辑（C# 脚本，随包分发）',
      children: [
        { name: 'sdk_utils.cs', kind: 'file', note: '工具类/静态状态（按文件名排序，先拼接）' },
        { name: 'main.cs', kind: 'file', note: '导出函数（末尾 return Dictionary）' },
      ],
    },
    {
      name: 'page/', kind: 'folder',
      note: '前端页面源码（分发用，需重建前端）',
      children: [
        { name: 'index.tsx', kind: 'file' },
      ],
    },
    {
      name: 'assets/', kind: 'folder',
      note: '静态资源（经 /api/plugins/<id>/assets/ 动态加载）',
      children: [
        { name: 'docs/', kind: 'folder', note: '活文档（markdown，本页「文档」页签在线渲染）' },
      ],
    },
    { name: 'data/', kind: 'folder', note: '随包分发的数据/配置文件（脚本 file 函数可读）' },
    { name: 'README.md', kind: 'file', note: '插件说明' },
  ],
};

function packageTreeNodes(entries: PackageTreeEntry[], parentPath = ''): ReactNode {
  return entries.map((entry) => {
    const path = parentPath + entry.name;
    return (
      <FileTree.Item key={path} id={path} textValue={entry.name}>
        <FileTree.ItemContent>
          <FileTree.Chevron />
          <FileTree.Icon>
            {entry.kind === 'folder' ? <Folder /> : entry.name.endsWith('.md') ? <File /> : <FileCode />}
          </FileTree.Icon>
          <FileTree.Label>{entry.name}</FileTree.Label>
          {entry.note && <span className="text-xs text-muted shrink-0">{entry.note}</span>}
        </FileTree.ItemContent>
        {entry.children ? packageTreeNodes(entry.children, path) : null}
      </FileTree.Item>
    );
  });
}

/** 默认全部展开，还原 DIR_TREE 的完整可见结构。 */
const PACKAGE_EXPANDED_KEYS = [
  'com.example.plugin-sdk/',
  'com.example.plugin-sdk/module/',
  'com.example.plugin-sdk/service/',
  'com.example.plugin-sdk/page/',
  'com.example.plugin-sdk/assets/',
  'com.example.plugin-sdk/assets/docs/',
];

export function OverviewTab() {
  return (
    <div className="space-y-4">
      {/* 三层架构 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Chip size="sm" color="accent">Agent 端</Chip>
            <h3 className="font-semibold">module/</h3>
          </div>
          <ul className="text-sm text-default-500 mt-2 space-y-1 list-disc pl-5">
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
          <ul className="text-sm text-default-500 mt-2 space-y-1 list-disc pl-5">
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
          <ul className="text-sm text-default-500 mt-2 space-y-1 list-disc pl-5">
            <li>HeroUI 组件 + usePluginHost（设备/任务/WS 推送）</li>
            <li>dispatchTask 调 Agent 模块；api.post 调服务端脚本</li>
            <li>活文档在线渲染（assets/docs/*.md + react-markdown）</li>
            <li>源码分发：import.meta.glob 构建期收集，需重建前端</li>
          </ul>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">插件包目录结构</h3>
        <FileTree
          className="max-h-96"
          aria-label="插件包目录结构"
          defaultExpandedKeys={PACKAGE_EXPANDED_KEYS}
        >
          {packageTreeNodes([PACKAGE_TREE])}
        </FileTree>
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
