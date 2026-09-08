import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Route, Routes, matchPath, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';

/**
 * Workspace body renderer with per-page keep-alive.
 *
 * Plain react-router <Routes> unmounts a page as soon as the URL stops
 * matching it, which destroys terminal buffers, chat state, in-flight task
 * polling and open streams. Keep-alive pages (Shell, AI, plugin pages, ...)
 * stay mounted after their first visit: leaving the route only hides the
 * panel with display:none, so all effects/subscriptions keep running and the
 * DOM state (scroll, xterm, composer draft, ...) survives. Pages flagged
 * keep:false keep the classic unmount-on-leave behavior.
 *
 * Each panel owns a <Routes> pinned to the location the page was last active
 * at. Hidden pages therefore keep seeing their own path/params via router
 * hooks (useParams/useLocation) even while the global URL points elsewhere —
 * otherwise a background refresh on a hidden page would re-derive "no
 * session" from the unrelated current route. The frozen element object also
 * lets React skip re-rendering hidden panels on unrelated layout re-renders;
 * the panel is refreshed with the latest element/props when reactivated.
 */

export type PageLayout = 'fill' | 'scroll';

export interface PageRouteDef {
  /** Stable id of the panel this route renders into (shared by URL variants
   *  of the same page, e.g. /ai and /ai/:sessionId). */
  key: string;
  /** Absolute route pattern, same syntax as <Route path>. */
  pattern: string;
  /** Element rendered while this pattern is active. */
  element: ReactNode;
  /** true: keep mounted hidden after first visit; false: unmount on leave. */
  keep: boolean;
  /** fill = full-bleed flex surface (Shell/AI); scroll = padded page. */
  layout: PageLayout;
}

interface StoredSlot {
  location: Location;
  /** Latest element per pattern, frozen while the panel is hidden. */
  elements: Map<string, ReactNode>;
}

const FILL_PANEL_CLASS =
  'lw-page-slot absolute inset-0 flex min-h-0 flex-col overflow-hidden pb-24 sm:pb-0';
const SCROLL_PANEL_CLASS =
  'lw-page-slot absolute inset-0 flex min-h-0 flex-col overflow-y-auto px-3 pt-2 pb-24 sm:px-5 sm:pt-3 sm:pb-6 lg:px-7';

export function KeepAliveWorkspace({ routes }: { routes: PageRouteDef[] }) {
  const location = useLocation();

  const groups = useMemo(() => {
    const byKey = new Map<string, PageRouteDef[]>();
    for (const route of routes) {
      const list = byKey.get(route.key);
      if (list) list.push(route);
      else byKey.set(route.key, [route]);
    }
    return byKey;
  }, [routes]);

  const activeDef = useMemo(
    () =>
      routes.find((r) => matchPath({ path: r.pattern, end: true }, location.pathname)) ??
      null,
    [routes, location.pathname],
  );

  const storeRef = useRef(new Map<string, StoredSlot>());
  const store = storeRef.current;

  // Keep the active panel's location/element fresh and create the record on
  // first visit. Mutating the ref during render is intentional and idempotent
  // per location/route — it lets a newly visited panel mount in the same
  // commit instead of showing a blank frame.
  if (activeDef && activeDef.keep) {
    let slot = store.get(activeDef.key);
    if (!slot) {
      slot = { location, elements: new Map() };
      store.set(activeDef.key, slot);
    }
    slot.location = location;
    slot.elements.set(activeDef.pattern, activeDef.element);
  }

  const panels: ReactNode[] = [];

  for (const [key, defs] of groups) {
    const def0 = defs[0]!;
    const keep = def0.keep;
    const active = activeDef !== null && activeDef.key === key;
    const slot = keep ? store.get(key) : null;
    if ((!keep && !active) || (keep && !slot)) continue;

    const panelLocation = keep ? slot!.location : location;
    const layout: PageLayout = def0.layout ?? 'scroll';
    const elementOf = (pattern: string) =>
      (keep ? slot!.elements.get(pattern) : undefined) ??
      defs.find((d) => d.pattern === pattern)?.element;

    panels.push(
      <div
        key={key}
        data-page-slot={key}
        className={layout === 'fill' ? FILL_PANEL_CLASS : SCROLL_PANEL_CLASS}
        style={active ? undefined : { display: 'none' }}
        aria-hidden={!active}
      >
        <Routes location={panelLocation}>
          {defs.map((def) => (
            <Route key={def.pattern} path={def.pattern} element={elementOf(def.pattern)} />
          ))}
        </Routes>
      </div>,
    );
  }

  return <>{panels}</>;
}
