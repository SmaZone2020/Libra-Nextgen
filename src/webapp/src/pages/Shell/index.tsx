import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Chip, ComboBox, Input, Label, ListBox } from '@heroui/react';
import { getAgents } from '../../api/agents';
import { consoleWs } from '../../ws/consoleWs';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import type { AgentListItem, WsMessage } from '../../types/models';

type LockMode = 'write' | 'readonly' | null;

export default function ShellPage() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [lockMode, setLockMode] = useState<LockMode>(null);
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');

  const termRef = useRef<TerminalHandle>(null);
  const agentIdRef = useRef<string>('');
  const connectedRef = useRef(false);

  // Load online agents
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await getAgents(1, 100, 'online');
        if (!cancelled) setAgents(res.agents);
      } catch { /* ignore */ }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Unbind helper — safe to call multiple times
  const unbind = useCallback(() => {
    const id = agentIdRef.current;
    if (!id || !connectedRef.current) return;

    connectedRef.current = false;
    setConnected(false);
    setLockMode(null);

    consoleWs.send({
      type: 'shell.unbind',
      channel: id,
      data: { agentId: id },
      ts: Date.now(),
    });
  }, []);

  // Register WS listeners once on mount
  useEffect(() => {
    const handleMessage = (msg: WsMessage) => {
      const id = agentIdRef.current;
      if (!id) return;

      switch (msg.type) {
        case 'shell.lock.acquired': {
          const data = msg.data as Record<string, unknown> | undefined;
          if (data?.mode === 'write') {
            connectedRef.current = true;
            setConnected(true);
            setLockMode('write');
          }
          break;
        }
        case 'shell.observer.joined': {
          const data = msg.data as Record<string, unknown> | undefined;
          if (data?.mode === 'readonly') {
            connectedRef.current = true;
            setConnected(true);
            setLockMode('readonly');
          }
          break;
        }
        case 'shell.output': {
          if (msg.channel !== id) break;
          const data = msg.data as Record<string, unknown> | undefined;
          const text = typeof data?.text === 'string' ? data.text : '';
          if (text) termRef.current?.write(text);
          break;
        }
      }
    };

    const unsub = consoleWs.onAny(handleMessage);
    return () => {
      unsub();
      unbind();
    };
  }, [unbind]);

  // Handle terminal input
  const handleInput = useCallback((text: string) => {
    const id = agentIdRef.current;
    if (!connectedRef.current || !id) return;

    const cmd = text.replace(/\r?\n$/, '').trim().toLowerCase();
    if (cmd === 'cls' || cmd === 'clear') {
      termRef.current?.clear();
      return;
    }

    consoleWs.send({
      type: 'shell.input',
      channel: id,
      data: { text },
      ts: Date.now(),
    });
  }, []);

  // Bind to agent
  const bindAgent = useCallback((agentId: string) => {
    if (!agentId) return;

    // Unbind previous session if any
    unbind();

    agentIdRef.current = agentId;
    setSelectedId(agentId);

    // Clear terminal for new session
    termRef.current?.clear();

    // Send bind — connected will be set when lock response arrives
    consoleWs.send({
      type: 'shell.bind',
      channel: '',
      data: { agentId },
      ts: Date.now(),
    });

    termRef.current?.focus();
  }, [unbind]);

  // Disconnect button
  const disconnect = useCallback(() => {
    unbind();
    agentIdRef.current = '';
    setSelectedId('');
  }, [unbind]);

  const selectedAgent = agents.find(a => a.id === selectedId);

  return (
    <div className="space-y-3">
      {/* Agent selector bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <ComboBox
          className="w-[256px]"
          defaultItems={agents}
          selectedKey={selectedId || null}
          onSelectionChange={(key) => bindAgent(String(key))}
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
          <Button size="sm" variant="ghost" onPress={disconnect}>
            Disconnect
          </Button>
        )}
      </div>

      {/* Terminal */}
      {!connected && !selectedId && (
        <div
          className="flex items-center justify-center border border-neutral-700 rounded-lg text-neutral-500 text-sm select-none"
          style={{ height: 'calc(100vh - 240px)', minHeight: 400, background: '#1a1b1e' }}
        >
          Select an online agent to open a remote shell session.
        </div>
      )}

      <Terminal
        ref={termRef}
        disabled={!connected}
        onInput={handleInput}
        className="rounded-lg border border-neutral-700"
        style={{ height: 'calc(100vh - 240px)', minHeight: 400, display: selectedId ? 'block' : 'none' }}
      />
    </div>
  );
}
