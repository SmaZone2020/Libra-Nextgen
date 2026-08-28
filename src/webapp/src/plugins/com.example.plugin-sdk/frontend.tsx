import { useCallback, useState } from 'react';
import { Button, Card, Chip, Table } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';
import { api, getApiOrigin } from '../../api/client';
import { listPlugins, type PluginRecord } from '../../api/plugins';
import { pretty } from './shared';

// ── 5. 前端 API：宿主 / api client / 管理 ─────────────────────────────

const HOST_API: { member: string; desc: string; sample: string }[] = [
  { member: 'selectedAgent', desc: '当前选中的设备（与控制台顶部选择器共享）', sample: 'selectedAgent?.hostname' },
  { member: 'selectAgent(id)', desc: '切换选中设备（与主控制台联动）', sample: 'selectAgent(agentId)' },
  { member: 'dispatchTask(pluginId, action, args?, agentId?)', desc: '调用插件操作 → Agent 内存执行模块', sample: "dispatchTask('com.example.plugin-sdk', 'showcase', { capability: 'fs' })" },
  { member: 'subscribeOutput(cb, action?)', desc: '订阅 WS 实时推送（可选按 action 过滤），返回退订函数', sample: "subscribeOutput(o => setX(o.data), 'showcase')" },
  { member: 'lastOutput', desc: '最近一条 plugin.result 推送（便捷读取）', sample: 'lastOutput?.data' },
];

const CLIENT_API: { member: string; desc: string; sample: string }[] = [
  { member: 'api.get(path)', desc: 'GET，自动带 JWT', sample: "api.get('/plugins/manager')" },
  { member: 'api.post(path, body?)', desc: 'POST JSON', sample: "api.post('/plugin/com.example.plugin-sdk/echo', { text: 'hi' })" },
  { member: 'api.put(path, body?)', desc: 'PUT JSON', sample: "api.put('/plugins/manager/<id>', { meta })" },
  { member: 'api.delete(path)', desc: 'DELETE', sample: "api.delete('/plugins/manager/<id>')" },
  { member: 'getApiOrigin()', desc: '后端地址（首选项 > VITE_API_BASE > 前端 Host 推导 > 默认 5270）', sample: 'getApiOrigin()' },
];

const RESOURCE_API: { member: string; desc: string; sample: string }[] = [
  { member: 'GET /api/plugins/<id>/assets/<file>', desc: '包内静态资源（图标/图片/markdown），匿名可访问', sample: "fetch(`${getApiOrigin()}/api/plugins/com.example.plugin-sdk/assets/docs/01-overview.md`)" },
];

export function FrontendApiTab() {
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
        <p className="text-xs text-default-400 mt-2">当前后端地址：<code className="font-mono">{getApiOrigin()}</code></p>
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
