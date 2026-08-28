'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Chip, Tabs } from '@heroui/react';
import type { ComponentType, SVGProps } from 'react';
import {
  ChevronRight,
  Globe,
  Key,
  Person,
  ShieldKeyhole,
  SlidersVertical,
  Sparkles,
} from '@gravity-ui/icons';
import { getStoredUser } from '../../api/auth';
import type { ReactNode } from 'react';
import AccountTab from './AccountTab';
import PreferencesTab from './PreferencesTab';
import RiskPolicyTab from './RiskPolicyTab';
import McpTab from './McpTab';
import SecurityTab from './SecurityTab';
import AccessKeysTab from './AccessKeysTab';
import AiTab from './AiTab';

export interface SettingRoute {
  id: string;
  labelKey: string;
  descKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  adminOnly?: boolean;
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
    id: 'security',
    labelKey: 'settings.securityTab',
    descKey: 'settings.securityDesc',
    icon: ShieldKeyhole,
    render: () => <SecurityTab />,
  },
  {
    id: 'accessKeys',
    labelKey: 'settings.accessKeysTab',
    descKey: 'settings.accessKeysDesc',
    icon: Key,
    render: () => <AccessKeysTab />,
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
    id: 'riskPolicy',
    labelKey: 'riskPolicy.title',
    descKey: 'settings.riskPolicyDesc',
    icon: ShieldKeyhole,
    adminOnly: true,
    render: () => <RiskPolicyTab />,
  },
];

export function getVisibleSettingRoutes(): SettingRoute[] {
  const isAdmin = getStoredUser()?.role === 'Admin';
  return SETTING_ROUTES.filter((r) => !r.adminOnly || isAdmin);
}

export function SettingDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settingId } = useParams<{ settingId: string }>();
  const route = getVisibleSettingRoutes().find((r) => r.id === settingId);
  if (!route) return null;
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onPress={() => navigate('/settings')}>
        ← {t('settings.securityBack')}
      </Button>
      {route.render()}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdmin = getStoredUser()?.role === 'Admin';
  const [activeId, setActiveId] = useState<string>('preferences');

  const visibleRoutes = SETTING_ROUTES.filter((r) => !r.adminOnly || isAdmin);

  return (
    <div className="space-y-3">
      {/* 移动端：Item Card 路由列表 → /settings/:id */}
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

      {/* 桌面端：Tabs 竖排切换 */}
      <div className="hidden sm:block">
        <Tabs
          orientation="vertical"
          selectedKey={activeId}
          onSelectionChange={(key) => setActiveId(String(key))}
          className="items-start"
        >
          <Tabs.ListContainer className="flex justify-center h-auto self-start">
            <Tabs.List aria-label={t('settings.tabsLabel')} className="my-0 px-2 w-35">
              {visibleRoutes.map((route) => (
                <Tabs.Tab key={route.id} id={route.id}>
                  {t(route.labelKey)}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          {visibleRoutes.map((route) => (
            <Tabs.Panel key={route.id} id={route.id}>
              {route.render()}
            </Tabs.Panel>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
