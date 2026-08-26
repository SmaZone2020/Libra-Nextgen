import type { ReactNode } from 'react';
import { Accordion, Button, Card } from '@heroui/react';

// ── 通用小组件 ─────────────────────────────────────────────────────────

export function ApiTable({ title, rows }: { title: string; rows: string[][] }) {
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
export function Tool({ title, desc, fields, run }: {
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
