import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIBRA_DESKTOP_UA,
  LIBRA_MOBILE_UA,
  isEmbeddedShell,
  isLibraDesktopShell,
  isLibraMobileShell,
} from './env';

/**
 * Host detection decides which entry points the console shows (only a plain
 * browser may offer "connect to a web service"), so the three hosts must stay
 * distinguishable and a plain browser must never look embedded.
 */
function stubHost(userAgent: string, bridges: { desktop?: boolean; mobile?: boolean } = {}) {
  vi.stubGlobal('navigator', { userAgent });
  const win = globalThis as unknown as { window?: Record<string, unknown> };
  win.window = {
    ...(bridges.desktop ? { libraDesktop: {} } : {}),
    ...(bridges.mobile ? { libraMobile: {} } : {}),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shell host detection', () => {
  it('treats a plain browser as not embedded', () => {
    stubHost('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
    expect(isLibraDesktopShell()).toBe(false);
    expect(isLibraMobileShell()).toBe(false);
    expect(isEmbeddedShell()).toBe(false);
  });

  it('detects the desktop shell from its UA token and bridge', () => {
    stubHost(`Mozilla/5.0 Chrome/120 ${LIBRA_DESKTOP_UA}/0.1.0`, { desktop: true });
    expect(isLibraDesktopShell()).toBe(true);
    expect(isEmbeddedShell()).toBe(true);
  });

  it('detects the mobile app from its UA token alone', () => {
    // The mobile bridge is injected after the document loads, so host detection
    // must not depend on it: the first render already has to know.
    stubHost(`Mozilla/5.0 Linux; Android 14 ${LIBRA_MOBILE_UA}`);
    expect(isLibraMobileShell()).toBe(true);
    expect(isEmbeddedShell()).toBe(true);
  });

  it('does not treat a desktop UA as mobile and vice versa', () => {
    stubHost(`Mozilla/5.0 ${LIBRA_DESKTOP_UA}/0.1.0`, { desktop: true });
    expect(isLibraMobileShell()).toBe(false);

    stubHost(`Mozilla/5.0 ${LIBRA_MOBILE_UA}`, { mobile: true });
    expect(isLibraDesktopShell()).toBe(false);
  });
});
