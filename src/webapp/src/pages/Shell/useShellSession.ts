import { useCallback, useEffect, useRef } from 'react';
import { consoleWs } from '../../ws/consoleWs';
import type { WsMessage } from '../../types/models';
import type { TerminalHandle } from '../../components/terminal';

type LockMode = 'write' | 'readonly' | null;

interface ShellState {
  connected: boolean;
  lockMode: LockMode;
}

interface UseShellSessionOptions {
  termRef: React.RefObject<TerminalHandle | null>;
  onStateChange: (state: ShellState) => void;
}

export function useShellSession({ termRef, onStateChange }: UseShellSessionOptions) {
  const agentIdRef = useRef<string>('');
  const connectedRef = useRef(false);
  const termSizeRef = useRef({ cols: 80, rows: 24 });
  // Output received while the terminal is not mounted yet is buffered and
  // flushed as soon as the ref is available (e.g. switching agents).
  const pendingRef = useRef<string[]>([]);

  const flushPending = useCallback(() => {
    const term = termRef.current;
    if (!term || pendingRef.current.length === 0) return;
    for (const text of pendingRef.current) term.write(text);
    pendingRef.current = [];
  }, [termRef]);

  const sendResize = useCallback((cols: number, rows: number) => {
    termSizeRef.current = { cols, rows };
    const id = agentIdRef.current;
    if (!id || !connectedRef.current) return;
    flushPending();
    consoleWs.send({
      type: 'shell.resize',
      channel: id,
      data: { cols, rows },
      ts: Date.now(),
    });
  }, [flushPending]);

  const unbind = useCallback(() => {
    const id = agentIdRef.current;
    if (!id || !connectedRef.current) return;

    connectedRef.current = false;
    onStateChange({ connected: false, lockMode: null });

    consoleWs.send({
      type: 'shell.unbind',
      channel: id,
      data: { agentId: id },
      ts: Date.now(),
    });
  }, [onStateChange]);

  useEffect(() => {
    const handleMessage = (msg: WsMessage) => {
      const id = agentIdRef.current;
      if (!id) return;

      switch (msg.type) {
        case 'shell.lock.acquired': {
          const data = msg.data as Record<string, unknown> | undefined;
          if (data?.mode === 'write') {
            connectedRef.current = true;
            onStateChange({ connected: true, lockMode: 'write' });
            // Push the current terminal geometry once connected.
            sendResize(termSizeRef.current.cols, termSizeRef.current.rows);
          }
          break;
        }
        case 'shell.observer.joined': {
          const data = msg.data as Record<string, unknown> | undefined;
          if (data?.mode === 'readonly') {
            connectedRef.current = true;
            onStateChange({ connected: true, lockMode: 'readonly' });
          }
          break;
        }
        case 'shell.output': {
          if (msg.channel !== id) break;
          const data = msg.data as Record<string, unknown> | undefined;
          const text = typeof data?.text === 'string' ? data.text : '';
          if (!text) break;
          if (termRef.current) {
            flushPending();
            termRef.current.write(text);
          } else {
            pendingRef.current.push(text);
          }
          break;
        }
      }
    };

    const unsub = consoleWs.onAny(handleMessage);
    return () => {
      unsub();
      unbind();
    };
  }, [unbind, onStateChange, termRef, sendResize]);

  const bind = useCallback((agentId: string) => {
    if (!agentId) return;
    unbind();

    agentIdRef.current = agentId;
    // New session: drop any buffered output from a previous agent.
    pendingRef.current = [];
    termRef.current?.clear();
    flushPending();

    consoleWs.send({
      type: 'shell.bind',
      channel: '',
      data: { agentId },
      ts: Date.now(),
    });

    termRef.current?.focus();
  }, [unbind, termRef, flushPending]);

  const disconnect = useCallback(() => {
    unbind();
    agentIdRef.current = '';
  }, [unbind]);

  const sendInput = useCallback((text: string) => {
    const id = agentIdRef.current;
    if (!connectedRef.current || !id) return;

    consoleWs.send({
      type: 'shell.input',
      channel: id,
      data: { text },
      ts: Date.now(),
    });
  }, []);

  return { bind, disconnect, sendInput, sendResize, agentIdRef };
}
