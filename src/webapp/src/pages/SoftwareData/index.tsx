import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { AgentRequired } from '../../components/AgentRequired';
import { useAgentPlatform } from '../../hooks/useAgentPlatform';
import { SSHTab } from './SSHTab';
import { RDPTab } from './RDPTab';
import { TokenTab } from './TokenTab';

export default function SoftwareDataPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const platform = useAgentPlatform();
  const [tab, setTab] = useState<string>('ssh');

  // RDP harvesters are Windows-only (DPAPI, TERMSRV); SSH keys are cross-platform.
  // WeChat/browser live in plugins (com.libra.wechat-file / com.libra.browser-stealer).
  const isWindows = platform === 'windows';
  const tabs = [
    { id: 'ssh', label: t('othersoft.ssh.title'), render: <SSHTab agentId={agentId} /> },
    { id: 'rdp', label: t('othersoft.rdp.title'), render: <RDPTab agentId={agentId} />, windowsOnly: true },
    { id: 'token', label: 'Token', render: <TokenTab agentId={agentId} />, windowsOnly: true },
  ].filter((tb) => !tb.windowsOnly || isWindows);

  if (!agentId) {
    return <AgentRequired />;
  }

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
          <Tabs.List aria-label={t('othersoft.tabsLabel')} className="my-0 px-2 w-35">
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
