import { api } from './client';

/** AI 事件订阅（Agent 上线/下线 → Justitia 提醒用户）。 */

export interface AiEventSubscription {
  id: string;
  /** 订阅的事件：agent.online | agent.offline。 */
  events: string[];
  /** session（控制台会话）| channel（IM 频道）。 */
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
