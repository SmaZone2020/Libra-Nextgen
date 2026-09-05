'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Drawer } from '@heroui/react';
import { Magnifier, SlidersVertical, Xmark } from '@gravity-ui/icons';
import type { AgentListItem } from '../../types/models';
import { AgentCardList } from './AgentCardList';

type StatusFilter = 'all' | 'online' | 'offline';
type OsFilter = 'all' | 'windows' | 'linux' | 'macos' | 'other';
type SortKind = 'status' | 'os' | 'registered';
type SortDir = 'online' | 'offline' | 'windows' | 'linux' | 'macos' | 'newest' | 'oldest';

const DEFAULTS = {
  status: 'all' as StatusFilter,
  os: 'all' as OsFilter,
  sortKind: 'registered' as SortKind,
  sortDir: 'newest' as SortDir,
};

/** Coarse OS family from the free-text osVersion string. */
function osFamily(osVersion: string): OsFilter {
  const v = osVersion.toLowerCase();
  if (v.includes('windows')) return 'windows';
  if (v.includes('darwin') || v.includes('mac os') || v.includes('macos') || v.includes('osx')) return 'macos';
  if (v.includes('linux') || v.includes('ubuntu') || v.includes('debian') || v.includes('centos') || v.includes('kali')) return 'linux';
  return v ? 'other' : 'other';
}

const OS_FAMILY_ORDER: Record<OsFilter, number> = {
  all: -1,
  windows: 0,
  linux: 1,
  macos: 2,
  other: 3,
};

/**
 * Registration time proxy. List items do not carry firstSeen; MongoDB-style
 * ObjectIds embed their creation timestamp in the leading 8 hex chars, which
 * matches the server-generated ids. Falls back to lastSeen when the id shape
 * differs (kept deterministic, never NaN).
 */
function registrationTime(a: AgentListItem): number {
  if (/^[0-9a-f]{24}$/i.test(a.id)) {
    const seconds = parseInt(a.id.slice(0, 8), 16);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  const parsed = Date.parse(a.lastSeen ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Tracks Tailwind's `sm` breakpoint so the drawer can slide from the right edge on desktop. */
function useIsDesktop(): boolean {
  const query = '(min-width: 640px)';
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return isDesktop;
}

/** Single-select option rendered as a HeroUI button; the active choice uses the solid accent fill. */
function OptionChip({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'primary' : 'ghost'}
      aria-pressed={active}
      onPress={onPress}
      className={`h-8 shrink-0 rounded-[10px] px-3 text-[13px] transition-colors ${
        active
          ? 'font-semibold shadow-sm'
          : 'font-medium text-neutral-600 hover:bg-black/[0.06] dark:text-neutral-300 dark:hover:bg-white/[0.1]'
      }`}
    >
      {children}
    </Button>
  );
}

export function AgentBrowser({
  agents,
  connectedId,
  onOpen,
  onCardContextMenu,
}: {
  agents: AgentListItem[];
  connectedId: string;
  onOpen: (id: string) => void;
  /** Optional per-card right-click hook (desktop context menu). */
  onCardContextMenu?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>(DEFAULTS.status);
  const [os, setOs] = useState<OsFilter>(DEFAULTS.os);
  const [sortKind, setSortKind] = useState<SortKind>(DEFAULTS.sortKind);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULTS.sortDir);
  const [sheetOpen, setSheetOpen] = useState(false);
  const isDesktop = useIsDesktop();

  const activeFilterCount =
    (status !== DEFAULTS.status ? 1 : 0) +
    (os !== DEFAULTS.os ? 1 : 0) +
    (sortKind !== DEFAULTS.sortKind || sortDir !== DEFAULTS.sortDir ? 1 : 0);

  const visibleAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = agents;
    if (status === 'online') list = list.filter((a) => a.status === 'Online');
    else if (status === 'offline') list = list.filter((a) => a.status !== 'Online');
    if (os !== 'all') list = list.filter((a) => osFamily(a.osVersion) === os);
    if (q) {
      list = list.filter((a) =>
        [a.hostname, a.ipAddress, a.osVersion, a.userName, a.geo?.region ?? '']
          .some((f) => (f ?? '').toLowerCase().includes(q)),
      );
    }
    if (list.length < 2) return list;
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKind === 'status') {
        const ra = a.status === 'Online' ? 0 : 1;
        const rb = b.status === 'Online' ? 0 : 1;
        return sortDir === 'online' ? ra - rb : rb - ra;
      }
      if (sortKind === 'os') {
        const famOf = (x: AgentListItem) => osFamily(x.osVersion);
        const target = sortDir as 'windows' | 'linux' | 'macos';
        const rank = (x: AgentListItem) => {
          const fam = famOf(x);
          return fam === target ? -1 : OS_FAMILY_ORDER[fam];
        };
        return rank(a) - rank(b);
      }
      const ta = registrationTime(a);
      const tb = registrationTime(b);
      return sortDir === 'newest' ? tb - ta : ta - tb;
    });
    return sorted;
  }, [agents, query, status, os, sortKind, sortDir]);

  const handleSortPick = (kind: SortKind, dir: SortDir) => {
    setSortKind(kind);
    setSortDir(dir);
  };

  const resetAll = () => {
    setStatus(DEFAULTS.status);
    setOs(DEFAULTS.os);
    setSortKind(DEFAULTS.sortKind);
    setSortDir(DEFAULTS.sortDir);
  };

  const sectionLabel = 'mb-2 text-[12px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500';

  // Shared filter/sort body, mounted inside the responsive HeroUI drawer.
  const filterBody = (
    <>
      {/* Sorting: single-select across all three groups */}
      <div className="space-y-5 border-t border-black/5 py-5 dark:border-white/10">
        <section>
          <p className={sectionLabel}>{t('agents.sortStatus')}</p>
          <div className="flex flex-wrap gap-2">
            <OptionChip
              active={sortKind === 'status' && sortDir === 'online'}
              onPress={() => handleSortPick('status', 'online')}
            >
              {t('agents.onlineFirst')}
            </OptionChip>
            <OptionChip
              active={sortKind === 'status' && sortDir === 'offline'}
              onPress={() => handleSortPick('status', 'offline')}
            >
              {t('agents.offlineFirst')}
            </OptionChip>
          </div>
        </section>
        <section>
          <p className={sectionLabel}>{t('agents.sortOs')}</p>
          <div className="flex flex-wrap gap-2">
            {(['windows', 'linux', 'macos'] as const).map((fam) => (
              <OptionChip
                key={fam}
                active={sortKind === 'os' && sortDir === fam}
                onPress={() => handleSortPick('os', fam)}
              >
                {fam === 'windows'
                  ? t('agents.windowsFirst')
                  : fam === 'linux'
                    ? t('agents.linuxFirst')
                    : t('agents.macFirst')}
              </OptionChip>
            ))}
          </div>
        </section>
        <section>
          <p className={sectionLabel}>{t('agents.sortRegistered')}</p>
          <div className="flex flex-wrap gap-2">
            <OptionChip
              active={sortKind === 'registered' && sortDir === 'newest'}
              onPress={() => handleSortPick('registered', 'newest')}
            >
              {t('agents.registeredNewest')}
            </OptionChip>
            <OptionChip
              active={sortKind === 'registered' && sortDir === 'oldest'}
              onPress={() => handleSortPick('registered', 'oldest')}
            >
              {t('agents.registeredOldest')}
            </OptionChip>
          </div>
        </section>
      </div>

      {/* Filters */}
      <div className="space-y-5 border-t border-black/5 py-5 dark:border-white/10">
        <section>
          <p className={sectionLabel}>{t('agents.statusFilter')}</p>
          <div className="flex flex-wrap gap-2">
            {(['all', 'online', 'offline'] as const).map((k) => (
              <OptionChip key={k} active={status === k} onPress={() => setStatus(k)}>
                {t(`agents.${k}`)}
              </OptionChip>
            ))}
          </div>
        </section>
        <section>
          <p className={sectionLabel}>{t('agents.osFilter')}</p>
          <div className="flex flex-wrap gap-2">
            {(['all', 'windows', 'linux', 'macos', 'other'] as const).map((k) => (
              <OptionChip key={k} active={os === k} onPress={() => setOs(k)}>
                {t(`agents.osName.${k}`)}
              </OptionChip>
            ))}
          </div>
        </section>
      </div>
    </>
  );

  return (
    <div className="space-y-3">
      {/* Search + filter entry */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Magnifier className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('agents.searchPlaceholder')}
            className="h-10 w-full rounded-[12px] border-0 bg-black/[0.045] pr-8 pl-9 text-[14px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-accent/45 dark:bg-white/[0.07] dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-800"
          />
          {query && (
            <button
              type="button"
              aria-label={t('agents.searchClear')}
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-neutral-400 hover:bg-black/5 hover:text-neutral-600 dark:hover:bg-white/10"
            >
              <Xmark className="size-3.5" />
            </button>
          )}
        </div>
        <Button
          isIconOnly
          aria-label={t('agents.filterSort')}
          aria-pressed={sheetOpen}
          onPress={() => setSheetOpen(true)}
          variant="secondary"
          className={`relative size-10 shrink-0 rounded-[12px] ${
            activeFilterCount > 0
              ? 'bg-accent text-accent-foreground shadow-sm'
              : 'text-neutral-600 dark:text-neutral-300'
          }`}
        >
          <SlidersVertical className="size-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent-foreground px-1 text-[10px] leading-none font-semibold text-accent">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      <AgentCardList
        agents={visibleAgents}
        connectedId={connectedId}
        onOpen={onOpen}
        onContextMenu={onCardContextMenu}
        emptyLabel={agents.length > 0 ? t('agents.noMatch') : undefined}
      />

      {/* Filter & sort drawer: bottom sheet on mobile, right drawer on desktop */}
      <Drawer isOpen={sheetOpen} onOpenChange={setSheetOpen}>
        <Drawer.Backdrop isDismissable variant="blur">
          <Drawer.Content placement={isDesktop ? 'right' : 'bottom'}>
            <Drawer.Dialog className="p-0">
              {!isDesktop && <Drawer.Handle className="pt-2.5" />}
              <Drawer.Header className="flex-row items-center justify-between gap-2 px-5 pt-5 pb-1">
                <Drawer.Heading className="text-[15px] font-semibold">
                  {t('agents.filterSort')}
                </Drawer.Heading>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-[10px] text-[12.5px]"
                    onPress={resetAll}
                  >
                    {t('agents.filterReset')}
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    slot="close"
                    aria-label={t('common.close')}
                    className="size-8 rounded-full text-neutral-400 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <Xmark className="size-4" />
                  </Button>
                </div>
              </Drawer.Header>

              <Drawer.Body className="m-0 px-5 pt-2 pb-0">{filterBody}</Drawer.Body>

              <Drawer.Footer className="mt-0 border-t border-black/5 px-5 py-3 dark:border-white/10">
                <Button
                  slot="close"
                  variant="primary"
                  fullWidth
                  className="h-10 rounded-[10px]"
                >
                  {t('agents.filterDone')}
                </Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
