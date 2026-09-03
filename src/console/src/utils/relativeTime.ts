/**
 * Relative-time formatting. Returns an i18n key + count the caller renders
 * through `t(key, { count })`:
 *   <60s  -> time.justNow
 *   <60m  -> time.minutesAgo (count minutes)
 *   <24h  -> time.hoursAgo   (count hours)
 *   <30d  -> time.daysAgo    (count days)
 *   else  -> time.monthsAgo  (count months)
 * Returns null for empty/invalid input. Clock skew clamps to "just now".
 */
export interface RelativeTime {
  key: string;
  count: number;
}

export function relativeTime(iso: string, now: number = Date.now()): RelativeTime | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return { key: 'time.justNow', count: 0 };

  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return { key: 'time.minutesAgo', count: minutes };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'time.hoursAgo', count: hours };

  const days = Math.floor(hours / 24);
  if (days < 30) return { key: 'time.daysAgo', count: days };

  return { key: 'time.monthsAgo', count: Math.floor(days / 30) };
}
