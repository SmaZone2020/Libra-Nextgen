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

    // Fit the terminal and report geometry only once the container actually
    // has a usable size (cols/rows > 0). On first mount the container may not
    // be laid out yet (page transition / placeholder swap), so retry until it
    // is — otherwise the shell is created with a degenerate 0-size PTY.
    let retries = 0;
    const tryFit = () => {
      if (disposed) return false;
      try { f.fit(); } catch { /* container may still be sizing */ }
      if (t.cols > 0 && t.rows > 0) {
        onResize?.(t.cols, t.rows);
        return true;
      }
      if (retries++ < 10) setTimeout(tryFit, 100);
      return false;
    };

    // Fit once after layout settles, then again once the webfont is loaded.
    // fonts.ready alone does NOT force-load an unused webfont, so explicitly
    // load a Latin sample first — otherwise xterm measures a fallback cell
    // width (7px) and then renders the wider JetBrains glyphs (7.8px) into
    // those cells, which visually misaligns letters like a/w/m.
    requestAnimationFrame(tryFit);
    setTimeout(tryFit, 0);
    const fontSample = 'WmsXZ012aA';
    Promise.all([
      document.fonts.load(`13px ${FONT}`, fontSample),
      document.fonts.load('13px "JetBrainsMono"', fontSample),
      document.fonts.ready,
    ])
      .catch(() => { /* fallback fonts still fine */ })
      .then(() => {
        if (disposed) return;
        // Force xterm to re-measure the cell now that the real font is ready.
        t.options.fontFamily = FONT;
        tryFit();
      });

    ro = new ResizeObserver(() => {
      if (disposed) return;
      try { f.fit(); } catch { /* ignore */ }
      if (t.cols > 0 && t.rows > 0) onResize?.(t.cols, t.rows);
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
