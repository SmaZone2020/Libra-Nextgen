import { api } from './client';

export type RiskLevel = 'Safe' | 'Normal' | 'Dangerous' | 'Malicious';

export type RiskMappings = Record<string, RiskLevel>;

export interface RiskPolicyResponse {
  mappings: RiskMappings;
  defaults: RiskMappings;
}

export async function getRiskPolicy(): Promise<RiskPolicyResponse> {
  return api.get<RiskPolicyResponse>('/risk-policy');
}

export async function saveRiskPolicy(mappings: RiskMappings): Promise<void> {
  await api.put<void>('/risk-policy', { mappings });
}
