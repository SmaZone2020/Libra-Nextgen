import { useState, useEffect, useRef, useCallback } from 'react';
import { getAgents } from '../../api/agents';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { AgentSelector } from './AgentSelector';
import { useShellSession } from './useShellSession';
import type { AgentListItem } from '../../types/models';

type LockMode = 'write' | 'readonly' | null;

export default function ShellPage() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [lockMode, setLockMode] = useState<LockMode>(null);
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');

  const termRef = useRef<TerminalHandle>(null);

  const handleStateChange = useCallback(({ connected: c, lockMode: m }: { connected: boolean; lockMode: LockMode }) => {
    setConnected(c);
    setLockMode(m);
  }, []);

  const { bind, disconnect, sendInput } = useShellSession({ termRef, onStateChange: handleStateChange });

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

  const handleSelect = useCallback((agentId: string) => {
    setSelectedId(agentId);
    bind(agentId);
  }, [bind]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    setSelectedId('');
  }, [disconnect]);

  return (
    <div className="space-y-3">
      <AgentSelector
        agents={agents}
        selectedId={selectedId}
        connected={connected}
        lockMode={lockMode}
        onSelect={handleSelect}
        onDisconnect={handleDisconnect}
      />

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
        onInput={sendInput}
        className="rounded-lg border border-neutral-700"
        style={{ height: 'calc(100vh - 240px)', minHeight: 400, display: selectedId ? 'block' : 'none' }}
      />
    </div>
  );
}
