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

/** The sliding highlight. It is rendered inside the ACTIVE slot only; the
 *  shared layoutId makes motion animate it from the previous slot to the next,
 *  so it always aligns exactly with the button (no percentage math involved). */
function TabHighlight() {
  return (
    <motion.span
      layoutId="mobileTabHighlight"
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 inset-y-1 rounded-[18px] bg-accent/10"
    />
  );
}

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

  return (
    <div className="fixed bottom-[calc(35px+env(safe-area-inset-bottom))] left-4 right-4 z-40 sm:hidden">
      <div className="relative rounded-[26px] border border-neutral-200/70 bg-white/70 shadow-lg shadow-black/10 backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-900/75">
        <div className="flex px-2">
          {TABS.map((tab) => {
            const active = !appsOpen && tab.isActive(pathname);
            const Icon = active ? tab.iconActive : tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                aria-label={t(tab.labelKey)}
                onClick={() => navigate(tab.to)}
                className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 outline-none transition-colors ${
                  active ? 'text-accent' : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                {active && <TabHighlight />}
                <span
                  className={`relative flex items-center justify-center transition-transform ${
                    active ? 'scale-110' : ''
                  }`}
                >
                  <Icon className="size-5" />
                </span>
                <span className="relative max-w-full truncate text-[10px] font-medium leading-none">
                  {t(tab.labelKey)}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            aria-label={t('mobile.apps')}
            onClick={onAppsToggle}
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 outline-none transition-colors ${
              appsOpen ? 'text-accent' : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            {appsOpen && <TabHighlight />}
            <span
              className={`relative flex items-center justify-center transition-transform ${
                appsOpen ? 'scale-110' : ''
              }`}
            >
              <Dots9 className="size-5" />
            </span>
            <span className="relative max-w-full truncate text-[10px] font-medium leading-none">
              {t('mobile.apps')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
