import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberField } from '@heroui/react';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { createTask, getTask } from '../../api/tasks';
import { useAgent } from '../../contexts/AgentContext';
import { AgentRequired } from '../../components/AgentRequired';
import { unwrapTaskOutput } from './taskOutput';

const MAX_HISTORY = 100;
const FONT_MIN = 2;
const FONT_MAX = 96;

/** Number of terminal cells a BMP character occupies (CJK/fullwidth = 2). */
function cellWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  const wide =
    (c >= 0x1100 && c <= 0x115f) ||
    c === 0x2329 || c === 0x232a ||
    (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe10 && c <= 0xfe19) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6);
  return wide ? 2 : 1;
}

function cellsOf(text: string): number {
  let n = 0;
  for (const ch of text) n += cellWidth(ch);
  return n;
}

/** Shell page: task-mode CMD console in the style of an integrated terminal.
 *  Buffer model supports in-line editing (←/→/Home/End/Delete/Backspace),
 *  history navigation (↑/↓) and paste at the cursor position. */
export default function ShellPage() {
  const { t } = useTranslation();
  const { agentId, selectedAgent } = useAgent();
  const termRef = useRef<TerminalHandle>(null);
  const [running, setRunning] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const inputBufRef = useRef('');
  const cursorRef = useRef(0);
  const historyRef = useRef<string[]>([]);
  const historyCursorRef = useRef(0);
  const draftRef = useRef('');

  const hostLabel = selectedAgent?.hostname || agentId.slice(0, 8) || 'agent';
  const isOnline = selectedAgent?.status === 'Online';

  const promptText = useMemo(
    () => `Libra-${hostLabel} $ `,
    [hostLabel],
  );

  const print = useCallback((text: string) => {
    termRef.current?.write(text.replace(/\n/g, '\r\n'));
  }, []);

  /** Redraw prompt + text and park the cursor at `pos` (in characters). */
  const redrawLine = useCallback((text: string, pos: number) => {
    const term = termRef.current;
    if (!term) return;
    term.write('\r\x1b[2K');
    term.write(promptText + text);
    const right = cellsOf(text.slice(pos));
    if (right > 0) term.write(`\x1b[${right}D`);
  }, [promptText]);

  const renderPrompt = useCallback(() => {
    print(`\r\n${promptText}`);
    cursorRef.current = 0;
    inputBufRef.current = '';
  }, [print, promptText]);

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
    cursorRef.current = text.length;
    redrawLine(text, text.length);
  }, [redrawLine, running]);

  const clearScreen = useCallback(() => {
    termRef.current?.clear();
    inputBufRef.current = '';
    cursorRef.current = 0;
    termRef.current?.write(promptText);
  }, [promptText]);

  const insertText = useCallback((chunk: string) => {
    if (!chunk) return;
    const text = inputBufRef.current;
    const pos = cursorRef.current;
    const next = text.slice(0, pos) + chunk + text.slice(pos);
    inputBufRef.current = next;
    cursorRef.current = pos + chunk.length;
    redrawLine(next, pos + chunk.length);
  }, [redrawLine]);

  const deleteBefore = useCallback(() => {
    const text = inputBufRef.current;
    const pos = cursorRef.current;
    if (pos <= 0) return;
    const next = text.slice(0, pos - 1) + text.slice(pos);
    inputBufRef.current = next;
    cursorRef.current = pos - 1;
    redrawLine(next, pos - 1);
  }, [redrawLine]);

  const deleteAtCursor = useCallback(() => {
    const text = inputBufRef.current;
    const pos = cursorRef.current;
    if (pos >= text.length) return;
    const next = text.slice(0, pos) + text.slice(pos + 1);
    inputBufRef.current = next;
    redrawLine(next, pos);
  }, [redrawLine]);

  /** Move the cursor without redrawing the whole line. */
  const moveCursor = useCallback((deltaCells: number) => {
    const term = termRef.current;
    if (!term || deltaCells === 0) return;
    if (deltaCells < 0) term.write(`\x1b[${-deltaCells}D`);
    else term.write(`\x1b[${deltaCells}C`);
  }, []);

  const setCursor = useCallback((pos: number) => {
    const text = inputBufRef.current;
    const clamped = Math.max(0, Math.min(text.length, pos));
    const from = cursorRef.current;
    if (clamped === from) return;
    moveCursor(cellsOf(text.slice(Math.min(from, clamped), Math.max(from, clamped))) * (clamped > from ? 1 : -1));
    cursorRef.current = clamped;
  }, [moveCursor]);

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
    // History navigation.
    if (data === '\x1b[A' || data === '\x1bOA') {
      moveHistory(-1);
      return;
    }
    if (data === '\x1b[B' || data === '\x1bOB') {
      moveHistory(1);
      return;
    }
    // Cursor keys.
    if (data === '\x1b[D' || data === '\x1bOD') { setCursor(cursorRef.current - 1); return; }
    if (data === '\x1b[C' || data === '\x1bOC') { setCursor(cursorRef.current + 1); return; }
    if (data === '\x1b[H' || data === '\x1b[1~') { setCursor(0); return; }
    if (data === '\x1b[F' || data === '\x1b[4~') { setCursor(inputBufRef.current.length); return; }
    if (data === '\x1b[3~') { deleteAtCursor(); return; }
    // Other escape sequences (PgUp/PgDn/Alt…): ignore.
    if (data.startsWith('\x1b[') || data.startsWith('\x1bO')) return;

    if (data === '\r' || data === '\n' || data === '\r\n') {
      const cmd = inputBufRef.current;
      inputBufRef.current = '';
      cursorRef.current = 0;
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
      deleteBefore();
      return;
    }
    // Ctrl+A / Ctrl+E — jump to line start / end.
    if (data === '\x01') { setCursor(0); return; }
    if (data === '\x05') { setCursor(inputBufRef.current.length); return; }
    if (data === '\x03') {
      inputBufRef.current = '';
      cursorRef.current = 0;
      print('^C');
      resetHistoryCursor();
      renderPrompt();
      return;
    }
    if (data.length > 1) {
      // Paste support: strip newlines and insert at the cursor.
      insertText(data.replace(/[\r\n]+/g, ' '));
      return;
    }
    if (data.length !== 1 || data.charCodeAt(0) < 0x20) return;
    insertText(data);
  }, [
    clearScreen, deleteAtCursor, deleteBefore, execute, insertText,
    moveHistory, print, renderPrompt, resetHistoryCursor, running, setCursor,
  ]);

  useEffect(() => {
    if (agentId) {
      termRef.current?.clear();
      print(`${t('shell.banner')}\r\n`);
      renderPrompt();
      resetHistoryCursor();
    }
  }, [agentId, print, renderPrompt, resetHistoryCursor, t]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      {!agentId && <AgentRequired />}

      {agentId && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2.5 pb-1 sm:px-4 sm:pb-2">
          {/* Integrated terminal toolbar: name | font size | clear */}
          <div className="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 text-[var(--lw-terminal-fg)]">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-neutral-400'}`}
              />
              <span className="min-w-0 truncate font-mono text-[12px] font-medium opacity-80">
                {hostLabel}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-40">cmd</span>
            </div>

            {/* Centered font-size stepper */}
            <div className="flex items-center gap-1.5">
              <NumberField
                aria-label={t('shell.fontSize')}
                value={fontSize}
                onChange={(v) => setFontSize(Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(Number(v ?? fontSize)))))}
                minValue={FONT_MIN}
                maxValue={FONT_MAX}
                step={1}
              >
                <NumberField.Group className="flex items-center gap-0.5 rounded-[9px] bg-black/[0.05] px-1 py-0.5 dark:bg-white/[0.1]">
                  <NumberField.DecrementButton className="grid h-6 w-6 place-items-center rounded-[7px] text-[14px] opacity-60 transition hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/15">
                    −
                  </NumberField.DecrementButton>
                  <NumberField.Input className="w-8 bg-transparent text-center font-mono text-[12px] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  <NumberField.IncrementButton className="grid h-6 w-6 place-items-center rounded-[7px] text-[14px] opacity-60 transition hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/15">
                    +
                  </NumberField.IncrementButton>
                </NumberField.Group>
              </NumberField>
              <span className="font-mono text-[11px] opacity-45">px</span>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={clearScreen}
                className="rounded-[8px] px-2 py-1 font-mono text-[11px] opacity-60 transition-opacity hover:opacity-100"
              >
                {t('shell.clear')}
              </button>
            </div>
          </div>

          <Terminal
            key={agentId}
            ref={termRef}
            className="w-full flex-1"
            disabled={!agentId}
            fontSize={fontSize}
            onInput={handleInput}
          />
        </div>
      )}
    </div>
  );
}
