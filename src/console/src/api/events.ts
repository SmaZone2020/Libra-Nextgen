import { api } from './client';

export interface EventItem {
  id: string;
  kind: string;
  text: string;
  ts: string;
}

export interface EventPage {
  events: EventItem[];
}

export function getRecentEvents(limit = 50): Promise<EventPage> {
  return api.get<EventPage>(`/events?limit=${limit}`);
}

/** Server-side soft clear: hides events older than now for the current user
 *  (audit logs and other users' feeds stay untouched). */
export function clearRecentEvents(): Promise<{ status: string }> {
  return api.post<{ status: string }>('/events/clear');
}
