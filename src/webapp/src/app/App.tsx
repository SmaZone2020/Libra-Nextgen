import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Button, Chip, ComboBox, Input, Label, ListBox } from '@heroui/react';
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
import OtherSoftwarePage from '../pages/OtherSoftware';
import { getStoredUser, logout, checkSetupStatus } from '../api/auth';
import { setOnAuthFailed } from '../api/client';
import { consoleWs } from '../ws/consoleWs';
import { AgentProvider, useAgent } from '../contexts/AgentContext';
import type { AgentListItem } from '../types/models';
import { sidebarItems } from '../config/site';
import '../i18n';

const pageTransition = {
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94] as const,
};

const SIDEBAR_W = { collapsed: 72, expanded: 256 };


const AGENT_ROUTES = new Set(['/agents', '/shell', '/files', '/system', '/screen', '/media', '/othersoft']);

const PAGE_META_KEYS: Record<string, [string, string]> = {
  '/': ['pageMeta.dashboard.label', 'pageMeta.dashboard.subtitle'],
  '/agents': ['pageMeta.agents.label', 'pageMeta.agents.subtitle'],
  '/screen': ['pageMeta.screen.label', 'pageMeta.screen.subtitle'],
  '/media': ['pageMeta.media.label', 'pageMeta.media.subtitle'],
  '/shell': ['pageMeta.shell.label', 'pageMeta.shell.subtitle'],
  '/files': ['pageMeta.explorer.label', 'pageMeta.explorer.subtitle'],
  '/system': ['pageMeta.system.label', 'pageMeta.system.subtitle'],
  '/othersoft': ['pageMeta.othersoft.label', 'pageMeta.othersoft.subtitle'],
  '/audit': ['pageMeta.audit.label', 'pageMeta.audit.subtitle'],
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
      <h1 className="mt-0.5 text-xl font-semibold tracking-normal text-neutral-950">
        {t(keys[0])}
      </h1>
      <p className="mt-0.5 text-sm text-neutral-600">{t(keys[1])}</p>
    </motion.div>
  );
}

function AgentSelector() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { agents, agentId, selectedAgent, selectAgent, disconnect } = useAgent();

  if (!AGENT_ROUTES.has(pathname)) return null;

  return (
    <div className="flex items-center gap-3">
      <ComboBox
        defaultItems={agents}
        selectedKey={agentId || null}
        onSelectionChange={(key) => key && selectAgent(String(key))}
        className="w-[220px]"
      >
        <Label className="sr-only">Agent</Label>
        <ComboBox.InputGroup>
          <Input placeholder={t('common.selectAgent')} />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        <ComboBox.Popover>
          <ListBox>
            {(item: AgentListItem) => (
              <ListBox.Item id={item.id} textValue={item.hostname}>
                {item.hostname}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>

      {selectedAgent && (
        <>
          <Chip size="sm" variant="soft" color="success">{selectedAgent.hostname}</Chip>
          <Chip size="sm" variant="soft">{selectedAgent.ipAddress}</Chip>
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

  useEffect(() => {
    checkSetupStatus().then(ns => {
      setNeedsSetup(ns);
      setChecking(false);
    }).catch(() => {
      setChecking(false);
    });
  }, []);

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
  const sidebarWidth = collapsed ? SIDEBAR_W.collapsed : SIDEBAR_W.expanded;

  return (
    <div className="min-h-screen bg-neutral-50">
      <Sidebar
        brand="Libra Next"
        collapsed={collapsed}
        items={sidebarItems}
        onToggle={onToggle}
      />

      <main
        className="sm:pl-[var(--sidebar-w)] pb-14 sm:pb-0 transition-all duration-300"
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <header className="border-b border-neutral-200 bg-white px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <PageHeader />
          <div className="flex items-center gap-3">
            <AgentSelector />
            <Chip size="sm" variant="soft">
              {user.username} ({user.role})
            </Chip>
            <Button size="sm" variant="ghost" onPress={onLogout}>
              {t('common.logout')}
            </Button>
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
                <Route path="/othersoft" element={<OtherSoftwarePage />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
