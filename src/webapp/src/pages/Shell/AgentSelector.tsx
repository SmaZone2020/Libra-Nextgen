import { Button, Chip, ComboBox, Input, Label, ListBox } from '@heroui/react';
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
      <ComboBox
        className="w-[256px]"
        defaultItems={agents}
        selectedKey={selectedId || null}
        onSelectionChange={(key) => onSelect(String(key))}
        isDisabled={connected}
      >
        <Label>Agent</Label>
        <ComboBox.InputGroup>
          <Input placeholder="Select agent..." />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        <ComboBox.Popover>
          <ListBox>
            {(item: AgentListItem) => (
              <ListBox.Item id={item.id} textValue={item.hostname}>
                {item.hostname}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>

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
