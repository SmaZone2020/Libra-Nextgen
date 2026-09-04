import { Button, Dropdown } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAgent } from '../contexts/AgentContext';
import type { AgentListItem } from '../types/models';
import { isPluginRoute } from './PageHeader';

const AGENT_ROUTES = new Set(['/agents', '/shell', '/files', '/system', '/othersoft', '/proxy']);

export function AgentSelector({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { agents, agentId, selectedAgent, selectAgent, disconnect } = useAgent();

  if (!AGENT_ROUTES.has(pathname) && !isPluginRoute(pathname)) return null;

  const onlineAgents = agents.filter((a) => a.status === 'Online');

  return (
    <div className={`flex items-center gap-2 sm:gap-3 ${className || ''}`}>
      <Dropdown>
        <Button
          variant="tertiary"
          className="flex-1 sm:w-[220px] sm:flex-none justify-start truncate"
          isDisabled={onlineAgents.length === 0}
        >
          {onlineAgents.length === 0 ?
          t('agents.noAgents') : selectedAgent ?
           `${selectedAgent.hostname} (${selectedAgent.ipAddress})` :
          t('common.selectAgent')}
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

      {selectedAgent && (
        <>
          <Button size="sm" variant="tertiary" onPress={disconnect}>
            {t('common.disconnect')}
          </Button>
        </>
      )}
    </div>
  );
}
