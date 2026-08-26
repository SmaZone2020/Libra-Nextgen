import { Card, Tabs } from '@heroui/react';
import { OverviewTab } from './overview';
import { DocsTab } from './docs';
import { AgentTab } from './agent';
import { ServiceTab } from './service';
import { FrontendApiTab } from './frontend';

/**
 * 插件 SDK 全能力演示（活文档）—— 主入口。
 *
 * 本页同时是【示例】和【文档】：把插件作者能用的所有宿主 API、组件与
 * 可选项都真实渲染出来，作者照着抄即可。分五个页签：
 *   1. 总览        —— 三层架构 / 包目录结构 / 接入流程（简版，详见文档页签）
 *   2. 文档        —— 活文档：在线拉取 assets/docs/*.md 渲染（随 zip 分发）
 *   3. Agent 端    —— JS 能力目录 + 实时执行（dispatchTask + WS 推送）
 *   4. 服务端脚本  —— service/*.cs 全函数目录 + 实时调用（/api/plugin/*）
 *   5. 前端 API    —— usePluginHost / api client / 插件管理
 *
 * 拆分说明：每个页签一个文件（overview/docs/agent/service/frontend.tsx），
 * 共享常量与工具在 shared.tsx，通用小组件在 components.tsx。
 */

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
