import { getRecentEvents, type EventItem } from '../api/events';
import { consoleWs } from '../ws/consoleWs';

/**
 * Single shared source of truth for the console event feed, consumed by the
 * header EventViewer drawer AND the Dashboard "recent activity" panel so both
 * stay perfectly in sync (same fetch, same WS events, same soft-clear).
 *
 * Ordering: newest first. The module starts lazily on first subscription.
 */

const MAX_EVENTS = 200;

let events: EventItem[] = [];
let started = false;
let starting: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function byNewest(a: EventItem, b: EventItem): number {
  return new Date(b.ts).getTime() - new Date(a.ts).getTime();
}

function insert(items: EventItem[]) {
  const seen = new Set(events.map((e) => e.id));
  const fresh = items.filter((e) => e?.id && !seen.has(e.id));
  if (fresh.length === 0) return;
  events = [...events, ...fresh].sort(byNewest).slice(0, MAX_EVENTS);
  emit();
}

function ensureStarted() {
  if (started || starting) return starting ?? Promise.resolve();
  started = true;
  starting = getRecentEvents(50)
    .then((r) => insert(r.events ?? []))
    .catch(() => { /* offline/boot — live events still arrive over WS */ })
    .finally(() => { starting = null; });

  consoleWs.on('event.item', (msg) => {
    const e = msg.data as unknown as EventItem;
    if (!e?.id || !e?.text) return;
    insert([e]);
  });
  return starting;
}

/** Subscribe to the shared feed. Returns an unsubscribe function. */
export function subscribeEventFeed(cb: () => void): () => void {
  listeners.add(cb);
  const pending = ensureStarted();
  cb(); // immediate snapshot
  void pending;
  return () => listeners.delete(cb);
}

export function getEventFeed(): EventItem[] {
  return events;
}

/** Drop everything locally after a successful server-side soft clear. */
export function clearEventFeed(): void {
  events = [];
  emit();
}
