import { useCallback, useState } from 'react';

export type DrawerOrderMap = Record<string, string[]>;

function loadOrder(key: string): DrawerOrderMap {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as DrawerOrderMap;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* ignore malformed storage */ }
  return {};
}

/** Persisted per-section id order for the mobile app drawer. */
export function useDrawerOrder(storageKey: string) {
  const [order, setOrder] = useState<DrawerOrderMap>(() => loadOrder(storageKey));

  const setSectionOrder = useCallback(
    (section: string, ids: string[]) => {
      setOrder((prev) => {
        const next = { ...prev, [section]: ids };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch { /* storage may be unavailable; keep in-memory order */ }
        return next;
      });
    },
    [storageKey],
  );

  return { order, setSectionOrder };
}

/** Merge stored ids with the live default list: stored order first (only ids
 *  that still exist), then any new defaults appended at the end. */
export function applyDrawerOrder<T extends { id: string }>(defaults: T[], stored: string[] | undefined): T[] {
  if (!stored || stored.length === 0) return defaults;
  const byId = new Map(defaults.map((item) => [item.id, item]));
  const kept = stored.filter((id) => byId.has(id)).map((id) => byId.get(id) as T);
  const rest = defaults.filter((item) => !kept.includes(item));
  return [...kept, ...rest];
}
