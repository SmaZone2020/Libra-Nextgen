import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@heroui/react';
import { Display, Dots9, House, HouseFill, Person, PersonFill, Sparkles } from '@gravity-ui/icons';

interface MobileTab {
  key: string;
  labelKey: string;
  to?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconActive: ComponentType<SVGProps<SVGSVGElement>>;
  isActive: (pathname: string) => boolean;
}

const TABS: MobileTab[] = [
  {
    key: 'home',
    labelKey: 'mobile.home',
    to: '/',
    icon: House,
    iconActive: HouseFill,
    isActive: (p) => p === '/',
  },
  {
    key: 'devices',
    labelKey: 'mobile.devices',
    to: '/agents',
    icon: Display,
    iconActive: Display,
    isActive: (p) => p === '/agents',
  },
  {
    key: 'justitia',
    labelKey: 'nav.ai',
    to: '/ai',
    icon: Sparkles,
    iconActive: Sparkles,
    isActive: (p) => p === '/ai' || p.startsWith('/ai/'),
  },
  {
    key: 'me',
    labelKey: 'mobile.me',
    to: '/me',
    icon: Person,
    iconActive: PersonFill,
    isActive: (p) => p === '/me',
  },
];

/** Mobile bottom navigation: 4 route tabs + the app drawer trigger. */
export function MobileTabBar({
  appsOpen,
  onAppsToggle,
}: {
  appsOpen: boolean;
  onAppsToggle: () => void;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <nav
      aria-label={t('mobile.apps')}
      className="flex shrink-0 items-stretch border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden dark:border-neutral-800 dark:bg-neutral-900/95"
    >
      {TABS.map((tab) => {
        const active = tab.isActive(pathname);
        const Icon = active ? tab.iconActive : tab.icon;
        return (
          <Button
            key={tab.key}
            variant="ghost"
            aria-label={t(tab.labelKey)}
            onPress={() => tab.to && navigate(tab.to)}
            className={`h-auto min-w-0 flex-1 flex-col gap-0.5 rounded-none py-1.5 ${
              active ? 'text-primary' : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            <span
              className={`flex items-center justify-center rounded-full px-4 py-1 transition-colors ${
                active ? 'bg-primary/10' : 'bg-transparent'
              }`}
            >
              <Icon className="size-5" />
            </span>
            <span className="text-[10px] font-medium leading-none">{t(tab.labelKey)}</span>
          </Button>
        );
      })}
      <Button
        variant="ghost"
        aria-label={t('mobile.apps')}
        onPress={onAppsToggle}
        className={`h-auto min-w-0 flex-1 flex-col gap-0.5 rounded-none py-1.5 ${
          appsOpen ? 'text-primary' : 'text-neutral-500 dark:text-neutral-400'
        }`}
      >
        <span
          className={`flex items-center justify-center rounded-full px-4 py-1 transition-colors ${
            appsOpen ? 'bg-primary/10' : 'bg-transparent'
          }`}
        >
          <Dots9 className="size-5" />
        </span>
        <span className="text-[10px] font-medium leading-none">{t('mobile.apps')}</span>
      </Button>
    </nav>
  );
}
