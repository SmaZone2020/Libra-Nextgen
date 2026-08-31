import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { createTask, getTask } from '../../api/tasks';
import { useAgent } from '../../contexts/AgentContext';
import { AgentRequired } from '../../components/AgentRequired';
import { unwrapTaskOutput } from './taskOutput';

export default function ShellPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const termRef = useRef<TerminalHandle>(null);
  const [running, setRunning] = useState(false);
  const inputBufRef = useRef('');

  const print = useCallback((text: string) => {
    termRef.current?.write(text.replace(/\n/g, '\r\n'));
  }, []);

  const execute = useCallback(async (cmd: string) => {
    if (!agentId || !cmd.trim() || running) return;
    setRunning(true);
    print(`\r\n$ ${cmd}\r\n`);
    try {
      const task = await createTask({
        agentId,
        commandType: 'Shell',
        command: cmd,
        arguments: [],
        timeoutSeconds: 60,
      });
      let done = false;
      for (let i = 0; i < 240 && !done; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const cur = await getTask(task.id);
        if (cur.status === 'Completed' || cur.status === 'Failed' || cur.status === 'Cancelled') {
          done = true;
          const text = unwrapTaskOutput(cur.output ?? cur.error ?? '');
          if (text.trim()) print(text);
          print('\r\n');
        }
      }
      if (!done) print(`\r\n${t('shell.timeout')}\r\n`);
    } catch (e) {
      print(`\r\n${t('shell.error', { msg: e instanceof Error ? e.message : String(e) })}\r\n`);
    } finally {
      setRunning(false);
      termRef.current?.focus();
    }
  }, [agentId, running, print]);

  const handleInput = useCallback((data: string) => {
    if (data === '\r' || data === '\n' || data === '\r\n') {
      const cmd = inputBufRef.current;
      inputBufRef.current = '';
      print('\r\n');
      if (cmd.trim()) execute(cmd);
      return;
    }
    if (data === '\x7f' || data === '\b') {
      // backspace
      if (inputBufRef.current.length > 0) {
        inputBufRef.current = inputBufRef.current.slice(0, -1);
        termRef.current?.write('\b \b');
      }
      return;
    }
    if (data === '\x03') {
      inputBufRef.current = '';
      print('^C');
      return;
    }
    if (data.length !== 1 || data.charCodeAt(0) < 0x20) return;
    inputBufRef.current += data;
    termRef.current?.write(data);
  }, [execute, print]);

  useEffect(() => {
    if (agentId) {
      termRef.current?.clear();
      print(`${t('shell.banner')}\r\n`);
    }
  }, [agentId, print, t]);

  return (
    <div className="space-y-3">
      {!agentId && <AgentRequired />}

      {agentId && (
        <Terminal
          key={agentId}
          ref={termRef}
          disabled={!agentId}
          onInput={handleInput}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
}
