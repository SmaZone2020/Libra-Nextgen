import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Spinner } from '@heroui/react';
import { getAccountStatus, listAccounts, deleteAccount } from '../../api/account';
import { getStoredUser } from '../../api/auth';
import type { AccountListItem } from '../../types/models';
import { useDialog } from '../../hooks/useDialog';
import { AccountModal } from './AccountModal';
import { ChangePasswordModal } from './ChangePasswordModal';

export default function AccountTab() {
  const { t } = useTranslation();
  const { confirm, DialogComponent } = useDialog();
  const [isInitial, setIsInitial] = useState(false);
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Create / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountListItem | null>(null);

  // Change password modal
  const [pwModalOpen, setPwModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [status, list] = await Promise.all([
        getAccountStatus(),
        listAccounts(),
      ]);
      setIsInitial(status.isInitial);
      setAccounts(Array.isArray(list) ? list : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openCreateModal = () => {
    setEditingAccount(null);
    setModalOpen(true);
  };

  const openEditModal = (acc: AccountListItem) => {
    setEditingAccount(acc);
    setModalOpen(true);
  };

  const handleDelete = async (acc: AccountListItem) => {
    const result = await confirm(t('settings.account.deleteConfirm', { name: acc.username }));
    if (!result.confirmed) return;
    try {
      await deleteAccount(acc.id);
      await loadData();
    } catch {
      // Show error? For now silently fail
    }
  };

  async function loadAccounts() {
    try {
      const list = await listAccounts();
      setAccounts(Array.isArray(list) ? list : []);
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Account Management Card — Admin only */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('settings.account.accounts')}</h2>
          <Button variant="primary" size="sm" onPress={openCreateModal}>
            {t('settings.account.createAccount')}
          </Button>
        </div>
        <div className="space-y-3">
          {accounts.map((a) => {
            const isRestricted = !(a.permissions?.fullAccess ?? true);
            const isSelf = a.username === (getStoredUser()?.username ?? '');
            return (
              <Card key={a.id} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 shrink-0 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-semibold">
                      {a.username.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{a.username}</span>
                        {a.isInitial && (
                          <Chip size="sm" variant="soft" color="accent">{t('settings.account.initialBadge')}</Chip>
                        )}
                      </div>
                      <div className="text-xs text-default-500 mt-0.5 truncate">
                        {t('settings.account.createdAt')} {new Date(a.createdAt).toLocaleDateString()}
                        {a.lastLogin ? ` · ${t('settings.account.lastLogin')} ${new Date(a.lastLogin).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Chip size="sm" variant="soft" color={a.role === 'Admin' ? 'accent' : 'default'}>
                      {a.role === 'Admin' ? t('settings.account.roleAdmin') : t('settings.account.roleOperator')}
                    </Chip>
                    <Chip size="sm" variant="soft" color={a.isActive ? 'success' : 'danger'}>
                      {a.isActive ? t('settings.account.active') : t('settings.account.inactive')}
                    </Chip>
                    {isRestricted && (
                      <Chip size="sm" variant="soft" color="warning">
                        {t('settings.account.restricted')}
                      </Chip>
                    )}
                    {isSelf ? (
                      <Button size="sm" variant="ghost" onPress={() => setPwModalOpen(true)}>
                        {t('settings.account.changePassword')}
                      </Button>
                    ) : !a.isInitial && (
                      <div className="flex gap-1 ml-1">
                        <Button size="sm" variant="ghost" onPress={() => openEditModal(a)}>
                          {t('settings.edit')}
                        </Button>
                        <Button size="sm" variant="danger" onPress={() => handleDelete(a)}>
                          {t('settings.delete')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
          {accounts.length === 0 && (
            <div className="py-10 text-center text-default-400 text-sm">{t('settings.account.noAccounts')}</div>
          )}
        </div>
      </Card>

      {/* Create/Edit Modal */}
      <AccountModal
        open={modalOpen}
        editing={editingAccount}
        onClose={() => setModalOpen(false)}
        onSaved={() => void loadAccounts()}
      />

      {/* Change Password Modal */}
      <ChangePasswordModal
        open={pwModalOpen}
        onClose={() => setPwModalOpen(false)}
      />

      {DialogComponent}
    </div>
  );
}
