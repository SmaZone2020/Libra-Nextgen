import { useTranslation } from 'react-i18next';
import { Button, Dropdown, EmptyState } from '@heroui/react';
import { Display } from '@gravity-ui/icons';
import { useAgent } from '../contexts/AgentContext';
import type { AgentListItem } from '../types/models';

/**
 * 功能页面统一的"未连接 Agent"空状态：
 * 以 HeroUI EmptyState 展示提示 + 与顶部一致的 Agent 选择下拉框。
 * 未选择 Agent 时，功能页面用它替代纯文本提示。
 */
export function AgentRequired() {
  const { t } = useTranslation();
  const { agents, selectedAgent, selectAgent } = useAgent();

  // Only online agents are actionable; offline ones are hidden from the picker.
  const onlineAgents = agents.filter((a) => a.status === 'Online');

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <EmptyState className="empty-state--md">
        <div className="empty-state__header">
          <div className="empty-state__media" data-variant="icon">
            <Display className="size-5" />
          </div>
          <div className="empty-state__title">{t('agentRequired.title')}</div>
          <div className="empty-state__description">{t('agentRequired.desc')}</div>
        </div>
        <div className="empty-state__content">
          <Dropdown>
            <Button
              variant="tertiary"
              className="min-w-[220px] justify-start"
            >
              {selectedAgent ? `${selectedAgent.hostname} (${selectedAgent.ipAddress})` : t('common.selectAgent')}
            </Button>
            <Dropdown.Popover>
              <Dropdown.Menu
                onAction={(key) => selectAgent(String(key))}
                items={onlineAgents}
              >
                {(item: AgentListItem) => (
                  <Dropdown.Item key={item.id} id={item.id} textValue={item.hostname}>
                    {item.hostname}({item.ipAddress})
                  </Dropdown.Item>
                )}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </EmptyState>
    </div>
  );
}
