import { api } from './client';


export interface AiEventSubscription {
  id: string;
  events: string[];
  targetType: 'session' | 'channel';
  targetId: string;
  targetUserId?: string | null;
  createdAt: string;
}

export interface AiEventSubscriptionInput {
  events: string[];
  targetType: 'session' | 'channel';
  targetId: string;
  targetUserId?: string | null;
}

export async function getAiEventSubscriptions(): Promise<AiEventSubscription[]> {
  return api.get<AiEventSubscription[]>('/ai/event-subscriptions');
}

export async function createAiEventSubscription(
  input: AiEventSubscriptionInput,
): Promise<AiEventSubscription> {
  return api.post<AiEventSubscription>('/ai/event-subscriptions', input);
}

export async function deleteAiEventSubscription(id: string): Promise<void> {
  await api.delete<void>(`/ai/event-subscriptions/${id}`);
}
