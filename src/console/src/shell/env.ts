/**
 * Host-shell detection and system-bar insets.
 *
 * The console runs in three hosts: a plain browser (cloud / self-hosted), the
 * Electron desktop shell, and the MAUI mobile app. Each embedded host stamps its
 * own user-agent token and injects a bridge object, so host-specific behaviour is
 * opt-in and plain web keeps its current behaviour untouched.
 *
 * Mobile system bars (status bar, display cutout, gesture / 3-button navigation
 * bar) arrive as CSS custom properties set by the app on <html>, so layout can
 * reserve space without JavaScript reading them on every insets change. The
 * zero defaults live in app.css; the same numbers are also on the bridge for the
 * rare cases that need them in JS.
 */

export const LIBRA_DESKTOP_UA = 'LibraDesktop';
export const LIBRA_MOBILE_UA = 'LibraMobile';

export interface LibraMobileInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** On-screen keyboard height; 0 while it is closed. */
  ime: number;
}

export interface LibraMobileBridge {
  /** Current system-bar insets, kept in sync with the CSS custom properties. */
  insets?: LibraMobileInsets;
  /** Matches the status-bar icons to the console theme (light icons on dark UI). */
  setStatusBarStyle?: (style: 'light' | 'dark') => void;
  /** Restarts the embedded service (used by the boot screen's retry action). */
  restartService?: () => Promise<void>;
  /** Transient system toast (Android Toast). */
  toast?: (message: string) => void;
  /** System notification in the app's own channel. */
  notify?: (title: string, body: string) => void;
  onInsets?: (cb: (insets: LibraMobileInsets) => void) => () => void;
}

declare global {
  interface Window {
    libraMobile?: LibraMobileBridge;
    /** Raw native bridge, injected by the mobile host only. */
    libraNative?: {
      setStatusBarStyle?: (style: string) => void;
      restartService?: () => void;
      /** In-app history depth, so the host knows when Back should leave the app. */
      setNavDepth?: (depth: number) => void;
      toast?: (message: string) => void;
      notify?: (title: string, body: string) => void;
    };
  }
}

export function isLibraDesktopShell(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes(LIBRA_DESKTOP_UA) &&
    !!window.libraDesktop
  );
}

/**
 * UA-token only on purpose: the mobile host sets the user agent before any
 * script runs, while its JS bridge is injected asynchronously after the document
 * loads. Deciding host-specific routing on the bridge would therefore race the
 * console's very first render (the setup/login gate) and intermittently show
 * plain-web screens inside the app.
 */
export function isLibraMobileShell(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes(LIBRA_MOBILE_UA);
}

/**
 * True inside any host that owns the backend itself (Electron shell, mobile app).
 * Those hosts decide where the service lives, so the console must not offer the
 * "connect to a web service" entry points a plain browser needs.
 */
export function isEmbeddedShell(): boolean {
  return isLibraDesktopShell() || isLibraMobileShell();
}

/** Keep the native status-bar icons readable against the console's theme. */
export function syncStatusBarStyle(): void {
  if (!isLibraMobileShell()) return;
  const dark = document.documentElement.classList.contains('dark');
  window.libraMobile?.setStatusBarStyle?.(dark ? 'light' : 'dark');
}

/** Transient system toast. No-op outside the mobile app. */
export function nativeToast(message: string): void {
  if (!isLibraMobileShell()) return;
  window.libraNative?.toast?.(message);
}

/** System notification. No-op outside the mobile app. */
export function nativeNotify(title: string, body: string): void {
  if (!isLibraMobileShell()) return;
  window.libraNative?.notify?.(title, body);
}

/**
 * Keep the host informed of the in-app history depth.
 *
 * The SPA router pushes history entries, so the WebView's own back stack is not
 * a reliable signal for "should Back leave the app". React Router stamps the
 * entry index into `history.state.idx`, which is exactly that signal; it is
 * pushed to the host on every navigation instead of being queried, because the
 * Android back press must be answered synchronously.
 */
export function initNavDepthReporting(): void {
  if (!isLibraMobileShell()) return;

  const report = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    window.libraNative?.setNavDepth?.(idx);
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method];
    window.history[method] = function patched(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      report();
      return result;
    } as History[typeof method];
  }

  window.addEventListener('popstate', report);
  report();
}
