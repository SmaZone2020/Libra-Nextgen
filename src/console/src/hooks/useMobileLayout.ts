import { useEffect, useState } from 'react';
import { getAccountMe } from '../api/account';
import { canSeeRoute } from '../utils/permissions';

/** Tailwind's `sm` breakpoint, kept in one place so every mobile/desktop split
 *  matches the `sm:` / `sm:hidden` utility classes. */
export const DESKTOP_MEDIA_QUERY = '(min-width: 640px)';

/** Tracks the desktop breakpoint (updates on rotation / window resize). */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_MEDIA_QUERY).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

/** Route visibility for the current account; optimistic while /account/me is
 *  in flight or unreachable so a network hiccup never hides a real route. */
export function useCanSeeRoute(to: string): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAccountMe()
      .then((me) => {
        if (!cancelled) setVisible(canSeeRoute(me.permissions ?? null, to));
      })
      .catch(() => {
        if (!cancelled) setVisible(true);
      });
    return () => { cancelled = true; };
  }, [to]);

  return visible;
}
