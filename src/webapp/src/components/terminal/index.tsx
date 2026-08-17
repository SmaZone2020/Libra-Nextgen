import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';
import '../../styles/terminal-fonts.css';

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
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ro: ResizeObserver | null = null;

    // xterm sizes every cell from the monospace assumption and renders CJK as
    // exactly 2 cells wide. JetBrains Mono (bundled, Latin) gives modern
    // monospace Latin; 'LibraTermCJK' (Noto Sans Mono CJK / Sarasa / NSimSun)
    // renders CJK as 2 cells.
    const FONT = '"JetBrainsMono", "LibraTermCJK", ui-monospace, monospace';

    const createTerminal = () => {
      if (disposed) return;
      const t = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 1.0,
        scrollback: 10000,
        theme: { background: '#1a1b1e' },
      });
      const f = new FitAddon();
      t.loadAddon(f);
      t.loadAddon(new WebLinksAddon());
      t.open(container);
      term = t;
      fit = f;

      t.onData((data) => {
        if (disabledRef.current) return;
        onInput?.(data);
      });
      t.onResize(({ cols, rows }) => onResize?.(cols, rows));

      // Fit once after layout settles, then again once webfonts are loaded.
      requestAnimationFrame(() => {
        try { f.fit(); } catch { /* ignore */ }
        onResize?.(t.cols, t.rows);
      });
      document.fonts.ready.then(() => {
        if (disposed) return;
        // Force xterm to re-measure cell size now that the real font is ready.
        t.options.fontFamily = FONT;
        try { f.fit(); } catch { /* ignore */ }
        onResize?.(t.cols, t.rows);
      });

      ro = new ResizeObserver(() => {
        try { f.fit(); } catch { /* ignore */ }
      });
      ro.observe(container);

      termRef.current = t;
      fitRef.current = f;
    };

    // Wait for the bundled webfont to be available before creating xterm, so
    // the cell size is measured from JetBrains Mono instead of a fallback.
    Promise.all([
      document.fonts.load('13px "JetBrainsMono"'),
      document.fonts.load('normal 13px "JetBrainsMono"'),
    ])
      .catch(() => { /* fallback fonts still work */ })
      .then(() => document.fonts.ready)
      .then(() => { if (!disposed) createTerminal(); });

    return () => {
      disposed = true;
      ro?.disconnect();
      term?.dispose();
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
