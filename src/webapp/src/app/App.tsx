import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Button, Chip } from '@heroui/react';
import { ChartLine, Display, Folder, ListTimeline, Terminal } from '@gravity-ui/icons';
import { Sidebar } from '../shared/layout/Sidebar';
import LoginPage from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import AgentsPage from '../pages/Agents';
import AuditLogsPage from '../pages/AuditLogs';
import ShellPage from '../pages/Shell';
import FileManager from '../pages/FileManager';
import { getStoredUser, logout } from '../api/auth';
import { setOnAuthFailed } from '../api/client';
import { consoleWs } from '../ws/consoleWs';

const pageTransition = {
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94] as const,
};

const SIDEBAR_W = { collapsed: 72, expanded: 256 };

const pageMeta: Record<string, { label: string; subtitle: string }> = {
  '/': { label: 'Dashboard', subtitle: 'Overview' },
  '/agents': { label: 'Agents', subtitle: 'Agent list' },
  '/shell': { label: 'Shell', subtitle: 'Remote terminal' },
  '/files': { label: 'File Manager', subtitle: 'File browser' },
  '/audit': { label: 'Audit Logs', subtitle: 'Security audit trail' },
};

function PageHeader() {
  const { pathname } = useLocation();
  const meta = pageMeta[pathname];
  if (!meta) return null;
  return (
    <motion.div
      key={pathname}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      initial={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <h1 className="mt-0.5 text-xl font-semibold tracking-normal text-neutral-950">
        {meta.label}
      </h1>
      <p className="mt-0.5 text-sm text-neutral-600">{meta.subtitle}</p>
    </motion.div>
  );
}

const sidebarItems = [
  { icon: ChartLine, to: '/', label: 'Dashboard' },
  { icon: Display, to: '/agents', label: 'Agents' },
  { icon: Terminal, to: '/shell', label: 'Shell' },
  { icon: Folder, to: '/files', label: 'File Manager' },
  { icon: ListTimeline, to: '/audit', label: 'Audit Logs' },
];

export function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

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
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <BrowserRouter>
      <AuthenticatedLayout
        user={user}
        collapsed={collapsed}
        onToggle={handleToggle}
        onLogout={handleLogout}
      />
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
            <Chip size="sm" variant="soft">
              {user.username} ({user.role})
            </Chip>
            <Button size="sm" variant="ghost" onPress={onLogout}>
              Logout
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
              </Routes>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
