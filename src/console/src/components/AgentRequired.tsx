import { useTranslation } from 'react-i18next';
import { Button, Dropdown, EmptyState } from '@heroui/react';
import { Display } from '@gravity-ui/icons';
import { useAgent } from '../contexts/AgentContext';
import type { AgentListItem } from '../types/models';

export function AgentRequired() {
  const { t } = useTranslation();
  const { agents, selectedAgent, selectAgent } = useAgent();

  const onlineAgents = agents.filter((a) => a.status === 'Online');

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800">
            <Display className="size-8" />
          </div>
        </div>
        {onlineAgents.length < 1 ? (
          <div className="text-xl text-gray-600">
            {t('agentRequired.noOnlineAgent')}
          </div>
        ) : (
          <>
            <div className="text-xl font-semibold">{t('agentRequired.title')}</div>
            <div className="text-base text-gray-600">{t('agentRequired.desc')}</div>
            <div>
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
        </>
        )}
      </div>
    </div>
  );
}

