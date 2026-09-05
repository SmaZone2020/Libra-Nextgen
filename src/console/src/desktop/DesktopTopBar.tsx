import { useEffect, useState } from 'react';

// UA token appended by the Libra desktop shell (Electron). Must stay in sync
// with `demo/main.js` DESKTOP_TOKEN. Plain browsers never carry it, so every
// desktop-only behavior below stays inert for regular web usage.
export const LIBRA_DESKTOP_UA = 'LibraDesktop';

export const DESKTOP_TOPBAR_H = 32;

export interface DesktopAppInfo {
  version: string;
  userDataDir: string;
  payloadTag: string | null;
  rid: string;
}

export interface DesktopStorageSettings {
  mode: 'sqlite' | 'mongo';
  connectString?: string;
  dbPath?: string;
  fallback?: boolean;
}

export interface LibraDesktopBridge {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  retry?: () => Promise<void>;
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
  // Desktop-shell capabilities (older shells may not expose them).
  getAppInfo?: () => Promise<DesktopAppInfo>;
  runUpdate?: () => Promise<{ ok: boolean; error?: string }>;
  openDataDir?: () => Promise<void>;
  setStorageConfig?: (settings: DesktopStorageSettings) => Promise<boolean>;
  restartService?: () => Promise<void>;
}

declare global {
  interface Window {
    libraDesktop?: LibraDesktopBridge;
  }
}

export function isLibraDesktopShell(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes(LIBRA_DESKTOP_UA) &&
    !!window.libraDesktop
  );
}

interface DesktopTopBarProps {
  /** Width of the console sidebar (0 when there is none, e.g. auth screens). */
  sidebarLeft?: number;
}

/**
 * Transparent, draggable top strip rendered by the console itself when it runs
 * inside the frameless desktop shell. It overlaps only the empty top margin of
 * the console layout, so no page control is ever covered.
 */
export function DesktopTopBar({ sidebarLeft = 0 }: DesktopTopBarProps) {
  const [maximized, setMaximized] = useState(false);
  const enabled = isLibraDesktopShell();

  useEffect(() => {
    if (!enabled) return;
    const bridge = window.libraDesktop!;
    let alive = true;
    bridge
      .isMaximized()
      .then((v) => {
        if (alive) setMaximized(v);
      })
      .catch(() => {
        /* window already closed */
      });
    const unsubscribe = bridge.onMaximizeChange(setMaximized);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [enabled]);

  if (!enabled) return null;

  const toggleMaximize = () => window.libraDesktop!.toggleMaximize();

  return (
    <div
      className="libra-topbar"
      data-maximized={maximized}
      style={{ left: sidebarLeft, height: DESKTOP_TOPBAR_H }}
      onDoubleClick={toggleMaximize}
    >
      <div className="libra-topbar__controls" onDoubleClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="libra-tb-btn"
          title="最小化"
          aria-label="最小化"
          onClick={() => window.libraDesktop!.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="libra-tb-btn"
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
          onClick={toggleMaximize}
        >
          <svg className="icon-max" width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
          <svg className="icon-restore" width="10" height="10" viewBox="0 0 10 10">
            <path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="libra-tb-btn libra-tb-btn--close"
          title="关闭"
          aria-label="关闭"
          onClick={() => window.libraDesktop!.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
