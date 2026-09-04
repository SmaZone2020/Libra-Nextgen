import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@heroui/react';
import { ChevronRight, CircleInfo, Gear, Shield } from '@gravity-ui/icons';
import { canSeeRoute } from '../../utils/permissions';
import { UserProfileCard, type MeUser } from './UserProfileCard';
import type { UserPermissions } from '../../types/models';

interface MeEntry {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  to: string;
  label: string;
}

export default function MePage({
  user,
  permissions,
  onLogout,
}: {
  user: MeUser;
  permissions: UserPermissions | null;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const entries: MeEntry[] = [
    { icon: Gear, to: '/settings', label: t('nav.settings') },
    { icon: CircleInfo, to: '/about', label: t('nav.about') },
    { icon: Shield, to: '/audit', label: t('nav.auditLogs') },
  ].filter((e) => canSeeRoute(permissions, e.to));

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <UserProfileCard user={user} />

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {entries.map((entry, i) => (
          <Button
            key={entry.to}
            variant="ghost"
            className={`w-full justify-start gap-3 rounded-none px-4 py-3 h-auto ${
              i > 0 ? 'border-t border-neutral-200 dark:border-neutral-800' : ''
            }`}
            onPress={() => navigate(entry.to)}
          >
            <entry.icon className="size-4.5 shrink-0 text-primary" />
            <span className="flex-1 text-left text-sm font-medium">{entry.label}</span>
            <ChevronRight className="size-4 shrink-0 text-muted" />
          </Button>
        ))}
      </div>

      <Button
        variant="ghost"
        className="w-full rounded-2xl border border-neutral-200 bg-white py-3 h-auto text-danger dark:border-neutral-800 dark:bg-neutral-900"
        onPress={onLogout}
      >
        {t('common.logout')}
      </Button>
    </div>
  );
}
