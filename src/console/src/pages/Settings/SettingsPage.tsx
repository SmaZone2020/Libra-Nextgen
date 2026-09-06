'use client';

import { useState } from 'react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Chip } from '@heroui/react';
import {
  ChevronRight,
  Comments,
  Globe,
  Key,
  Palette,
  Person,
  ShieldKeyhole,
  SlidersVertical,
  Sparkles,
} from '@gravity-ui/icons';
import { getStoredUser } from '../../api/auth';
import { isLibraDesktopShell } from '../../desktop/DesktopTopBar';
import AccountTab from './AccountTab';
import PreferencesTab from './PreferencesTab';
import AppearanceTab from './AppearanceTab';
import RiskPolicyTab from './RiskPolicyTab';
import McpTab from './McpTab';
import SecurityTab from './SecurityTab';
import AccessKeysTab from './AccessKeysTab';
import AiTab from './AiTab';
import ChannelsTab from './ChannelsTab';
import StorageTab from './StorageTab';

export interface SettingRoute {
  id: string;
  labelKey: string;
  descKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  adminOnly?: boolean;
  /** Only visible inside the Libra Desktop shell (local storage switcher). */
  desktopOnly?: boolean;
  render: () => ReactNode;
}

export const SETTING_ROUTES: SettingRoute[] = [
  {
    id: 'preferences',
    labelKey: 'settings.preferencesTab',
    descKey: 'settings.preferencesDesc',
    icon: SlidersVertical,
    render: () => <PreferencesTab />,
  },
  {
    id: 'appearance',
    labelKey: 'settings.appearanceTab',
    descKey: 'settings.appearanceDesc',
    icon: Palette,
    render: () => <AppearanceTab />,
  },
  {
    id: 'mcp',
    labelKey: 'mcp.title',
    descKey: 'settings.mcpDesc',
    icon: Globe,
    adminOnly: true,
    render: () => <McpTab />,
  },
  {
    id: 'ai',
    labelKey: 'settings.aiTab',
    descKey: 'settings.aiDesc',
    icon: Sparkles,
    adminOnly: true,
    render: () => <AiTab />,
  },
  {
    id: 'channels',
    labelKey: 'settings.channelsTab',
    descKey: 'settings.channelsDesc',
    icon: Comments,
    adminOnly: true,
    render: () => <ChannelsTab />,
  },
  {
    id: 'security',
    labelKey: 'settings.securityTab',
    descKey: 'settings.securityDesc',
    icon: ShieldKeyhole,
    render: () => <SecurityTab />,
  },
  {
    id: 'account',
    labelKey: 'settings.accountTab',
    descKey: 'settings.accountDesc',
    icon: Person,
    adminOnly: true,
    render: () => <AccountTab />,
  },
  {
    id: 'accessKeys',
    labelKey: 'settings.accessKeysTab',
    descKey: 'settings.accessKeysDesc',
    icon: Key,
    render: () => <AccessKeysTab />,
  },
  {
    id: 'riskPolicy',
    labelKey: 'riskPolicy.title',
    descKey: 'settings.riskPolicyDesc',
    icon: ShieldKeyhole,
    adminOnly: true,
    render: () => <RiskPolicyTab />,
  },
  {
    id: 'storage',
    labelKey: 'settings.storageTab',
    descKey: 'settings.storageDesc',
    icon: SlidersVertical,
    desktopOnly: true,
    render: () => <StorageTab />,
  },
];

export function getVisibleSettingRoutes(): SettingRoute[] {
  const isAdmin = getStoredUser()?.role === 'Admin';
  const desktop = isLibraDesktopShell();
  return SETTING_ROUTES.filter(
    (r) => (!r.adminOnly || isAdmin) && (!r.desktopOnly || desktop),
  );
}

// Captioned groups for the desktop-wide rail, mirroring the sidebar's
// section structure. Mobile keeps the flat route list.
interface SettingGroup {
  key: string;
  labelKey: string;
  routeIds: string[];
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    key: 'general',
    labelKey: 'settings.section.general',
    routeIds: ['preferences', 'appearance', 'storage'],
  },
  {
    key: 'ai',
    labelKey: 'settings.section.ai',
    routeIds: ['mcp', 'ai', 'channels'],
  },
  {
    key: 'account',
    labelKey: 'settings.section.account',
    routeIds: ['security', 'account', 'accessKeys', 'riskPolicy'],
  },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdmin = getStoredUser()?.role === 'Admin';
  const [activeId, setActiveId] = useState<string>('preferences');

  const visibleRoutes = getVisibleSettingRoutes();
  const routeById = new Map(visibleRoutes.map((r) => [r.id, r]));
  const activeRoute =
    visibleRoutes.find((r) => r.id === activeId) ?? visibleRoutes[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="sm:hidden">
        <div className="mt-3 flex flex-col gap-3">
          {visibleRoutes.map((route) => {
            const Icon = route.icon;
            return (
              <button
                key={route.id}
                type="button"
                onClick={() => navigate(`/settings/${route.id}`)}
                className="flex w-full items-center gap-3 rounded-2xl bg-surface p-4 text-left shadow-surface transition-colors hover:bg-surface-secondary"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-default/10 text-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground">{t(route.labelKey)}</span>
                  <span className="text-xs text-muted">{t(route.descKey)}</span>
                </span>
                {route.adminOnly && (
                  <Chip size="sm" variant="soft">Admin</Chip>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </button>
            );
          })}
        </div>
      </div>

      {/* 桌面端宽屏：侧边栏式分组导航 —— 分组标题、分割线与导航行
          完全复用侧边栏的 lw-nav-caption / Button 行样式。 */}
      <div className="hidden sm:block">
        <div className="flex items-start gap-6">
          <nav
            aria-label={t('settings.tabsLabel')}
            className="sticky top-0 max-h-[calc(100vh-9rem)] w-56 shrink-0 self-start overflow-y-auto overscroll-contain border-r border-default-200/70 pr-5 dark:border-default-800"
          >
            {SETTING_GROUPS.map((group) => {
              const routes = group.routeIds
                .map((id) => routeById.get(id))
                .filter((r): r is SettingRoute => !!r);
              if (routes.length === 0) return null;
              return (
                <div key={group.key} className="flex flex-col">
                  <div className="lw-nav-caption">{t(group.labelKey)}</div>
                  {routes.map((route) => {
                    const Icon = route.icon;
                    const isActive = activeId === route.id;
                    return (
                      <div key={route.id} className="my-0.5 flex items-center">
                        <Button
                          variant="ghost"
                          aria-current={isActive}
                          onPress={() => setActiveId(route.id)}
                          className={`w-full justify-start rounded-[12px] px-3 ${
                            isActive ? 'bg-accent-soft text-accent-soft-foreground' : ''
                          }`}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span
                            className={`overflow-hidden whitespace-nowrap ${
                              isActive ? 'font-semibold' : 'font-medium'
                            }`}
                          >
                            {t(route.labelKey)}
                          </span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1">{activeRoute && activeRoute.render()}</div>
        </div>
      </div>
    </div>
  );
}
