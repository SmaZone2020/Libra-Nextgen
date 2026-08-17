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
  /** Font family stack; default is JetBrains Mono (Latin) + CJK fallback. */
  fontFamily?: string;
}

/** Default: JetBrains Mono (bundled) for modern monospace Latin, with CJK
 *  routed to a monospace CJK font (2 cells). */
const DEFAULT_FONT = '"JetBrainsMono", "LibraTermCJK", ui-monospace, monospace';

/** Fully-aligned mode: use a monospace CJK font for the whole terminal so
 *  half-width == full-width/2 exactly (Chinese and Latin align perfectly,
 *  at the cost of a Song-style (NSimSun) look when no modern font exists). */
const CJK_FONT = '"LibraTermCJK", "NSimSun", "Noto Sans Mono CJK SC", "Sarasa Mono SC", monospace';

const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  { className, style, onInput, onResize, disabled, fontFamily },
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

    // Create the terminal synchronously so the ref is usable immediately
    // (shell output arriving before webfonts finish is not lost). Cell size
    // is re-measured once the bundled font is ready.
    const FONT = fontFamily ?? DEFAULT_FONT;
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
      if (disposed) return;
      try { f.fit(); } catch { /* container may still be sizing */ }
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

    return () => {
      disposed = true;
      ro?.disconnect();
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [onInput, onResize, fontFamily]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: 'hidden', height: '100%', ...style }}
    />
  );
});

export default TerminalView;
