import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
import { AntennaSignal } from '@gravity-ui/icons';
import { Sidebar, type NavItem, type SidebarSection } from '../shared/layout/Sidebar';
import Dashboard from '../pages/Dashboard';
import NodesPage from '../pages/Nodes';
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
import { UpdatePrompter } from '../components/UpdatePrompter';
import { EventViewer } from '../components/EventViewer';
import type { UserPermissions } from '../types/models';
import { sidebarSections, sidebarFootItems } from '../config/site';
import { PageHeader } from './PageHeader';
import { AgentSelector } from './AgentSelector';
import { MobileTabBar } from './mobile/MobileTabBar';
import { AppDrawer } from './mobile/AppDrawer';
import MePage from '../pages/Me';
import { isWallpaperEnabled, useWallpaperPrefs } from '../utils/wallpaper';
import { KeepAliveWorkspace, type PageRouteDef } from './KeepAliveWorkspace';

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

  // Route registry for the keep-alive workspace. Pages that own live
  // long-running UI (AI, workspace tools except Builder, plugin pages) stay
  // mounted hidden after first visit; everything else unmounts like plain
  // routing. Builder is excluded on purpose: builds already run server-side.
  const pageRoutes: PageRouteDef[] = [
    { key: 'dashboard', pattern: '/', element: <Dashboard />, keep: false, layout: 'scroll' },
    { key: 'nodes', pattern: '/nodes', element: <NodesPage />, keep: false, layout: 'scroll' },
    { key: 'agents', pattern: '/agents', element: <AgentsPage />, keep: false, layout: 'scroll' },
    { key: 'agent-detail', pattern: '/agents/:agentId', element: <AgentDetailPage />, keep: false, layout: 'scroll' },
    { key: 'shell', pattern: '/shell', element: <ShellPage />, keep: true, layout: 'fill' },
    { key: 'files', pattern: '/files', element: <FileManager />, keep: true, layout: 'scroll' },
    { key: 'audit', pattern: '/audit', element: <AuditLogsPage />, keep: false, layout: 'scroll' },
    { key: 'system', pattern: '/system', element: <SystemPage />, keep: true, layout: 'scroll' },
    { key: 'software', pattern: '/othersoft', element: <SoftwareDataPage />, keep: true, layout: 'scroll' },
    { key: 'proxy', pattern: '/proxy', element: <ProxyBrowserPage />, keep: true, layout: 'scroll' },
    { key: 'builder', pattern: '/builder', element: <BuilderPage />, keep: false, layout: 'scroll' },
    { key: 'ai', pattern: '/ai', element: <AiPage />, keep: true, layout: 'fill' },
    { key: 'ai', pattern: '/ai/:sessionId', element: <AiPage />, keep: true, layout: 'fill' },
    { key: 'settings', pattern: '/settings', element: <SettingsPage />, keep: false, layout: 'scroll' },
    { key: 'settings-detail', pattern: '/settings/:settingId', element: <SettingDetail />, keep: false, layout: 'scroll' },
    { key: 'plugins', pattern: '/plugins', element: <PluginsPage />, keep: false, layout: 'scroll' },
    { key: 'about', pattern: '/about', element: <AboutPage />, keep: false, layout: 'scroll' },
    { key: 'me', pattern: '/me', element: <MePage user={user} permissions={permissions} onLogout={onLogout} />, keep: false, layout: 'scroll' },
    ...registeredPlugins.map((p): PageRouteDef => {
      const Page = p.Page;
      return { key: `plugin:${p.pluginId}`, pattern: p.route, element: <Page />, keep: true, layout: 'scroll' };
    }),
  ];

  return (
    <div
      className="lw-frame"
      data-wallpaper={isWallpaperEnabled(wallpaper) ? 'on' : 'off'}
      style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <NetworkOverlay />
      <UpdatePrompter />
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

            <div className="lw-workspace-body relative flex min-h-0 flex-1 flex-col">
              {/* Keep-alive panels: hidden pages stay mounted and running
                  (Shell task polling, AI streams, plugin pages), visible
                  panels are absolutely stacked inside the workspace body. */}
              <KeepAliveWorkspace routes={pageRoutes} />
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
