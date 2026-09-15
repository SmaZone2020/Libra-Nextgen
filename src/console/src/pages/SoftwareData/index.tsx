import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { AgentRequired } from '../../components/AgentRequired';
import { useAgentPlatform } from '../../hooks/useAgentPlatform';
import { useIsDesktop } from '../../hooks/useMobileLayout';
import { SSHTab } from './SSHTab';
import { RDPTab } from './RDPTab';
import { TokenTab } from './TokenTab';

export default function SoftwareDataPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const platform = useAgentPlatform();
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<string>('ssh');

  // RDP harvesters are Windows-only (DPAPI, TERMSRV); SSH keys are cross-platform.
  // WeChat/QQ live in plugins (com.libra.wechat-file / com.libra.qqkey).
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
    <div className="flex h-full min-h-0 flex-col px-3 pt-2 sm:px-5 sm:pt-3 lg:px-7">
      {/* Vertical sidebar on desktop; on a phone a vertical strip would eat the
          whole width, so it becomes a horizontal, scrollable tab row. */}
      <Tabs
        orientation={isDesktop ? 'vertical' : 'horizontal'}
        selectedKey={activeTab}
        onSelectionChange={(key) => setTab(String(key))}
        className={isDesktop ? 'h-full min-h-0 items-start' : 'h-full min-h-0'}
      >
        <Tabs.ListContainer
          className={isDesktop ? 'flex h-auto shrink-0 justify-center self-start' : 'shrink-0'}
        >
          <Tabs.List
            aria-label={t('othersoft.tabsLabel')}
            className={isDesktop ? 'my-0 px-2 w-35' : 'my-0 px-2'}
          >
            {tabs.map((tb) => (
              <Tabs.Tab key={tb.id} id={tb.id}>{tb.label}<Tabs.Indicator /></Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {tabs.map((tb) => (
          <Tabs.Panel key={tb.id} id={tb.id} className="min-h-0 flex-1 overflow-y-auto pb-2">
            {tb.render}
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}
