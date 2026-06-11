import { useTranslation } from 'react-i18next';
import type { AgentListItem } from '../../types/models';

interface Props {
  agents: AgentListItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function AgentSelector({ agents, selectedIds, onChange }: Props) {
  const { t } = useTranslation();
  const onlineAgents = agents.filter(a => a.status === 'Online');
  const allSelected = onlineAgents.length > 0 && selectedIds.length === onlineAgents.length;

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter(x => x !== id)
        : [...selectedIds, id]
    );
  };

  const toggleAll = () => {
    onChange(allSelected ? [] : onlineAgents.map(a => a.id));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">
          {t('stressTest.selectAgents')}
        </h3>
        <button
          onClick={toggleAll}
          className="text-xs text-primary-600 hover:text-primary-700"
        >
          {allSelected ? t('stressTest.deselectAll') : t('stressTest.selectAll')}
        </button>
      </div>

      {onlineAgents.length === 0 && (
        <p className="text-xs text-neutral-400">{t('stressTest.noOnlineAgents')}</p>
      )}

      <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
        {onlineAgents.map(agent => {
          const isSelected = selectedIds.includes(agent.id);
          return (
            <label
              key={agent.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors border ${
                isSelected
                  ? 'bg-primary-50 border-primary-300 text-primary-900'
                  : 'bg-white border-neutral-200 hover:bg-neutral-50 text-neutral-700'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(agent.id)}
                className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{agent.hostname}</div>
                <div className="text-xs text-neutral-500 truncate">{agent.ipAddress}</div>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            </label>
          );
        })}
      </div>
    </div>
  );
}
