import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@heroui/react';
import { ProcessTab } from './ProcessTab';
import { WindowsTab } from './WindowsTab';
import { EnvTab } from './EnvTab';
import { NetworkTab } from './NetworkTab';
import { useAgent } from '../../contexts/AgentContext';

export default function SystemPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const [tab, setTab] = useState<string>('processes');

  if (!agentId) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        {t('system.selectAgent')}
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
          <Tabs.List aria-label={t('system.infoTabs')} className="mx-auto w-lg">
            <Tabs.Tab id="processes">{t('system.processes')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="windows">{t('system.windows')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="env">{t('system.environment')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="network">{t('system.network')}<Tabs.Indicator /></Tabs.Tab>
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
        <Tabs.Panel id="network">
          <NetworkTab agentId={agentId} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
