import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import LoginPage from '../pages/Login';
import SetupPage from '../pages/Setup';
import { getStoredUser, logout, checkSetupStatus } from '../api/auth';
import { acceptAgreement, getAccountMe } from '../api/account';
import { setOnAuthFailed } from '../api/client';
import { consoleWs } from '../ws/consoleWs';
import { NetworkOverlay } from '../components/NetworkOverlay';
import { AgreementModal } from '../components/AgreementModal';
import { AgentProvider } from '../contexts/AgentContext';
import { AuthenticatedLayout, SIDEBAR_W } from './AuthenticatedLayout';
import { DesktopTopBar } from '../desktop/DesktopTopBar';
import '../i18n';

const AUTO_COLLAPSE_CONTENT_MIN = 640;

export function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checking, setChecking] = useState(true);
  const [agreedAt, setAgreedAt] = useState<string | null | undefined>(undefined);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        // Never let the boot probe hang forever (unreachable host, firewall…).
        const ns = await Promise.race([
          checkSetupStatus(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('boot probe timed out')), 6000);
          }),
        ]);
        if (cancelled) return;
        setNeedsSetup(ns);
        setBackendReachable(true);
      } catch {
        if (cancelled) return;
        setBackendReachable(false);
      } finally {
        if (timer) clearTimeout(timer);
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  // Fetch agreement status whenever the user changes.
  useEffect(() => {
    if (!user) {
      setAgreedAt(undefined);
      return;
    }
    getAccountMe()
      .then((me) => setAgreedAt(me.agreedAt ?? null))
      .catch(() => setAgreedAt(null));
  }, [user]);

  const handleAcceptAgreement = async () => {
    try {
      await acceptAgreement();
    } catch {
      /* ignore */
    }
    setAgreedAt(new Date().toISOString());
  };

  const handleToggle = useCallback((v: boolean) => {
    setCollapsed(v);
    localStorage.setItem('sidebar_collapsed', String(v));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const apply = () => {
      const narrow = window.innerWidth - SIDEBAR_W.expanded <= AUTO_COLLAPSE_CONTENT_MIN;
      if (narrow) {
        setCollapsed(true);
      } else {
        setCollapsed(localStorage.getItem('sidebar_collapsed') === 'true');
      }
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  useEffect(() => {
    if (user) {
      consoleWs.connect();
    }
    return () => { consoleWs.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = (username: string, _role: string) => {
    setUser({ username, role: _role });
    consoleWs.connect();
  };

  const handleLogout = () => {
    logout();
    consoleWs.disconnect();
    setUser(null);
  };

  useEffect(() => {
    setOnAuthFailed(() => {
      logout();
      consoleWs.disconnect();
      setUser(null);
    });
    return () => setOnAuthFailed(null);
  }, []);

  // The desktop shell top bar overlaps only the console's empty top margin.
  // Behind the authenticated layout that margin starts after the sidebar, so
  // shift the strip to the right of it (mobile <640px hides the sidebar).
  const inDesktopLayout =
    !!user &&
    agreedAt !== null &&
    agreedAt !== undefined &&
    backendReachable !== false &&
    typeof window !== 'undefined' &&
    window.innerWidth >= 640;
  const sidebarLeft = inDesktopLayout
    ? collapsed
      ? SIDEBAR_W.collapsed
      : SIDEBAR_W.expanded
    : 0;

  let view: ReactNode;
  if (backendReachable === false) {
    // Backend is down from the very start: show the disconnect page (with the
    // backend-address editor) instead of a blank/Loading screen. On recovery
    // we reboot the boot flow so setup/login state is evaluated fresh.
    view = (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
        <NetworkOverlay
          initiallyOffline
          onRecovered={() => window.location.reload()}
        />
      </div>
    );
  } else if (!user) {
    if (checking) {
      view = (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-neutral-500">Loading...</div>
        </div>
      );
    } else if (needsSetup) {
      view = <SetupPage onSetup={(username, role) => handleLogin(username, role)} />;
    } else {
      view = <LoginPage onLogin={handleLogin} />;
    }
  } else if (agreedAt === null) {
    // Agreement gate: block the whole console until the account accepts the
    // authorized-use agreement. Declining forces a logout.
    view = <AgreementModal onAccept={handleAcceptAgreement} onDecline={handleLogout} />;
  } else if (agreedAt === undefined) {
    view = (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-neutral-500">Loading...</div>
      </div>
    );
  } else {
    view = (
      <BrowserRouter>
        <AgentProvider>
          <AuthenticatedLayout
            user={user}
            collapsed={collapsed}
            onToggle={handleToggle}
            onLogout={handleLogout}
          />
        </AgentProvider>
      </BrowserRouter>
    );
  }

  return (
    <>
      <DesktopTopBar sidebarLeft={sidebarLeft} />
      {view}
    </>
  );
}
