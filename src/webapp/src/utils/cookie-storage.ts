'use client';

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] != null ? decodeURIComponent(match[1]) : null;
}

export function setCookie(
  name: string,
  value: string,
  maxAge = 31536000
): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }
}

export function createCookieStorage(maxAge = 31536000) {
  return {
    getItem(key: string): string | null {
      return (
        getCookie(key) ??
        (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null)
      );
    },
    setItem(key: string, value: string): void {
      setCookie(key, value, maxAge);
      try {
        localStorage.setItem(key, value);
      } catch {
        // ignore
      }
    },
  };
}
