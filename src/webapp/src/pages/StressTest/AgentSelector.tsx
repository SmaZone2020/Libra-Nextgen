import { useTranslation } from 'react-i18next';
import { Button, Card } from '@heroui/react';
import { ListView } from '../../components/list-view';
import { useAgent } from '../../contexts/AgentContext';
import type { AgentListItem } from '../../types/models';

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function AgentSelector({ selectedIds, onChange }: Props) {
  const { t } = useTranslation();
  const { agents } = useAgent();

  const onlineAgents = agents.filter((a: AgentListItem) => a.status === 'Online');
  const allSelected = onlineAgents.length > 0 && selectedIds.length === onlineAgents.length;

  const handleSelectionChange = (keys: Set<string>) => {
    onChange(Array.from(keys));
  };

  const toggleAll = () => {
    onChange(allSelected ? [] : onlineAgents.map((a: AgentListItem) => a.id));
  };

  return (
    <Card className="p-4 w-[260px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-neutral-700">
          {t('stressTest.selectAgents')}
        </h3>
        <Button size="sm" variant="ghost" onPress={toggleAll}>
          {allSelected ? t('stressTest.deselectAll') : t('stressTest.selectAll')}
        </Button>
      </div>

      {onlineAgents.length === 0 ? (
        <p className="text-xs text-neutral-400 py-8 text-center">
          {t('stressTest.noOnlineAgents')}
        </p>
      ) : (
        <ListView
          aria-label={t('stressTest.selectAgents')}
          items={onlineAgents}
          selectedKeys={new Set(selectedIds)}
          selectionMode="multiple"
          variant="primary"
          onSelectionChange={(keys) => {
            if (keys === 'all') {
              onChange(onlineAgents.map(a => a.id));
            } else {
              onChange(Array.from(keys as Set<string>));
            }
          }}
        >
          {(agent: AgentListItem) => (
            <ListView.Item id={agent.id} textValue={agent.hostname}>
              <ListView.ItemContent>
                <ListView.Title>{agent.hostname}</ListView.Title>
                <ListView.Description>
                  {agent.ipAddress}
                </ListView.Description>
              </ListView.ItemContent>
            </ListView.Item>
          )}
        </ListView>
      )}
    </Card>
  );
}
