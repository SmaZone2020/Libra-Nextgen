import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { PageKey } from '../config/site';
import { pages } from '../config/site';
import { Sidebar } from '../shared/layout/Sidebar';
import { HomePage } from '../pages/Home';
import { AboutPage } from '../pages/About';
import LoginPage from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import AgentsPage from '../pages/Agents';
import { getStoredUser, logout } from '../api/auth';
import { consoleWs } from '../ws/consoleWs';

const pageTransition = {
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94] as const,
};

const SIDEBAR_W = { collapsed: 72, expanded: 256 };

function PageHeader({ page }: { page: PageKey }) {
  const item = [...pages, { id: 'Dashboard', label: 'Dashboard', subtitle: 'Overview' },
    { id: 'Agents', label: 'Agents', subtitle: 'Agent list' }].find((p) => p.id === page);
  if (!item) return null;
  return (
    <motion.div
      key={page}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      initial={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <p className="text-sm font-medium text-emerald-600">Libra-Nextgen C2</p>
      <h1 className="mt-0.5 text-xl font-semibold tracking-normal text-neutral-950 dark:text-white">
        {item.label}
      </h1>
      <p className="mt-0.5 text-sm text-neutral-600 dark:text-zinc-400">{item.subtitle}</p>
    </motion.div>
  );
}

export function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [page, setPage] = useState<PageKey>('Home');
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  const handleToggle = useCallback((v: boolean) => {
    setCollapsed(v);
    localStorage.setItem('sidebar_collapsed', String(v));
  }, []);

  const handleLogin = (username: string, _role: string) => {
    setUser({ username, role: _role });
    consoleWs.connect();
  };

  const handleLogout = () => {
    logout();
    consoleWs.disconnect();
    setUser(null);
  };

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const sidebarWidth = collapsed ? SIDEBAR_W.collapsed : SIDEBAR_W.expanded;

  // Sidebar items — dashboard and agents are C2-specific
  const sidebarItems = [
    ...pages,
    { id: 'Dashboard' as PageKey, label: 'Dashboard', subtitle: 'Overview' },
    { id: 'Agents' as PageKey, label: 'Agents', subtitle: 'Agent list' },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-zinc-950 dark:text-white">
      <Sidebar
        brand="Libra Next"
        collapsed={collapsed}
        currentPage={page}
        items={sidebarItems as any}
        onNavigate={(id) => setPage(id as PageKey)}
        onToggle={handleToggle}
      />

      <main
        className="sm:pl-[var(--sidebar-w)] pb-14 sm:pb-0 transition-all duration-300"
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <header className="border-b border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <PageHeader page={page} />
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              {user.username} ({user.role})
            </span>
            <button
              onClick={handleLogout}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              initial={{ opacity: 0, y: 12 }}
              transition={pageTransition}
            >
              {page === 'Home' && <HomePage />}
              {page === 'About' && <AboutPage />}
              {page === 'Dashboard' && <Dashboard />}
              {page === 'Agents' && <AgentsPage />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
