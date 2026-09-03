'use client';

export function parseModelLabel(raw: string): {
  vendor?: string;
  name: string;
  isFree: boolean;
  isLatest: boolean;
  isBatch: boolean;
} {
  let s = raw;
  let isFree = false;
  let isLatest = false;
  let isBatch = false;
  if (s.endsWith(':free')) {
    isFree = true;
    s = s.slice(0, -':free'.length);
  }
  if (s.endsWith(':batch')) {
    isBatch = true;
    s = s.slice(0, -':batch'.length);
  }
  if (s.startsWith('~')) {
    isLatest = true;
    s = s.slice(1);
  }
  const slash = s.indexOf('/');
  if (slash > 0) {
    return { vendor: s.slice(0, slash), name: s.slice(slash + 1), isFree, isLatest, isBatch };
  }
  return { name: s, isFree, isLatest, isBatch };
}

export function titleCaseWords(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replaceAll("Latest","");
}

export function formatModelDisplay(raw: string): string {
  const { name } = parseModelLabel(raw);
  return name ? titleCaseWords(name) : raw;
}
