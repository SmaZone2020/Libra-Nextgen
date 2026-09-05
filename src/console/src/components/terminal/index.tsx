import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';

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
  /** Font size in px; applied live (2-96 recommended). */
  fontSize?: number;
}

// Scoped CSS injected into the terminal's shadow root. The shadow boundary
// keeps ALL app styles away from xterm's measurement + rendering.
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
    font-family: ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace;
  }
  .xterm,
  .xterm * {
    font-family: ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace !important;
  }
  .xterm,
  .xterm-viewport,
  .xterm-screen,
  .xterm canvas,
  .xterm-rows,
  .xterm-rows * {
    background: transparent !important;
    background-color: transparent !important;
  }
`;

type PendingOp = { type: 'clear' } | { type: 'write'; text: string };

function resolveTerminalTheme(): ITheme {
  const dark = document.documentElement.classList.contains('dark');
  const foreground = dark ? '#d7dae0' : '#1f2329';
  const accent = dark ? '#7aa2f7' : '#2563eb';
  return {
    background: 'rgba(0,0,0,0)',
    foreground,
    cursor: accent,
    cursorAccent: foreground,
    selectionBackground: dark ? 'rgba(122, 162, 247, 0.32)' : 'rgba(37, 99, 235, 0.22)',
    black: dark ? '#3b4252' : '#3f4653',
    red: dark ? '#e06c75' : '#d64550',
    green: dark ? '#98c379' : '#3d8f52',
    yellow: dark ? '#e5c07b' : '#9c7c1f',
    blue: dark ? '#61afef' : '#2563eb',
    magenta: dark ? '#c678dd' : '#8b3fd4',
    cyan: dark ? '#56b6c2' : '#0e7f94',
    white: dark ? '#abb2bf' : '#4b5563',
    brightBlack: dark ? '#636d83' : '#9aa3af',
    brightRed: dark ? '#ff7a8a' : '#e5484d',
    brightGreen: dark ? '#a6e3a1' : '#30a46c',
    brightYellow: dark ? '#f2cc8f' : '#b5952a',
    brightBlue: dark ? '#8ab4f8' : '#3b82f6',
    brightMagenta: dark ? '#d29af0' : '#9f4bd4',
    brightCyan: dark ? '#7dd3fc' : '#0aa2c0',
    brightWhite: dark ? '#d8dee9' : '#1f2328',
  };
}

const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  { className, style, onInput, onResize, disabled, fontSize = 18 },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const pendingRef = useRef<PendingOp[]>([]);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  const flushPending = (term: Terminal) => {
    for (const op of pendingRef.current.splice(0)) {
      if (op.type === 'clear') term.clear();
      else if (op.text) term.write(op.text);
    }
  };

  const enqueue = (op: PendingOp) => {
    const term = termRef.current;
    if (term) {
      if (op.type === 'clear') term.clear();
      else if (op.text) term.write(op.text);
    } else {
      pendingRef.current.push(op);
    }
  };

  useImperativeHandle(ref, () => ({
    write(text: string) {
      if (text) enqueue({ type: 'write', text });
    },
    clear() {
      enqueue({ type: 'clear' });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.replaceChildren();

    const style = document.createElement('style');
    style.textContent = `${xtermCss}\n${SHADOW_EXTRA_CSS}`;
    shadow.appendChild(style);

    const box = document.createElement('div');
    box.className = 'lw-term-box';
    shadow.appendChild(box);

    let disposed = false;
    let started = false;
    let waitTries = 0;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ro: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;

    const createTerminal = () => {
      const t = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        convertEol: true,
        allowTransparency: true,
        fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace',
        fontSize: fontSizeRef.current,
        letterSpacing: 0,
        scrollback: 10000,
        theme: resolveTerminalTheme(),
      });
      const f = new FitAddon();
      t.loadAddon(f);
      t.loadAddon(new WebLinksAddon());
      t.open(box);
      term = t;
      fit = f;
      termRef.current = t;
      fitRef.current = f;
      flushPending(t);

      // Live theme switching for the parent app's light/dark toggle.
      const applyTheme = () => {
        if (termRef.current) {
          try {
            termRef.current.options.theme = resolveTerminalTheme();
          } catch { /* keep previous theme */ }
        }
      };
      themeObserver = new MutationObserver(applyTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      t.onData((data) => {
        if (disabledRef.current) return;
        onInputRef.current?.(data);
      });
      t.onResize(({ cols, rows }) => onResizeRef.current?.(cols, rows));

      let fitTries = 0;
      const tryFit = () => {
        if (disposed) return false;
        // xterm defaults to 80x24, so cols>0 alone does NOT mean the container
        // is measurable. Only treat the terminal as fitted once the box has a
        // real size.
        if (box.clientWidth === 0 || box.clientHeight === 0) {
          if (fitTries++ < 60) setTimeout(tryFit, 100);
          return false;
        }
        try { f.fit(); } catch { /* ignore */ }
        if (t.cols > 0 && t.rows > 0) {
          onResizeRef.current?.(t.cols, t.rows);
          return true;
        }
        if (fitTries++ < 60) setTimeout(tryFit, 100);
        return false;
      };

      requestAnimationFrame(tryFit);
      setTimeout(tryFit, 0);

      ro = new ResizeObserver(() => {
        if (disposed) return;
        try { f.fit(); } catch { /* ignore */ }
        if (box.clientWidth > 0 && box.clientHeight > 0 && t.cols > 0 && t.rows > 0) {
          onResizeRef.current?.(t.cols, t.rows);
        }
      });
      ro.observe(box);
    };

    // Some mounts happen before layout gives the terminal a size (e.g. an
    // agent is selected while already sitting on the Shell page). Wait for a
    // measurable box instead of creating a blank 80x24 terminal forever.
    const startWhenReady = () => {
      if (disposed || started) return;
      if (box.clientWidth > 0 && box.clientHeight > 0) {
        started = true;
        createTerminal();
        return;
      }
      if (waitTries++ < 200) {
        // 100ms * 200 = up to 20s for late layout (tab switch/animations).
        setTimeout(startWhenReady, 100);
      }
    };
    startWhenReady();

    return () => {
      disposed = true;
      ro?.disconnect();
      themeObserver?.disconnect();
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live font-size changes: update xterm and re-fit to reflow the rows.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      term.options.fontSize = fontSizeRef.current;
    } catch { /* ignore */ }
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* ignore */ }
      if (term.cols > 0 && term.rows > 0) onResizeRef.current?.(term.cols, term.rows);
    });
  }, [fontSize]);

  return (
    <div
      ref={hostRef}
      className={`min-h-0 overflow-hidden ${className ?? ''}`}
      style={style}
    />
  );
});

export default TerminalView;
