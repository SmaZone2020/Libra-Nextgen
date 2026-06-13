import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { WeChatTab } from './WeChatTab';
import { QQTab } from './QQTab';
import { BrowserTab } from './BrowserTab';
import { AITab } from './AITab';

export default function SoftwareDataPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const [tab, setTab] = useState<string>('wechat');

  if (!agentId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-neutral-500">
        {t('othersoft.selectAgent')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
        <Tabs.ListContainer className="flex justify-center">
          <Tabs.List aria-label={t('othersoft.tabsLabel')} className="mx-auto w-lg">
            <Tabs.Tab id="wechat">{t('othersoft.wechat')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="qq">{t('othersoft.qq')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="browser">{t('othersoft.browser.title')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="ai">{t('othersoft.ai.title')}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="wechat"><WeChatTab agentId={agentId} /></Tabs.Panel>
        <Tabs.Panel id="qq"><QQTab agentId={agentId} /></Tabs.Panel>
        <Tabs.Panel id="browser"><BrowserTab agentId={agentId} /></Tabs.Panel>
        <Tabs.Panel id="ai"><AITab agentId={agentId} /></Tabs.Panel>
      </Tabs>
    </div>
  );
}
