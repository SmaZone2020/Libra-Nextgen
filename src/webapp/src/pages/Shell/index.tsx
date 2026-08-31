import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { createTask, getTask } from '../../api/tasks';
import { useAgent } from '../../contexts/AgentContext';
import { useAgentPlatform } from '../../hooks/useAgentPlatform';
import { AgentRequired } from '../../components/AgentRequired';
import { unwrapTaskOutput } from './taskOutput';

export default function ShellPage() {
  const { t } = useTranslation();
  const { agentId, selectedAgent } = useAgent();
  const platform = useAgentPlatform();
  const isWindows = platform === 'windows';
  const termRef = useRef<TerminalHandle>(null);
  const [running, setRunning] = useState(false);
  const [shellMode, setShellMode] = useState<'Shell' | 'PowerShell'>('Shell');
  const inputBufRef = useRef('');

  /** Prompt shown while waiting for input: "Libra-<deviceName> $ " */
  const promptText = useMemo(
    () => `Libra-${selectedAgent?.hostname || agentId.slice(0, 8) || 'agent'} $ `,
    [selectedAgent?.hostname, agentId],
  );

  const print = useCallback((text: string) => {
    termRef.current?.write(text.replace(/\n/g, '\r\n'));
  }, []);

  const renderPrompt = useCallback(() => {
    print(`\r\n${promptText}`);
  }, [print, promptText]);

  const execute = useCallback(async (cmd: string) => {
    if (!agentId || !cmd.trim() || running) return;
    setRunning(true);
    try {
      const task = await createTask({
        agentId,
        commandType: shellMode,
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
      renderPrompt();
      termRef.current?.focus();
    }
  }, [agentId, running, shellMode, print, renderPrompt, t]);

  const handleInput = useCallback((data: string) => {
    if (data === '\r' || data === '\n' || data === '\r\n') {
      const cmd = inputBufRef.current;
      inputBufRef.current = '';
      print('\r\n');
      if (!cmd.trim()) {
        renderPrompt();
        return;
      }
      // clear / cls clear the terminal locally.
      const trimmed = cmd.trim().toLowerCase();
      if (trimmed === 'clear' || trimmed === 'cls') {
        termRef.current?.clear();
        renderPrompt();
        return;
      }
      execute(cmd);
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
    if (data.length > 1) {
      // Paste support: xterm delivers pasted text as one chunk. Strip newlines
      // (buffer is a single command line), echo it and wait for Enter.
      const clean = data.replace(/[\r\n]+/g, ' ');
      inputBufRef.current += clean;
      termRef.current?.write(clean);
      return;
    }
    if (data.length !== 1 || data.charCodeAt(0) < 0x20) return;
    inputBufRef.current += data;
    termRef.current?.write(data);
  }, [execute, print, renderPrompt]);

  useEffect(() => {
    if (agentId) {
      termRef.current?.clear();
      print(`${t('shell.banner')}\r\n`);
      renderPrompt();
    }
  }, [agentId, print, renderPrompt, t]);

  return (
    <div className="space-y-3">
      {!agentId && <AgentRequired />}

      {agentId && (
        <>
          {isWindows && (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={shellMode === 'Shell' ? 'primary' : 'ghost'}
                isDisabled={running}
                onPress={() => setShellMode('Shell')}
                className="rounded-[10px]"
              >
                CMD
              </Button>
              <Button
                size="sm"
                variant={shellMode === 'PowerShell' ? 'primary' : 'ghost'}
                isDisabled={running}
                onPress={() => setShellMode('PowerShell')}
                className="rounded-[10px]"
              >
                PowerShell
              </Button>
              <span className="ml-2 text-xs text-default-500">{t('shell.modeHint')}</span>
            </div>
          )}
          <Terminal
            key={agentId}
            ref={termRef}
            disabled={!agentId}
            onInput={handleInput}
            style={{ height: '100%', width: '100%' }}
          />
        </>
      )}
    </div>
  );
}
