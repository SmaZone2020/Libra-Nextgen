import { Alert, Card, Chip } from '@heroui/react';
import { DIR_TREE, STEPS } from './shared';

// ── 1. 总览 ────────────────────────────────────────────────────────────

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
