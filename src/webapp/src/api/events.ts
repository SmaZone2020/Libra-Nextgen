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
