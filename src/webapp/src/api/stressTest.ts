import { api } from './client';
import type { StressStartRequest, StressCampaignDetail, StressTestCampaign } from '../types/models';

export function startStressTest(req: StressStartRequest): Promise<{ campaignId: string; status: string }> {
  return api.post('/stress-test/start', req);
}

export function stopStressTest(campaignId: string): Promise<{ campaignId: string; status: string }> {
  return api.post(`/stress-test/${campaignId}/stop`);
}

export function getStressStatus(campaignId: string): Promise<StressCampaignDetail> {
  return api.get(`/stress-test/${campaignId}`);
}

export function getActiveStressTest(): Promise<StressCampaignDetail | null> {
  return api.get('/stress-test/active');
}

export function getStressHistory(page = 1, pageSize = 20): Promise<{ campaigns: StressTestCampaign[]; page: number; pageSize: number }> {
  return api.get(`/stress-test/history?page=${page}&pageSize=${pageSize}`);
}
