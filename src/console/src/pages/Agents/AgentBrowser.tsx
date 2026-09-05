'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
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

  const chipBase =
    'h-8 shrink-0 rounded-[10px] border px-3 text-[13px] font-medium transition-colors ' +
    'border-black/[0.07] bg-black/[0.035] text-neutral-600 active:scale-[0.97] ' +
    'dark:border-white/10 dark:bg-white/[0.06] dark:text-neutral-300';
  const chipActive =
    'border-transparent bg-accent-soft text-accent-soft-foreground';

  const sectionLabel = 'mb-2 text-[12px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500';

  // Shared filter/sort body, mounted inside both the mobile bottom sheet and
  // the desktop right-side drawer.
  const filterBody = (
    <>
      {/* Sorting: single-select across all three groups */}
      <div className="space-y-5 border-t border-black/5 py-5 dark:border-white/10">
        <section>
          <p className={sectionLabel}>{t('agents.sortStatus')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={sortKind === 'status' && sortDir === 'online'} onClick={() => handleSortPick('status', 'online')} className={`${chipBase} ${sortKind === 'status' && sortDir === 'online' ? chipActive : ''}`}>
              {t('agents.onlineFirst')}
            </button>
            <button type="button" aria-pressed={sortKind === 'status' && sortDir === 'offline'} onClick={() => handleSortPick('status', 'offline')} className={`${chipBase} ${sortKind === 'status' && sortDir === 'offline' ? chipActive : ''}`}>
              {t('agents.offlineFirst')}
            </button>
          </div>
        </section>
        <section>
          <p className={sectionLabel}>{t('agents.sortOs')}</p>
          <div className="flex flex-wrap gap-2">
            {(['windows', 'linux', 'macos'] as const).map((fam) => (
              <button
                key={fam}
                type="button"
                aria-pressed={sortKind === 'os' && sortDir === fam}
                onClick={() => handleSortPick('os', fam)}
                className={`${chipBase} ${sortKind === 'os' && sortDir === fam ? chipActive : ''}`}
              >
                {fam === 'windows'
                  ? t('agents.windowsFirst')
                  : fam === 'linux'
                    ? t('agents.linuxFirst')
                    : t('agents.macFirst')}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p className={sectionLabel}>{t('agents.sortRegistered')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={sortKind === 'registered' && sortDir === 'newest'} onClick={() => handleSortPick('registered', 'newest')} className={`${chipBase} ${sortKind === 'registered' && sortDir === 'newest' ? chipActive : ''}`}>
              {t('agents.registeredNewest')}
            </button>
            <button type="button" aria-pressed={sortKind === 'registered' && sortDir === 'oldest'} onClick={() => handleSortPick('registered', 'oldest')} className={`${chipBase} ${sortKind === 'registered' && sortDir === 'oldest' ? chipActive : ''}`}>
              {t('agents.registeredOldest')}
            </button>
          </div>
        </section>
      </div>

      {/* Filters */}
      <div className="space-y-5 border-t border-black/5 py-5 dark:border-white/10">
        <section>
          <p className={sectionLabel}>{t('agents.statusFilter')}</p>
          <div className="flex flex-wrap gap-2">
            {(['all', 'online', 'offline'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className={`${chipBase} ${status === k ? chipActive : ''}`}>
                {t(`agents.${k}`)}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p className={sectionLabel}>{t('agents.osFilter')}</p>
          <div className="flex flex-wrap gap-2">
            {(['all', 'windows', 'linux', 'macos', 'other'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={os === k} onClick={() => setOs(k)} className={`${chipBase} ${os === k ? chipActive : ''}`}>
                {t(`agents.osName.${k}`)}
              </button>
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
        <button
          type="button"
          aria-label={t('agents.filterSort')}
          aria-pressed={sheetOpen}
          onClick={() => setSheetOpen(true)}
          className="relative grid size-10 shrink-0 place-items-center rounded-[12px] border-0 bg-black/[0.045] text-neutral-600 transition active:scale-95 dark:bg-white/[0.07] dark:text-neutral-300"
        >
          <SlidersVertical className="size-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-accent-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <AgentCardList
        agents={visibleAgents}
        connectedId={connectedId}
        onOpen={onOpen}
        onContextMenu={onCardContextMenu}
        emptyLabel={agents.length > 0 ? t('agents.noMatch') : undefined}
      />

      {/* Filter & sort surfaces: bottom sheet on mobile, right drawer on desktop */}
      <AnimatePresence>
        {sheetOpen && (
          <>
            {/* Mobile bottom sheet */}
            <div className="fixed inset-0 z-50 sm:hidden">
              <motion.button
                aria-label={t('common.close')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setSheetOpen(false)}
                className="absolute inset-0 h-full w-full cursor-default bg-black/45 backdrop-blur-[2px]"
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={t('agents.filterSort')}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-[22px] border-t border-black/5 bg-[var(--lw-workspace-solid)] px-4 pb-[env(safe-area-inset-bottom)] text-[var(--lw-text-strong)] shadow-[0_-16px_48px_-16px_rgba(0,0,0,0.35)] dark:border-white/5"
              >
                <div className="mx-auto mt-2.5 mb-1 h-1 w-9 rounded-full bg-black/10 dark:bg-white/15" />
                <div className="flex items-center justify-between py-2">
                  <h2 className="text-[15px] font-semibold">{t('agents.filterSort')}</h2>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-8 rounded-[10px] text-[12.5px]" onPress={resetAll}>
                      {t('agents.filterReset')}
                    </Button>
                    <button
                      type="button"
                      aria-label={t('common.close')}
                      onClick={() => setSheetOpen(false)}
                      className="grid size-8 place-items-center rounded-full text-neutral-400 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Xmark className="size-4" />
                    </button>
                  </div>
                </div>

                {filterBody}

                <div className="sticky bottom-0 -mx-4 border-t border-black/5 bg-[var(--lw-workspace-solid)] px-4 pt-3 pb-3 dark:border-white/10">
                  <Button variant="primary" className="h-11 w-full rounded-[12px]" onPress={() => setSheetOpen(false)}>
                    {t('agents.filterDone')}
                  </Button>
                </div>
              </motion.div>
            </div>

            {/* Desktop right-side drawer */}
            <div className="fixed inset-0 z-50 hidden sm:block">
              <motion.button
                aria-label={t('common.close')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setSheetOpen(false)}
                className="absolute inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-[2px]"
              />
              <motion.aside
                role="dialog"
                aria-modal="true"
                aria-label={t('agents.filterSort')}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 400, damping: 42 }}
                className="absolute top-0 right-0 flex h-full w-[380px] max-w-[92vw] flex-col overflow-hidden border-l border-black/5 bg-[var(--lw-workspace-solid)] text-[var(--lw-text-strong)] shadow-[-28px_0_64px_-32px_rgba(0,0,0,0.45)] dark:border-white/10"
              >
                <div className="flex items-center justify-between px-5 pt-5 pb-1">
                  <h2 className="text-[15px] font-semibold">{t('agents.filterSort')}</h2>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-8 rounded-[10px] text-[12.5px]" onPress={resetAll}>
                      {t('agents.filterReset')}
                    </Button>
                    <button
                      type="button"
                      aria-label={t('common.close')}
                      onClick={() => setSheetOpen(false)}
                      className="grid size-8 place-items-center rounded-full text-neutral-400 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Xmark className="size-4" />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5">{filterBody}</div>

                <div className="border-t border-black/5 px-5 py-3 dark:border-white/10">
                  <Button variant="primary" className="h-10 w-full rounded-[10px]" onPress={() => setSheetOpen(false)}>
                    {t('agents.filterDone')}
                  </Button>
                </div>
              </motion.aside>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
