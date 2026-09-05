import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from 'xterm';
import type { ITheme } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import xtermCss from 'xterm/css/xterm.css?inline';

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

// Scoped CSS injected into the terminal's shadow root. The shadow boundary
// keeps ALL app styles (Tailwind preflight, heroUI, the global proportional
// "vivo Sans" reset) away from xterm's measurement + rendering.
const SHADOW_EXTRA_CSS = `
  :host {
    display: block;
    min-height: 0;
    min-width: 0;
  }
  .lw-term-box {
    height: 100%;
    width: 100%;
    min-height: 0;
    background: #111;
  }
`;

function resolveTerminalTheme(): ITheme | null {
  // Temporarily disabled during font-spacing diagnosis: we run with xterm's
  // default black theme exactly like the working standalone test page.
  return null;
}

const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  { className, style, onInput, onResize, disabled },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

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
    const host = hostRef.current;
    if (!host) return;

    // Shadow DOM isolates xterm from every app stylesheet (fonts, preflight,
    // component css). This reproduces the clean official-demo environment.
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.replaceChildren();

    const style = document.createElement('style');
    style.textContent = `${xtermCss}\n${SHADOW_EXTRA_CSS}`;
    shadow.appendChild(style);

    const box = document.createElement('div');
    box.className = 'lw-term-box';
    shadow.appendChild(box);

    let disposed = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ro: ResizeObserver | null = null;

    // EXACT same options as the working standalone test page (terminal-test):
    // xterm defaults for font/line-height/customGlyphs, black default theme,
    // fontSize 14, explicit letterSpacing 0. No transparency yet — prove the
    // spacing is fixed first, then re-add transparency as a separate step.
    const t = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 14,
      letterSpacing: 0,
      scrollback: 10000,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon());
    t.open(box);
    term = t;
    fit = f;

    t.onData((data) => {
      if (disabledRef.current) return;
      onInputRef.current?.(data);
    });
    t.onResize(({ cols, rows }) => onResizeRef.current?.(cols, rows));

    let retries = 0;
    const tryFit = () => {
      if (disposed) return false;
      try { f.fit(); } catch { /* may still be sizing */ }
      if (t.cols > 0 && t.rows > 0) {
        onResizeRef.current?.(t.cols, t.rows);
        return true;
      }
      if (retries++ < 10) setTimeout(tryFit, 100);
      return false;
    };

    requestAnimationFrame(tryFit);
    setTimeout(tryFit, 0);

    ro = new ResizeObserver(() => {
      if (disposed) return;
      try { f.fit(); } catch { /* ignore */ }
      if (t.cols > 0 && t.rows > 0) onResizeRef.current?.(t.cols, t.rows);
    });
    ro.observe(box);

    termRef.current = t;
    fitRef.current = f;

    return () => {
      disposed = true;
      ro?.disconnect();
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      className={`min-h-0 overflow-hidden ${className ?? ''}`}
      style={style}
    />
  );
});

export default TerminalView;
