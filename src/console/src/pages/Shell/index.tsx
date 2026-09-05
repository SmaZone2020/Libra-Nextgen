import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { createTask, getTask } from '../../api/tasks';
import { useAgent } from '../../contexts/AgentContext';
import { AgentRequired } from '../../components/AgentRequired';
import { unwrapTaskOutput } from './taskOutput';

const MAX_HISTORY = 100;

/** Shell page: a task-mode CMD console presented like an integrated terminal
 *  panel (VSCode/Codex style): fixed cmd mode, live history via ArrowUp/Down,
 *  theme-aware surface and a slim toolbar. */
export default function ShellPage() {
  const { t } = useTranslation();
  const { agentId, selectedAgent } = useAgent();
  const termRef = useRef<TerminalHandle>(null);
  const [running, setRunning] = useState(false);
  const inputBufRef = useRef('');
  const historyRef = useRef<string[]>([]);
  const historyCursorRef = useRef(0);
  const draftRef = useRef('');

  const hostLabel = selectedAgent?.hostname || agentId.slice(0, 8) || 'agent';
  const isOnline = selectedAgent?.status === 'Online';

  /** Prompt shown while waiting for input: "Libra-<deviceName> $ " */
  const promptText = useMemo(
    () => `Libra-${hostLabel} $ `,
    [hostLabel],
  );

  const print = useCallback((text: string) => {
    termRef.current?.write(text.replace(/\n/g, '\r\n'));
  }, []);

  const renderPrompt = useCallback(() => {
    print(`\r\n${promptText}`);
  }, [print, promptText]);

  const paintLine = useCallback((text: string) => {
    // Clear the whole current line (prompt + typed text) and redraw it.
    termRef.current?.write('\r\x1b[2K');
    termRef.current?.write(promptText + text);
  }, [promptText]);

  const resetHistoryCursor = useCallback(() => {
    historyCursorRef.current = historyRef.current.length;
    draftRef.current = '';
  }, []);

  const moveHistory = useCallback((dir: -1 | 1) => {
    if (running) return;
    const history = historyRef.current;
    const max = history.length;
    if (max === 0) return;
    let next = historyCursorRef.current + dir;
    if (next < 0) next = 0;
    if (next > max) next = max;
    if (next === historyCursorRef.current) return;
    if (historyCursorRef.current === max) {
      // Leaving the "new input" slot saves the current draft for ArrowDown.
      draftRef.current = inputBufRef.current;
    }
    historyCursorRef.current = next;
    const text = next === max ? draftRef.current : history[next] ?? '';
    inputBufRef.current = text;
    paintLine(text);
  }, [paintLine, running]);

  const clearScreen = useCallback(() => {
    termRef.current?.clear();
    termRef.current?.write(promptText);
  }, [promptText]);

  const execute = useCallback(async (cmd: string) => {
    if (!agentId || !cmd.trim() || running) return;
    setRunning(true);
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
      renderPrompt();
      termRef.current?.focus();
    }
  }, [agentId, running, print, renderPrompt, t]);

  const handleInput = useCallback((data: string) => {
    // History navigation — xterm delivers arrows as escape sequences.
    if (data === '\x1b[A' || data === '\x1bOA') {
      moveHistory(-1);
      return;
    }
    if (data === '\x1b[B' || data === '\x1bOB') {
      moveHistory(1);
      return;
    }
    // Ignore other cursor/control escape sequences (left/right/home/end…).
    if (data.startsWith('\x1b[') || data.startsWith('\x1bO')) return;

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
        clearScreen();
        return;
      }
      if (!running && historyRef.current[historyRef.current.length - 1] !== cmd.trim()) {
        historyRef.current.push(cmd.trim());
        if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
      }
      resetHistoryCursor();
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
      resetHistoryCursor();
      renderPrompt();
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
  }, [clearScreen, execute, moveHistory, print, renderPrompt, resetHistoryCursor, running]);

  useEffect(() => {
    if (agentId) {
      termRef.current?.clear();
      print(`${t('shell.banner')}\r\n`);
      renderPrompt();
      resetHistoryCursor();
    }
  }, [agentId, print, renderPrompt, resetHistoryCursor, t]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-3">
      {!agentId && <AgentRequired />}

      {agentId && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-black/[0.07] shadow-[0_18px_44px_-26px_rgba(0,0,0,0.4)] dark:border-white/10">
          {/* Integrated terminal toolbar */}
          <div
            className="flex h-9 shrink-0 items-center gap-2.5 border-b border-black/[0.06] px-3.5 dark:border-white/[0.08]"
            style={{ backgroundColor: 'var(--lw-terminal-bg)', color: 'var(--lw-terminal-fg)' }}
          >
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-neutral-500'}`}
            />
            <span className="min-w-0 truncate font-mono text-[12px] font-medium">
              {hostLabel}
            </span>
            <span className="text-[11px] opacity-45">cmd</span>
            <button
              type="button"
              onClick={clearScreen}
              className="ml-auto rounded-[8px] px-2 py-1 text-[11px] opacity-70 transition-opacity hover:opacity-100"
            >
              {t('shell.clear')}
            </button>
          </div>

          <Terminal
            key={agentId}
            ref={termRef}
            className="w-full flex-1"
            disabled={!agentId}
            onInput={handleInput}
          />
        </div>
      )}
    </div>
  );
}
