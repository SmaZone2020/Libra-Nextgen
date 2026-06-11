import { Button, Chip, Dropdown } from '@heroui/react';
import type { AgentListItem } from '../../types/models';

type LockMode = 'write' | 'readonly' | null;

interface AgentSelectorProps {
  agents: AgentListItem[];
  selectedId: string;
  connected: boolean;
  lockMode: LockMode;
  onSelect: (agentId: string) => void;
  onDisconnect: () => void;
}

export function AgentSelector({ agents, selectedId, connected, lockMode, onSelect, onDisconnect }: AgentSelectorProps) {
  const selectedAgent = agents.find(a => a.id === selectedId);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Dropdown>
        <Button
          size="sm"
          variant="ghost"
          className="w-[256px] justify-start"
          isDisabled={connected}
        >
          {selectedAgent ? selectedAgent.hostname : 'Select agent...'}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            onAction={(key) => onSelect(String(key))}
            items={agents}
          >
            {(item: AgentListItem) => (
              <Dropdown.Item key={item.id} textValue={item.hostname}>
                {item.hostname}
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {connected && selectedAgent && (
        <div className="flex items-center gap-2">
          <Chip size="sm" variant="soft" color="success">
            {selectedAgent.hostname}
          </Chip>
          <Chip size="sm" variant="soft">
            {selectedAgent.ipAddress}
          </Chip>
          {lockMode === 'write' ? (
            <Chip size="sm" variant="soft" color="success">Write</Chip>
          ) : lockMode === 'readonly' ? (
            <Chip size="sm" variant="soft" color="warning">Read-only</Chip>
          ) : null}
        </div>
      )}

      {connected && (
        <Button size="sm" variant="tertiary" onPress={onDisconnect}>
          Disconnect
        </Button>
      )}
    </div>
  );
}
