import { useState, useRef, useCallback, useEffect } from 'react';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { useShellSession } from './useShellSession';
import { useAgent } from '../../contexts/AgentContext';

type LockMode = 'write' | 'readonly' | null;

export default function ShellPage() {
  const { agentId } = useAgent();
  const [lockMode, setLockMode] = useState<LockMode>(null);
  const [connected, setConnected] = useState(false);

  const termRef = useRef<TerminalHandle>(null);

  const handleStateChange = useCallback(({ connected: c, lockMode: m }: { connected: boolean; lockMode: LockMode }) => {
    setConnected(c);
    setLockMode(m);
  }, []);

  const { bind, disconnect, sendInput } = useShellSession({ termRef, onStateChange: handleStateChange });

  useEffect(() => {
    if (agentId) {
      bind(agentId);
    } else {
      disconnect();
    }
  }, [agentId, bind, disconnect]);

  return (
    <div className="space-y-3">
      {!agentId && (
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
        style={{ height: 'calc(100vh - 240px)', minHeight: 400, display: agentId ? 'block' : 'none' }}
      />
    </div>
  );
}
