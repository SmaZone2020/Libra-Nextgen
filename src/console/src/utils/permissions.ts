import type { UserPermissions } from '../types/models';

/** Route visibility gate shared by mobile surfaces. Mirrors the desktop
 *  sidebar logic: no permission data or fullAccess means everything is
 *  visible, otherwise the route key must be listed in allowedPages. */
export function canSeeRoute(permissions: UserPermissions | null, to: string): boolean {
  if (!permissions || permissions.fullAccess) return true;
  const key = to === '/' ? 'dashboard' : to.replace('/', '');
  return permissions.allowedPages.includes(key);
}
