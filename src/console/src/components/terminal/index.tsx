import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from 'xterm';
import type { ITheme } from 'xterm';
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

/** Default font stack: native Windows/macOS monospace first (Cascadia Mono /
 *  Consolas / SF Mono — always available, exactly one cell per ASCII glyph,
 *  no webfont loading race), bundled JetBrains Mono as a lighter cross-platform
 *  option, and a CJK font at the end (2 cells per glyph). */
const DEFAULT_FONT =
  '"Cascadia Mono", Consolas, ui-monospace, "JetBrainsMono", "LibraTermCJK", monospace';

// VS Code-like terminal palette. Colors resolve from the app's live design
// tokens so the terminal follows the light/dark theme (and wallpaper frost)
// instead of being a permanently dark box.
function cssVar(name: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function resolveTerminalTheme(): ITheme {
  const dark = document.documentElement.classList.contains('dark');
  const foreground = cssVar('--lw-terminal-fg', dark ? '#e6e9ee' : '#23272e');
  const accent = cssVar('--color-accent', dark ? '#7aa2f7' : '#2563eb');
  return {
    // Transparent background: the terminal melts into the workspace surface
    // (and any wallpaper / frost behind it) instead of painting its own box.
    background: 'transparent',
    foreground,
    cursor: accent,
    cursorAccent: foreground,
    selectionBackground: dark ? 'rgba(122, 162, 247, 0.32)' : 'rgba(37, 99, 235, 0.24)',
    // Subtle, theme-matched ANSI set (calm blues/purples, softened yellow/red)
    // — closer to Codex/VSCode "One Dark"-ish terminals than the raw neon set.
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
  { className, style, onInput, onResize, disabled, fontFamily },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  // Callbacks are held in refs so the terminal instance is created exactly once
  // on mount: parent re-renders (e.g. ShellPage toggling `running`) change the
  // handler identities, and recreating xterm on that cleared all output.
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const fontFamilyRef = useRef(fontFamily);
  fontFamilyRef.current = fontFamily;

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
    let themeObserver: MutationObserver | null = null;

    // Create the terminal synchronously so the ref is usable immediately
    // (shell output arriving before webfonts finish is not lost). Cell size
    // is re-measured once the bundled font is ready.
    const FONT = fontFamilyRef.current ?? DEFAULT_FONT;
    const t = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: true,
      fontFamily: FONT,
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 10000,
      theme: resolveTerminalTheme(),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon());
    t.open(container);
    term = t;
    fit = f;

    // Live theme switching: re-resolve colors whenever the document theme
    // class changes (light <-> dark) — also fires on first connection.
    const applyTheme = () => {
      if (termRef.current) {
        try {
          termRef.current.options.theme = resolveTerminalTheme();
        } catch { /* keep previous theme on invalid colors */ }
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

    // Fit the terminal and report geometry only once the container actually
    // has a usable size (cols/rows > 0). On first mount the container may not
    // be laid out yet (page transition / placeholder swap), so retry until it
    // is — otherwise the shell is created with a degenerate 0-size PTY.
    let retries = 0;
    const tryFit = () => {
      if (disposed) return false;
      try { f.fit(); } catch { /* container may still be sizing */ }
      if (t.cols > 0 && t.rows > 0) {
        onResizeRef.current?.(t.cols, t.rows);
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
      if (t.cols > 0 && t.rows > 0) onResizeRef.current?.(t.cols, t.rows);
    });
    ro.observe(container);

    termRef.current = t;
    fitRef.current = f;

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

  return (
    <div
      ref={containerRef}
      className={`min-h-0 overflow-hidden ${className ?? ''}`}
      style={style}
    />
  );
});

export default TerminalView;
