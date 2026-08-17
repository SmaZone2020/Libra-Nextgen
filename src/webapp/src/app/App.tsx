import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bars } from '@gravity-ui/icons';
import { Button, Chip, Dropdown } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { Sidebar } from '../shared/layout/Sidebar';
import LoginPage from '../pages/Login';
import SetupPage from '../pages/Setup';
import Dashboard from '../pages/Dashboard';
import AgentsPage from '../pages/Agents';
import AuditLogsPage from '../pages/AuditLogs';
import ShellPage from '../pages/Shell';
import FileManager from '../pages/FileManager';
import SystemPage from '../pages/System';
import ScreenMonitorPage from '../pages/ScreenMonitor';
import MediaMonitorPage from '../pages/MediaMonitor';
import SoftwareDataPage from '../pages/SoftwareData';
import ProxyBrowserPage from '../pages/ProxyBrowser';
import BuilderPage from '../pages/Builder';
import AboutPage from '../pages/About';
import SettingsPage from '../pages/Settings';
import { getStoredUser, logout, checkSetupStatus } from '../api/auth';
import { getAccountMe, acceptAgreement } from '../api/account';
import { setOnAuthFailed } from '../api/client';
import { consoleWs } from '../ws/consoleWs';
import { NetworkOverlay } from '../components/NetworkOverlay';
import { AgreementModal } from '../components/AgreementModal';
import { AgentProvider, useAgent } from '../contexts/AgentContext';
import type { AgentListItem, UserPermissions } from '../types/models';
import { sidebarItems, sidebarBottomItems } from '../config/site';
import '../i18n';

const pageTransition = {
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94] as const,
};

const SIDEBAR_W = { collapsed: 72, expanded: 256 };


const AGENT_ROUTES = new Set(['/agents', '/shell', '/files', '/system', '/screen', '/media', '/othersoft', '/proxy']);

const PAGE_META_KEYS: Record<string, [string, string]> = {
  '/': ['pageMeta.dashboard.label', 'pageMeta.dashboard.subtitle'],
  '/agents': ['pageMeta.agents.label', 'pageMeta.agents.subtitle'],
  '/screen': ['pageMeta.screen.label', 'pageMeta.screen.subtitle'],
  '/media': ['pageMeta.media.label', 'pageMeta.media.subtitle'],
  '/shell': ['pageMeta.shell.label', 'pageMeta.shell.subtitle'],
  '/files': ['pageMeta.explorer.label', 'pageMeta.explorer.subtitle'],
  '/system': ['pageMeta.system.label', 'pageMeta.system.subtitle'],
  '/othersoft': ['pageMeta.othersoft.label', 'pageMeta.othersoft.subtitle'],
  '/proxy': ['pageMeta.proxyBrowser.label', 'pageMeta.proxyBrowser.subtitle'],
  '/builder': ['pageMeta.builder.label', 'pageMeta.builder.subtitle'],
  '/audit': ['pageMeta.audit.label', 'pageMeta.audit.subtitle'],
  '/about': ['pageMeta.about.label', 'pageMeta.about.subtitle'],
  '/settings': ['pageMeta.settings.label', 'pageMeta.settings.subtitle'],
};

function PageHeader() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const keys = PAGE_META_KEYS[pathname];
  if (!keys) return null;
  return (
    <motion.div
      key={pathname}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      initial={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <h1 className="mt-0.5 text-xl font-semibold tracking-normal text-neutral-950 dark:text-neutral-50">
        {t(keys[0])}
      </h1>
      <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{t(keys[1])}</p>
    </motion.div>
  );
}

function AgentSelector() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { agents, agentId, selectedAgent, selectAgent, disconnect } = useAgent();

  if (!AGENT_ROUTES.has(pathname)) return null;

  // Only online agents are actionable; offline ones are hidden from the picker.
  const onlineAgents = agents.filter((a) => a.status === 'Online');

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <Dropdown>
        <Button
          variant="tertiary"
          className="flex-1 sm:w-[220px] sm:flex-none justify-start"
        >
          {selectedAgent ? `${selectedAgent.hostname} (${selectedAgent.ipAddress})` : t('common.selectAgent')}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            onAction={(key) => selectAgent(String(key))}
            items={onlineAgents}
          >
            {(item: AgentListItem) => (
              <Dropdown.Item key={item.id} id={item.id} textValue={item.hostname}>
                {item.hostname}({item.ipAddress})
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {selectedAgent && (
        <>
          <Button size="sm" variant="tertiary" onPress={disconnect}>
            {t('common.disconnect')}
          </Button>
        </>
      )}
    </div>
  );
}


export function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checking, setChecking] = useState(true);
  const [agreedAt, setAgreedAt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    checkSetupStatus().then(ns => {
      setNeedsSetup(ns);
      setChecking(false);
    }).catch(() => {
      setChecking(false);
    });
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

  if (!user) {
    if (checking) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-neutral-500">Loading...</div>
        </div>
      );
    }
    if (needsSetup) {
      return <SetupPage onSetup={(username, role) => handleLogin(username, role)} />;
    }
    return <LoginPage onLogin={handleLogin} />;
  }

  // Agreement gate: block the whole console until the account accepts the
  // authorized-use agreement. Declining forces a logout.
  if (agreedAt === null) {
    return <AgreementModal onAccept={handleAcceptAgreement} onDecline={handleLogout} />;
  }
  if (agreedAt === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-neutral-500">Loading...</div>
      </div>
    );
  }

  return (
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

function AuthenticatedLayout({
  user,
  collapsed,
  onToggle,
  onLogout,
}: {
  user: { username: string; role: string };
  collapsed: boolean;
  onToggle: (v: boolean) => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const sidebarWidth = collapsed ? SIDEBAR_W.collapsed : SIDEBAR_W.expanded;

  useEffect(() => {
    getAccountMe()
      .then((me) => setPermissions(me.permissions))
      .catch(() => setPermissions(null));
  }, []);

  const canSee = (to: string) => {
    if (!permissions || permissions.fullAccess) return true;
    const key = to === '/' ? 'dashboard' : to.replace('/', '');
    return permissions.allowedPages.includes(key);
  };

  const visibleItems = sidebarItems.filter((i) => canSee(i.to));
  const visibleBottom = sidebarBottomItems.filter((i) => canSee(i.to));

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <NetworkOverlay />
      <Sidebar
        brand="Libra Next"
        collapsed={collapsed}
        items={visibleItems}
        bottomItems={visibleBottom}
        onToggle={onToggle}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <main
        className="sm:pl-[var(--sidebar-w)] transition-all duration-300"
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <header className="border-b border-neutral-200 bg-white dark:bg-neutral-900 dark:border-neutral-800 px-4 py-3 sm:px-6 lg:px-8">
          {/* Mobile: hamburger + title row */}
          <div className="flex items-center gap-3 sm:hidden">
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={() => setMobileSidebarOpen(true)}
            >
              <Bars className="w-5 h-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <PageHeader />
            </div>
            <Dropdown>
              <Button isIconOnly size="sm" variant="ghost">
                <span className="text-sm font-medium">{user.username.slice(0, 2).toUpperCase()}</span>
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu onAction={(key) => { if (key === 'logout') onLogout(); }}>
                  <Dropdown.Item key="user" id="user" textValue={user.username} className="opacity-70">
                    {user.username} ({user.role})
                  </Dropdown.Item>
                  <Dropdown.Item key="logout" id="logout" textValue={t('common.logout')} className="text-danger">
                    {t('common.logout')}
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>

          {/* Mobile: agent selector row */}
          <div className="sm:hidden mt-2">
            <AgentSelector />
          </div>

          {/* Desktop header row */}
          <div className="hidden sm:flex justify-between items-center">
            <PageHeader />
            <div className="flex items-center gap-3">
              <AgentSelector />
              <Dropdown>
                <Button variant="ghost">
                  <span className="text-sm font-medium">{user.username} ({user.role})</span>
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu onAction={(key) => { if (key === 'logout') onLogout(); }}>
                    <Dropdown.Item key="logout" id="logout" textValue={t('common.logout')} className="text-danger">
                      {t('common.logout')}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
          </div>
        </header>

        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              initial={{ opacity: 0, y: 12 }}
              transition={pageTransition}
            >
              <Routes location={location}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/shell" element={<ShellPage />} />
                <Route path="/files" element={<FileManager />} />
                <Route path="/audit" element={<AuditLogsPage />} />
                <Route path="/system" element={<SystemPage />} />
                <Route path="/screen" element={<ScreenMonitorPage />} />
                <Route path="/media" element={<MediaMonitorPage />} />
                <Route path="/othersoft" element={<SoftwareDataPage />} />
                <Route path="/proxy" element={<ProxyBrowserPage />} />
                <Route path="/builder" element={<BuilderPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/about" element={<AboutPage />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
