// Desktop 'allow text selection' preference. The console UI (HeroUI and
// component styles) disables user-select in most places for an app-like feel;
// when enabled we force text selection back on at the document root.
export const USER_SELECT_KEY = 'libra.user_select_enabled';

export function isUserSelectEnabled(): boolean {
  try {
    return localStorage.getItem(USER_SELECT_KEY) === '1';
  } catch {
    return false;
  }
}

export function applyUserSelect(enabled: boolean): void {
  document.documentElement.classList.toggle('lw-user-select-enabled', enabled);
}

export function initUserSelect(): void {
  applyUserSelect(isUserSelectEnabled());
}

export function setUserSelect(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(USER_SELECT_KEY, '1');
    else localStorage.removeItem(USER_SELECT_KEY);
  } catch {
    /* storage unavailable */
  }
  applyUserSelect(enabled);
}
