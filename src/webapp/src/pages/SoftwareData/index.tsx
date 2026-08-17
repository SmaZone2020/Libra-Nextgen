import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { useAgentPlatform } from '../../hooks/useAgentPlatform';
import { WeChatTab } from './WeChatTab';
import { QQTab } from './QQTab';
import { BrowserTab } from './BrowserTab';
import { AITab } from './AITab';
import { SSHTab } from './SSHTab';
import { RDPTab } from './RDPTab';

export default function SoftwareDataPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const platform = useAgentPlatform();
  const [tab, setTab] = useState<string>('wechat');

  // WeChat/QQ/browser/RDP harvesters are Windows-only (DPAPI, NTQQ, TERMSRV);
  // SSH keys and AI tokens are cross-platform.
  const isWindows = platform === 'windows';
  const tabs = [
    { id: 'wechat', label: t('othersoft.wechat'), render: <WeChatTab agentId={agentId} />, windowsOnly: true },
    { id: 'qq', label: t('othersoft.qq'), render: <QQTab agentId={agentId} />, windowsOnly: true },
    { id: 'browser', label: t('othersoft.browser.title'), render: <BrowserTab agentId={agentId} />, windowsOnly: true },
    { id: 'ai', label: t('othersoft.ai.title'), render: <AITab agentId={agentId} /> },
    { id: 'ssh', label: t('othersoft.ssh.title'), render: <SSHTab agentId={agentId} /> },
    { id: 'rdp', label: t('othersoft.rdp.title'), render: <RDPTab agentId={agentId} />, windowsOnly: true },
  ].filter((tb) => !tb.windowsOnly || isWindows);

  if (!agentId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-neutral-500">
        {t('othersoft.selectAgent')}
      </div>
    );
  }

  const activeTab = tabs.some((tb) => tb.id === tab) ? tab : tabs[0]!.id;

  return (
    <div className="space-y-3">
      <Tabs selectedKey={activeTab} onSelectionChange={(key) => setTab(String(key))}>
        <Tabs.ListContainer className="flex justify-center">
          <Tabs.List aria-label={t('othersoft.tabsLabel')} className="mx-auto w-lg">
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
