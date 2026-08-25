import { Card, Label, TextArea, TextField } from '@heroui/react';
import type { BuildConfigRequest } from '../../types/models';

interface BuilderTrafficCardProps {
  config: BuildConfigRequest;
  set: <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) => void;
}

/** 流量伪装配置（独立卡片，置于构建页最底部）。 */
export function BuilderTrafficCard({ config, set }: BuilderTrafficCardProps) {
  return (
    <Card className="p-4">
      <h2 className="text-lg font-semibold mb-3">流量伪装</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TextField
          value={(config.userAgents ?? []).join('\n')}
          variant="secondary"
          onChange={(v) => set('userAgents', v.split('\n').map((s) => s.trim()).filter(Boolean))}
        >
          <Label>UA 轮换列表</Label>
          <TextArea rows={5} variant="secondary" />
        </TextField>
        <TextField
          value={(config.extraHeaders ?? []).join('\n')}
          variant="secondary"
          onChange={(v) => set('extraHeaders', v.split('\n').map((s) => s.trim()).filter(Boolean))}
        >
          <Label>附加请求头（每行 "Name: value"）</Label>
          <TextArea rows={5} variant="secondary" />
        </TextField>
        <TextField
          value={(config.pathSuffixes ?? []).join('\n')}
          variant="secondary"
          onChange={(v) => set('pathSuffixes', v.split('\n').map((s) => s.trim()).filter(Boolean))}
        >
          <Label>虚假业务路径后缀（每行一个）</Label>
          <TextArea rows={5} variant="secondary" />
        </TextField>
      </div>
    </Card>
  );
}
