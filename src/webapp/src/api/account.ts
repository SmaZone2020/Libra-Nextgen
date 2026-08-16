import { api } from './client';
import type { AccountListItem, AccountMe, AccountStatus, ChangePasswordRequest, CreateAccountRequest, UpdateAccountRequest } from '../types/models';

export async function getAccountMe(): Promise<AccountMe> {
  return api.get<AccountMe>('/account/me');
}

export async function acceptAgreement(): Promise<void> {
  return api.post<void>('/account/accept-agreement');
}

export async function getAccountStatus(): Promise<AccountStatus> {
  return api.get<AccountStatus>('/account/status');
}

export async function listAccounts(): Promise<AccountListItem[]> {
  return api.get<AccountListItem[]>('/account/list');
}

export async function createAccount(req: CreateAccountRequest): Promise<AccountListItem> {
  return api.post<AccountListItem>('/account', req);
}

export async function updateAccount(id: string, req: UpdateAccountRequest): Promise<void> {
  return api.put<void>(`/account/${id}`, req);
}

export async function deleteAccount(id: string): Promise<void> {
  return api.delete(`/account/${id}`);
}

export async function changePassword(req: ChangePasswordRequest): Promise<void> {
  return api.post('/account/change-password', req);
}
