import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
import { AntennaSignal } from '@gravity-ui/icons';
import { Sidebar, type NavItem, type SidebarSection } from '../shared/layout/Sidebar';
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
import { sidebarSections, sidebarFootItems } from '../config/site';
import { PageHeader } from './PageHeader';
import { AgentSelector } from './AgentSelector';
import { MobileTabBar } from './mobile/MobileTabBar';
import { AppDrawer } from './mobile/AppDrawer';
import MePage from '../pages/Me';
import { isWallpaperEnabled, useWallpaperPrefs } from '../utils/wallpaper';

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
  const { t } = useTranslation();
  const location = useLocation();
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [appsOpen, setAppsOpen] = useState(false);
  const sidebarWidth = collapsed ? SIDEBAR_W.collapsed : SIDEBAR_W.expanded;
  const registeredPlugins = useRegisteredPlugins();
  const wallpaper = useWallpaperPrefs();

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

  // Permission-filter every section; plugin-manager children are filled below.
  const visibleSections = sidebarSections
    .map((section): SidebarSection | null => {
      const items = section.items
        .map((item): NavItem | null => {
          if (item.children && item.children.length > 0) {
            const children = item.children.filter((c) => canSee(c.to));
            if (children.length === 0 && !canSee(item.to)) return null;
            return { ...item, children };
          }
          if (!canSee(item.to)) return null;
          return item;
        })
        .filter((i): i is NavItem => i !== null);
      if (items.length === 0) return null;
      return { ...section, items };
    })
    .filter((s): s is SidebarSection => s !== null);

  // Fill the plugin-manager group children with enabled plugin pages.
  const pluginChildren: NavItem['children'] = registeredPlugins.map((p) => ({
    icon: resolvePluginIcon(p.manifest.entry?.icon),
    to: p.route,
    label: p.manifest.name || p.pluginId,
  }));
  const finalSections = visibleSections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.label === 'nav.pluginManager'
        ? { ...item, children: pluginChildren }
        : item,
    ),
  }));

  // Pinned footer items (settings / about) — permission-filtered like sections.
  const footItems = sidebarFootItems.filter((i) => canSee(i.to));

  // Route → display name for plugin page headers.
  const pluginLabels = new Map(registeredPlugins.map((p) => [p.route, p.manifest.name || p.pluginId]));

  const isFullHeight = FULL_HEIGHT_ROUTES.has(location.pathname) || isAiRoute;
  const isPadded = !NO_PADDING_ROUTES.has(location.pathname) && !isAiRoute;

  return (
    <div
      className="lw-frame"
      data-wallpaper={isWallpaperEnabled(wallpaper) ? 'on' : 'off'}
      style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <NetworkOverlay />
      <Sidebar
        brand="Libra Next"
        collapsed={collapsed}
        sections={finalSections}
        foot={footItems}
        user={user}
        onLogout={onLogout}
        onToggle={onToggle}
      />

      <main className="relative z-10 flex h-full min-w-0 flex-col sm:pl-[var(--sidebar-w)]">
        {/* Workspace main surface: right/bottom flush, top inset with the
            rounded top-left corner; mobile stays fully flush. */}
        <div className="flex min-h-0 w-full flex-1 flex-col pt-0 sm:pt-8 lg:pt-12">
          <section className="lw-workspace flex min-h-0 w-full flex-1 flex-col overflow-hidden">
            {/* Desktop-only header — lives INSIDE the workspace, no own panel. */}
            <header className="hidden shrink-0 items-center justify-between gap-4 px-4 pt-3.5 pb-1 sm:flex sm:px-6 lg:px-8 lg:pt-4">
              <PageHeader pluginLabels={pluginLabels} />
              <div className="flex items-center gap-2.5">
                <AgentSelector />
                <EventViewer />
                {/* AI subscription trigger: rightmost, opens the Ai page modal. */}
                {isAiRoute && (
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={t('ai.eventSub')}
                    onPress={() => window.dispatchEvent(new Event('libra:ai-open-events'))}
                  >
                    <AntennaSignal className="size-4.5" />
                  </Button>
                )}
              </div>
            </header>

            <div
              className={`lw-workspace-body flex min-h-0 flex-1 flex-col ${
                isFullHeight ? 'overflow-hidden' : 'overflow-y-auto'
              } ${
                isPadded
                  ? 'px-3 pt-2 pb-24 sm:px-5 sm:pt-3 sm:pb-6 lg:px-7'
                  : 'pb-24 sm:pb-0'
              }`}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={isAiRoute ? 'ai' : location.pathname}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  initial={{ opacity: 0, y: 12 }}
                  transition={pageTransition}
                  className={isFullHeight ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-col'}
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
            </div>
          </section>
        </div>

        {/* Mobile floating bottom navigation */}
        <MobileTabBar appsOpen={appsOpen} onAppsToggle={() => setAppsOpen((v) => !v)} />
      </main>

      {/* Mobile app drawer (Feishu-style) */}
      <AppDrawer open={appsOpen} onClose={() => setAppsOpen(false)} permissions={permissions} />
    </div>
  );
}
