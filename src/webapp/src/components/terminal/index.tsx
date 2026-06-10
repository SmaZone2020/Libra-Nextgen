import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?(\x07|\x1b\\)/g, '');
}

export interface TerminalHandle {
  write(text: string): void;
  writeln(text: string): void;
  clear(): void;
  focus(): void;
}

interface Props {
  className?: string;
  style?: React.CSSProperties;
  onInput?: (text: string) => void;
  disabled?: boolean;
}

interface OutputLine {
  text: string;
  id: number;
}

let lineId = 0;

const Terminal = forwardRef<TerminalHandle, Props>(function Terminal(
  { className, style, onInput, disabled },
  ref,
) {
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
  const outputRef = useRef<OutputLine[]>([]);

  const [inputBuffer, setInputBuffer] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const inputRef = useRef({ buffer: '', cursor: 0 });

  const [historyIdx, setHistoryIdx] = useState(-1);
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');

  const [focused, setFocused] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useImperativeHandle(ref, () => ({
    write(text: string) {
      if (!text) return;
      text = stripAnsi(text);
      const updated = [...outputRef.current];
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\r') continue;
        if (ch === '\n') {
          updated.push({ text: '', id: ++lineId });
        } else if (ch === '\b') {
          const last = updated[updated.length - 1];
          if (last && last.text.length > 0) {
            updated[updated.length - 1] = { text: last.text.slice(0, -1), id: last.id };
          }
        } else {
          if (updated.length === 0) updated.push({ text: '', id: ++lineId });
          updated[updated.length - 1] = {
            text: updated[updated.length - 1]!.text + ch,
            id: updated[updated.length - 1]!.id,
          };
        }
      }
      outputRef.current = updated;
      setOutputLines([...updated]);
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    },
    writeln(text: string) {
      this.write(text + '\n');
    },
    clear() {
      outputRef.current = [];
      setOutputLines([]);
    },
    focus() {
      textareaRef.current?.focus();
    },
  }), []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [outputLines, inputBuffer]);

  const updateInput = useCallback((buffer: string, cursor: number) => {
    inputRef.current = { buffer, cursor };
    setInputBuffer(buffer);
    setCursorPos(cursor);
  }, []);

  const send = useCallback((text: string) => {
    if (onInput) onInput(text);
  }, [onInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;

    const { buffer, cursor } = inputRef.current;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const h = historyRef.current;
      if (h.length === 0) return;
      const newIdx = historyIdx === -1 ? 0 : Math.min(historyIdx + 1, h.length - 1);
      if (historyIdx === -1) draftRef.current = buffer;
      setHistoryIdx(newIdx);
      const cmd = h[h.length - 1 - newIdx]!;
      updateInput(cmd, cmd.length);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === -1) return;
      const newIdx = historyIdx - 1;
      setHistoryIdx(newIdx);
      if (newIdx === -1) {
        updateInput(draftRef.current, draftRef.current.length);
      } else {
        const h = historyRef.current;
        const cmd = h[h.length - 1 - newIdx]!;
        updateInput(cmd, cmd.length);
      }
      return;
    }

    if (historyIdx !== -1) setHistoryIdx(-1);

    if (e.key === 'Enter') {
      e.preventDefault();
      const h = historyRef.current;
      if (buffer && (h.length === 0 || h[h.length - 1] !== buffer)) {
        h.push(buffer);
      }
      send(buffer + '\r\n');
      updateInput('', 0);
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (cursor > 0) {
        updateInput(buffer.slice(0, cursor - 1) + buffer.slice(cursor), cursor - 1);
      }
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      if (cursor < buffer.length) {
        updateInput(buffer.slice(0, cursor) + buffer.slice(cursor + 1), cursor);
      }
      return;
    }

    if (e.key === 'ArrowLeft') { e.preventDefault(); if (cursor > 0) updateInput(buffer, cursor - 1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (cursor < buffer.length) updateInput(buffer, cursor + 1); return; }
    if (e.key === 'Home') { e.preventDefault(); updateInput(buffer, 0); return; }
    if (e.key === 'End') { e.preventDefault(); updateInput(buffer, buffer.length); return; }

    if (e.key === 'Tab') {
      e.preventDefault();
      updateInput(buffer.slice(0, cursor) + '\t' + buffer.slice(cursor), cursor + 1);
      return;
    }

    if (e.key === 'Escape') { e.preventDefault(); updateInput('', 0); return; }

    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      switch (e.key) {
        case 'c': e.preventDefault(); send('\x03'); updateInput('', 0); return;
        case 'd': e.preventDefault(); send('\x04'); return;
        case 'l': e.preventDefault(); outputRef.current = []; setOutputLines([]); send('\x0c'); updateInput('', 0); return;
        case 'z': e.preventDefault(); send('\x1a'); return;
        case 'a': e.preventDefault(); updateInput(buffer, 0); return;
        case 'e': e.preventDefault(); updateInput(buffer, buffer.length); return;
        case 'k': e.preventDefault(); updateInput(buffer.slice(0, cursor), cursor); return;
        case 'u': e.preventDefault(); updateInput(buffer.slice(cursor), 0); return;
        case 'w': {
          e.preventDefault();
          const before = buffer.slice(0, cursor).replace(/\S+$/, '');
          const after = buffer.slice(cursor);
          const trimmed = before.endsWith(' ') ? before.trimEnd() + ' ' : before;
          updateInput(trimmed + after, trimmed.length);
          return;
        }
        default: return;
      }
    }

    if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
      e.preventDefault();
      updateInput(buffer.slice(0, cursor) + e.key + buffer.slice(cursor), cursor + 1);
      return;
    }

    e.preventDefault();
  }, [disabled, send, updateInput, historyIdx]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const { buffer, cursor } = inputRef.current;
    updateInput(buffer.slice(0, cursor) + text + buffer.slice(cursor), cursor + text.length);
  }, [updateInput]);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);
  const handleContainerClick = useCallback(() => { textareaRef.current?.focus(); }, []);

  useEffect(() => {
    if (!disabled) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        setFocused(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [disabled]);

  const showCursor = focused && !disabled;

  const cursorEl = showCursor ? (
    <span className="inline-block w-[7px] h-[1em] align-middle ml-[1px] animate-pulse" style={{ background: '#3b82f6' }} />
  ) : (
    <span className="inline-block w-[1px] h-[1em] align-middle ml-[1px] opacity-0">&nbsp;</span>
  );

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className={`font-mono text-sm leading-5 overflow-auto outline-none ${className ?? ''}`}
      style={{ background: '#1a1b1e', color: '#e4e4e7', padding: '12px 16px', cursor: 'text', ...style }}
    >
      <textarea
        ref={textareaRef}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Terminal input"
        style={{ position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', opacity: 0, border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', padding: 0, zIndex: -1 }}
      />

      {outputLines.map((line, idx) => {
        const isLast = idx === outputLines.length - 1;
        return (
          <div key={line.id} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {line.text || (isLast && !disabled ? '' : ' ')}
            {isLast && !disabled && (
              <>
                <span>{inputBuffer.slice(0, cursorPos)}</span>
                {cursorEl}
                <span>{inputBuffer.slice(cursorPos)}</span>
              </>
            )}
          </div>
        );
      })}

      {outputLines.length === 0 && !disabled && (
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          <span>{inputBuffer.slice(0, cursorPos)}</span>
          {cursorEl}
          <span>{inputBuffer.slice(cursorPos)}</span>
        </div>
      )}
    </div>
  );
});

export default Terminal;
