
export const EVENT_TYPES_KEY = 'event_types';

export const EVENT_TYPE_IDS = ['agent', 'task', 'operator', 'shell'] as const;

export type EventTypeId = (typeof EVENT_TYPE_IDS)[number];

export function getEnabledEventTypes(): Set<string> | null {
  try {
    const raw = localStorage.getItem(EVENT_TYPES_KEY);
    if (!raw) return null;
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) return new Set(arr as string[]);
    return null;
  } catch {
    return null;
  }
}

export function setEnabledEventTypes(types: string[]): void {
  try {
    localStorage.setItem(EVENT_TYPES_KEY, JSON.stringify(types));
  } catch {
    // ignore
  }
}
