import { Card, Tabs } from '@heroui/react';
import { OverviewTab } from './overview';
import { DocsTab } from './docs';
import { AgentTab } from './agent';
import { ServiceTab } from './service';
import { FrontendApiTab } from './frontend';


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
