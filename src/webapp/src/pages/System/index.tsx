import { useState } from 'react';
import { Tabs } from '@heroui/react';
import { ProcessTab } from './ProcessTab';
import { WindowsTab } from './WindowsTab';
import { EnvTab } from './EnvTab';
import { useAgent } from '../../contexts/AgentContext';

export default function SystemPage() {
  const { agentId } = useAgent();
  const [tab, setTab] = useState<string>('processes');

  if (!agentId) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        Select an online agent to view system information.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(String(key))}
      >
        <Tabs.ListContainer className="flex justify-center">
          <Tabs.List aria-label="System info tabs" className="mx-auto w-lg">
            <Tabs.Tab id="processes">Processes<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="windows">Windows<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="env">Environment<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="processes">
          <ProcessTab agentId={agentId} />
        </Tabs.Panel>
        <Tabs.Panel id="windows">
          <WindowsTab agentId={agentId} />
        </Tabs.Panel>
        <Tabs.Panel id="env">
          <EnvTab agentId={agentId} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
