import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

export interface TerminalHandle {
  write(text: string): void;
  clear(): void;
  focus(): void;
  /** Fit the terminal to its container and report the new geometry. */
  fit(): { cols: number; rows: number };
}

interface Props {
  className?: string;
  style?: React.CSSProperties;
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  disabled?: boolean;
}

const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  { className, style, onInput, onResize, disabled },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useImperativeHandle(ref, () => ({
    write(text: string) {
      if (text) termRef.current?.write(text);
    },
    clear() {
      termRef.current?.clear();
    },
    focus() {
      termRef.current?.focus();
    },
    fit() {
      const fit = fitRef.current;
      if (!fit) return { cols: 80, rows: 24 };
      try {
        fit.fit();
      } catch { /* container hidden */ }
      const term = termRef.current;
      if (!term) return { cols: 80, rows: 24 };
      return { cols: term.cols, rows: term.rows };
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    // xterm sizes every cell from the monospace assumption and renders CJK as
    // exactly 2 cells wide. To stay aligned, the font must be genuinely
    // monospace with half-width == full-width/2 for Latin AND CJK:
    //   - Windows ships "NSimSun" (新宋体): measured W=7, 中=14 → perfect 2:1
    //   - Noto Sans Mono CJK SC / Sarasa Mono SC / Maple Mono are the
    //     cross-platform equivalents when installed.
    // Generic stacks (Consolas/Courier) make Latin monospace but their half
    // width != full-width/2, so CJK text visually misaligns — avoid them as
    // the primary font.
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: [
        '"Noto Sans Mono CJK SC"',
        '"Sarasa Mono SC"',
        '"Sarasa Mono"',
        '"Maple Mono"',
        '"Maple Mono CN"',
        '"NSimSun"',
        '"DejaVu Sans Mono"',
        'ui-monospace',
        'Menlo',
        'Consolas',
        'monospace',
      ].join(', '),
      fontSize: 13,
      lineHeight: 1.0,
      scrollback: 10000,
      theme: { background: '#1a1b1e' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    // Fit twice: first pass right after mount, second after layout settles.
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* ignore */ }
      onResize?.(term.cols, term.rows);
    });

    term.onData((data) => {
      if (disabledRef.current) return;
      onInput?.(data);
    });

    term.onResize(({ cols, rows }) => onResize?.(cols, rows));

    termRef.current = term;
    fitRef.current = fit;

    // Keep the terminal sized to its container.
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [onInput, onResize]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: 'hidden', height: '100%', ...style }}
    />
  );
});

export default TerminalView;
