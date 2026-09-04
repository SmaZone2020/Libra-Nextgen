import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Display, Dots9, House, HouseFill, Person, PersonFill, Sparkles } from '@gravity-ui/icons';

interface MobileTab {
  key: string;
  labelKey: string;
  to: string;
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
    isActive: (p) => p === '/agents' || p.startsWith('/agents/'),
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

const SLOT_COUNT = TABS.length + 1; // + the app-drawer trigger

/** Floating pill-style mobile bottom navigation (see the reference project):
 *  a translucent rounded bar hovering above the content with a spring-animated
 *  highlight capsule that slides to the active slot. */
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

  const activeIndex = appsOpen
    ? TABS.length
    : TABS.findIndex((tab) => tab.isActive(pathname));

  return (
    <div className="fixed bottom-[calc(35px+env(safe-area-inset-bottom))] left-4 right-4 z-40 sm:hidden">
      <div className="relative rounded-[26px] border border-neutral-200/70 bg-white/70 shadow-lg shadow-black/10 backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-900/75">
        {activeIndex >= 0 && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1 top-1 rounded-[20px] bg-accent/10"
            initial={false}
            animate={{
              left: `${(activeIndex / SLOT_COUNT) * 100}%`,
              width: `${100 / SLOT_COUNT}%`,
            }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          />
        )}

        <div className="relative z-10 flex px-2">
          {TABS.map((tab) => {
            const active = !appsOpen && tab.isActive(pathname);
            const Icon = active ? tab.iconActive : tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                aria-label={t(tab.labelKey)}
                onClick={() => navigate(tab.to)}
                className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 outline-none transition-colors ${
                  active ? 'text-accent' : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                <span
                  className={`flex items-center justify-center transition-transform ${
                    active ? 'scale-110' : ''
                  }`}
                >
                  <Icon className="size-5" />
                </span>
                <span className="max-w-full truncate text-[10px] font-medium leading-none">
                  {t(tab.labelKey)}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            aria-label={t('mobile.apps')}
            onClick={onAppsToggle}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 outline-none transition-colors ${
              appsOpen ? 'text-accent' : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            <span
              className={`flex items-center justify-center transition-transform ${
                appsOpen ? 'scale-110' : ''
              }`}
            >
              <Dots9 className="size-5" />
            </span>
            <span className="max-w-full truncate text-[10px] font-medium leading-none">
              {t('mobile.apps')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
