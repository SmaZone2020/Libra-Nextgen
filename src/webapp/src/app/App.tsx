import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { PageKey } from '../config/site';
import { pages } from '../config/site';
import { Sidebar } from '../shared/layout/Sidebar';
import { HomePage } from '../pages/Home';
import { AboutPage } from '../pages/About';

// ─── Page transition ────────────────────────────────────────────────

const pageTransition = {
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94] as const,
};

// ─── Sidebar width ──────────────────────────────────────────────────

const SIDEBAR_W = { collapsed: 72, expanded: 256 };

// ─── Page header ────────────────────────────────────────────────────

function PageHeader({ page }: { page: PageKey }) {
  const item = pages.find((p) => p.id === page);
  if (!item) return null;
  return (
    <motion.div
      key={page}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      initial={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <p className="text-sm font-medium text-blue-700">HeroUI Pro React</p>
      <h1 className="mt-0.5 text-xl font-semibold tracking-normal text-neutral-950">
        {item.label}
      </h1>
      <p className="mt-0.5 text-sm text-neutral-600">{item.subtitle}</p>
    </motion.div>
  );
}

// ─── App ────────────────────────────────────────────────────────────

export function App() {
  const [page, setPage] = useState<PageKey>('Home');
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  const handleToggle = useCallback((v: boolean) => {
    setCollapsed(v);
    localStorage.setItem('sidebar_collapsed', String(v));
  }, []);

  const sidebarWidth = collapsed ? SIDEBAR_W.collapsed : SIDEBAR_W.expanded;

  return (
    <div className="min-h-screen bg-neutral-50">
      <Sidebar
        brand="Libra Next"
        collapsed={collapsed}
        currentPage={page}
        items={pages}
        onNavigate={(id) => setPage(id as PageKey)}
        onToggle={handleToggle}
      />

      <main
        className="sm:pl-[var(--sidebar-w)] pb-14 sm:pb-0 transition-all duration-300"
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <header className="border-b border-neutral-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
          <PageHeader page={page} />
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
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
