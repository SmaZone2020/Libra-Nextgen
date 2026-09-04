import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Sidebar, type NavItem } from '../shared/layout/Sidebar';
import Dashboard from '../pages/Dashboard';
import AgentsPage from '../pages/Agents';
import AgentDetailPage from '../pages/Agents/AgentDetailPage';
import AuditLogsPage from '../pages/AuditLogs';
import ShellPage from '../pages/Shell';
import FileManager from '../pages/FileManager';
import SystemPage from '../pages/System';
import SoftwareDataPage from '../pages/SoftwareData';
import ProxyBrowserPage from '../pages/ProxyBrowser';
import BuilderPage from '../pages/Builder';
import AboutPage from '../pages/About';
import SettingsPage, { SettingDetail } from '../pages/Settings';
import PluginsPage from '../pages/Plugins';
import AiPage from '../pages/Ai';
import { useRegisteredPlugins } from '../plugins/registry';
import { resolvePluginIcon } from '../plugins/icons';
import { getAccountMe } from '../api/account';
import { NetworkOverlay } from '../components/NetworkOverlay';
import { EventViewer } from '../components/EventViewer';
import type { UserPermissions } from '../types/models';
import { sidebarItems, sidebarBottomItems } from '../config/site';
import { PageHeader } from './PageHeader';
import { AgentSelector } from './AgentSelector';
import { MobileTabBar } from './mobile/MobileTabBar';
import { AppDrawer } from './mobile/AppDrawer';
import MePage from '../pages/Me';

const pageTransition = {
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94] as const,
};

export const SIDEBAR_W = { collapsed: 72, expanded: 256 };

export function AuthenticatedLayout({
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
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [appsOpen, setAppsOpen] = useState(false);
  const sidebarWidth = collapsed ? SIDEBAR_W.collapsed : SIDEBAR_W.expanded;
  const registeredPlugins = useRegisteredPlugins();

  useEffect(() => {
    getAccountMe()
      .then((me) => setPermissions(me.permissions))
      .catch(() => setPermissions(null));
  }, []);

  // Close the app drawer whenever the route changes (drawer navigation, tabs…).
  useEffect(() => {
    setAppsOpen(false);
  }, [location.pathname]);

  const canSee = (to: string) => {
    if (!permissions || permissions.fullAccess) return true;
    const key = to === '/' ? 'dashboard' : to.replace('/', '');
    return permissions.allowedPages.includes(key);
  };

  const NO_PADDING_ROUTES = new Set(['/shell']);
  const FULL_HEIGHT_ROUTES = new Set(['/shell']);
  const isAiRoute = location.pathname === '/ai' || location.pathname.startsWith('/ai/');
  const visibleItems = sidebarItems
    .map((item): NavItem | null => {
      if (item.children && item.children.length > 0) {
        const children = item.children.filter((c) => canSee(c.to));
        if (children.length === 0) return null;
        return { ...item, children };
      }
      // Plugins manager group (placeholder children) is filled below.
      if (item.label === 'nav.pluginManager') {
        if (!canSee(item.to)) return null;
        return item;
      }
      if (!canSee(item.to)) return null;
      return item;
    })
    .filter((i): i is NavItem => i !== null);

  // Fill the plugin-manager group children with enabled plugin pages.
  const pluginChildren: NavItem['children'] = registeredPlugins.map((p) => ({
    icon: resolvePluginIcon(p.manifest.entry?.icon),
    to: p.route,
    label: p.manifest.name || p.pluginId,
  }));
  const finalItems = visibleItems.map((item) =>
    item.label === 'nav.pluginManager'
      ? { ...item, children: pluginChildren }
      : item,
  );

  const visibleBottom = sidebarBottomItems.filter((i) => canSee(i.to));

  // Route → display name for plugin page headers.
  const pluginLabels = new Map(registeredPlugins.map((p) => [p.route, p.manifest.name || p.pluginId]));

  return (
    <div className="h-screen overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      <NetworkOverlay />
      <Sidebar
        brand="Libra Next"
        collapsed={collapsed}
        items={finalItems}
        bottomItems={visibleBottom}
        user={user}
        onLogout={onLogout}
        onToggle={onToggle}
      />

      <main
        className="sm:pl-[var(--sidebar-w)] flex h-full min-w-0 flex-col transition-all duration-300"
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        {/* Desktop-only header; mobile has no top bar. */}
        <header className="hidden shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 sm:flex dark:bg-neutral-900 dark:border-neutral-800 sm:px-6 lg:px-8">
          <PageHeader pluginLabels={pluginLabels} />
          <div className="flex items-center gap-3">
            <EventViewer />
            <AgentSelector />
          </div>
        </header>

        <div
          className={`${FULL_HEIGHT_ROUTES.has(location.pathname) || isAiRoute ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'} ${NO_PADDING_ROUTES.has(location.pathname) || isAiRoute ? '' : 'px-4 py-6 sm:px-6 lg:px-8'}`}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={isAiRoute ? 'ai' : location.pathname}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              initial={{ opacity: 0, y: 12 }}
              transition={pageTransition}
              className={FULL_HEIGHT_ROUTES.has(location.pathname) || isAiRoute ? 'flex min-h-0 flex-1 flex-col' : ''}
            >
              <Routes location={location}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/agents/:agentId" element={<AgentDetailPage />} />
                <Route path="/shell" element={<ShellPage />} />
                <Route path="/files" element={<FileManager />} />
                <Route path="/audit" element={<AuditLogsPage />} />
                <Route path="/system" element={<SystemPage />} />
                <Route path="/othersoft" element={<SoftwareDataPage />} />
                <Route path="/proxy" element={<ProxyBrowserPage />} />
                <Route path="/builder" element={<BuilderPage />} />
                <Route path="/ai" element={<AiPage />} />
                <Route path="/ai/:sessionId" element={<AiPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/:settingId" element={<SettingDetail />} />
                <Route path="/plugins" element={<PluginsPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route
                  path="/me"
                  element={<MePage user={user} permissions={permissions} onLogout={onLogout} />}
                />
                {registeredPlugins.map((p) => {
                  const Page = p.Page;
                  return <Route key={p.pluginId} path={p.route} element={<Page />} />;
                })}
              </Routes>
            </motion.div>
          </AnimatePresence>

          {/* Clearance under content for the floating bottom nav (mobile only) */}
          <div className="h-32 shrink-0 sm:hidden" aria-hidden="true" />
        </div>

        {/* Mobile floating bottom navigation */}
        <MobileTabBar appsOpen={appsOpen} onAppsToggle={() => setAppsOpen((v) => !v)} />
      </main>

      {/* Mobile app drawer (Feishu-style) */}
      <AppDrawer open={appsOpen} onClose={() => setAppsOpen(false)} permissions={permissions} />
    </div>
  );
}
