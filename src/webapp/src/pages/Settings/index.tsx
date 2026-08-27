'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip } from '@heroui/react';
import type { ComponentType, SVGProps } from 'react';
import {
  ChevronRight,
  Globe,
  Key,
  Lock,
  Person,
  ShieldKeyhole,
  SlidersVertical,
} from '@gravity-ui/icons';
import { getStoredUser } from '../../api/auth';
import type { ReactNode } from 'react';
import AccountTab from './AccountTab';
import PreferencesTab from './PreferencesTab';
import RiskPolicyTab from './RiskPolicyTab';
import McpTab from './McpTab';
import SecurityTab from './SecurityTab';
import AccessKeysTab from './AccessKeysTab';

export interface SettingRoute {
  id: string;
  labelKey: string;
  descKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  adminOnly?: boolean;
  render: () => ReactNode;
}

const ROUTES: SettingRoute[] = [
  {
    id: 'preferences',
    labelKey: 'settings.preferencesTab',
    descKey: 'settings.preferencesDesc',
    icon: SlidersVertical,
    render: () => <PreferencesTab />,
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
    id: 'mcp',
    labelKey: 'mcp.title',
    descKey: 'settings.mcpDesc',
    icon: Globe,
    adminOnly: true,
    render: () => <McpTab />,
  },
  {
    id: 'riskPolicy',
    labelKey: 'riskPolicy.title',
    descKey: 'settings.riskPolicyDesc',
    icon: Lock,
    adminOnly: true,
    render: () => <RiskPolicyTab />,
  },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const isAdmin = getStoredUser()?.role === 'Admin';
  const [activeId, setActiveId] = useState<string | null>(null);

  const visibleRoutes = ROUTES.filter((r) => !r.adminOnly || isAdmin);
  const active = visibleRoutes.find((r) => r.id === activeId);

  if (active) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onPress={() => setActiveId(null)}>
          ← {t('settings.securityBack')}
        </Button>
        {active.render()}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">{t('settings.tabsLabel')}</h2>
        <p className="text-sm text-default-500">{t('settings.securityRoutesDesc')}</p>
      </div>
      <div className="flex flex-col gap-3">
        {visibleRoutes.map((route) => {
          const Icon = route.icon;
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => setActiveId(route.id)}
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
  );
}
