import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@heroui/react';
import { LocalAccountsTab } from './LocalAccountsTab';
import { ProcessTab } from './ProcessTab';
import { WindowsTab } from './WindowsTab';
import { EnvTab } from './EnvTab';
import { NetworkTab } from './NetworkTab';
import { PackagesTab } from './PackagesTab';
import { DockerTab } from './DockerTab';
import { useAgent } from '../../contexts/AgentContext';
import { AgentRequired } from '../../components/AgentRequired';
import { useAgentPlatform } from '../../hooks/useAgentPlatform';

export default function SystemPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const platform = useAgentPlatform();
  const [tab, setTab] = useState<string>('localAccounts');

  // Windows-only tab: window enumeration. Linux-only tabs: packages + docker.
  const isWindows = platform === 'windows';
  const isLinux = platform === 'linux';
  const tabs = [
    { id: 'localAccounts', label: t('system.localAccounts'), render: <LocalAccountsTab agentId={agentId} /> },
    { id: 'processes', label: t('system.processes'), render: <ProcessTab agentId={agentId} /> },
    { id: 'windows', label: t('system.windows'), render: <WindowsTab agentId={agentId} />, windowsOnly: true },
    { id: 'env', label: t('system.environment'), render: <EnvTab agentId={agentId} /> },
    { id: 'network', label: t('system.network'), render: <NetworkTab agentId={agentId} /> },
    { id: 'packages', label: t('system.packages.title'), render: <PackagesTab agentId={agentId} />, linuxOnly: true },
    { id: 'docker', label: t('system.docker.title'), render: <DockerTab agentId={agentId} />, linuxOnly: true },
  ].filter((tb) => {
    if (tb.windowsOnly && !isWindows) return false;
    if (tb.linuxOnly && !isLinux) return false;
    return true;
  });

  if (!agentId) {
    return <AgentRequired />;
  }

  // If the currently selected tab is hidden for this platform, fall back.
  const activeTab = tabs.some((tb) => tb.id === tab) ? tab : tabs[0]!.id;

  return (
    <div className="space-y-3">
      <Tabs
        orientation="vertical"
        selectedKey={activeTab}
        onSelectionChange={(key) => setTab(String(key))}
        className="items-start"
      >
        <Tabs.ListContainer className="flex justify-center h-auto self-start">
          <Tabs.List aria-label={t('system.infoTabs')} className="my-0 px-2 w-35">
            {tabs.map((tb) => (
              <Tabs.Tab key={tb.id} id={tb.id}>{tb.label}<Tabs.Indicator /></Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {tabs.map((tb) => (
          <Tabs.Panel key={tb.id} id={tb.id}>{tb.render}</Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}
