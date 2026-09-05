import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Input,
  Label,
  Modal,
  Switch,
  Tabs,
  TextField,
} from '@heroui/react';
import { createAccount, updateAccount } from '../../api/account';
import type { AccountListItem, UserPermissions } from '../../types/models';

export interface AccountModalProps {
  open: boolean;
  editing: AccountListItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AccountModal({ open, editing, onClose, onSaved }: AccountModalProps) {
  const { t } = useTranslation();
  const [formName, setFormName] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('Operator');
  const [formFullAccess, setFormFullAccess] = useState(true);
  const [formPages, setFormPages] = useState<string[]>([]);
  const [formActions, setFormActions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setFormName(editing.username);
      setFormPassword('');
      setFormRole(editing.role);
      setFormFullAccess(editing.permissions?.fullAccess ?? true);
      setFormPages(editing.permissions?.allowedPages ?? []);
      setFormActions(editing.permissions?.allowedActions ?? []);
    } else {
      setFormName('');
      setFormPassword('');
      setFormRole('Operator');
      setFormFullAccess(true);
      setFormPages([]);
      setFormActions([]);
    }
    setFormError(null);
  }, [open, editing]);

  const buildPermissions = (): UserPermissions => ({
    fullAccess: formFullAccess,
    allowedPages: formPages,
    allowedActions: formActions,
  });

  const handleSave = async () => {
    if (!formName.trim()) { setFormError(t('settings.account.nameRequired')); return; }
    if (!editing && !formPassword) { setFormError(t('settings.account.passwordRequired')); return; }
    if (!editing && formPassword.length < 6) { setFormError(t('settings.account.passwordMinLength')); return; }
    setFormError(null);
    setSaving(true);
    try {
      if (editing) {
        await updateAccount(editing.id, {
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
      onClose();
      onSaved();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  };

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              {editing ? t('settings.account.editAccount') : t('settings.account.createAccount')}
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
              {!editing && (
                <TextField variant="secondary" value={formPassword} onChange={setFormPassword}>
                  <Label>{t('settings.account.password')}</Label>
                  <Input variant="secondary" type="password" />
                </TextField>
              )}
              <div className="space-y-2">
                <Label>{t('settings.account.role')}</Label>
                <Tabs className="w-full max-w-md">
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="选项">
                      <Tabs.Tab onPress={() => setFormRole('Admin')} id="roleAdmin">
                        {t('settings.account.roleAdmin')}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab onPress={() => setFormRole('Operator')} id="roleOperator">
                        {t('settings.account.roleOperator')}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                </Tabs>
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
                      <CheckboxGroup
                        name="allowedPages"
                        value={formPages}
                        onChange={(vals) => setFormPages([...vals])}
                      >
                        <Label>{t('settings.account.allowedPages')}</Label>
                        <div className="grid grid-cols-3 gap-1 mt-1 h-40 overflow-y-auto">
                          {PAGE_OPTIONS.map((p) => (
                            <Checkbox value={p.key}>
                              <Checkbox.Content className="flex flex-row items-center gap-2">
                                <Checkbox.Control className='bg-default'>
                                  <Checkbox.Indicator />
                                </Checkbox.Control>
                                {t(p.labelKey)}
                              </Checkbox.Content>
                            </Checkbox>
                          ))}
                        </div>
                      </CheckboxGroup>
                    </div>
                    <div>
                      <CheckboxGroup
                        name="allowedActions"
                        value={formActions}
                        onChange={(vals) => setFormActions([...vals])}
                      >
                        <Label>{t('settings.account.allowedActions')}</Label>
                        <div className="grid grid-cols-3 gap-1 mt-1 h-40 overflow-y-auto">
                          {ACTION_OPTIONS.map((a) => (
                            <Checkbox key={a} value={a}>
                              <Checkbox.Content className="flex flex-row items-center gap-2">
                                <Checkbox.Control className='bg-default'>
                                  <Checkbox.Indicator />
                                </Checkbox.Control>
                                {t(`riskPolicy.labels.${a}`)}
                              </Checkbox.Content>
                            </Checkbox>
                          ))}
                        </div>
                      </CheckboxGroup>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" isPending={saving} onPress={handleSave}>
              {t('settings.create')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

const PAGE_OPTIONS: { key: string; labelKey: string }[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard' },
  { key: 'nodes', labelKey: 'nav.nodes' },
  { key: 'agents', labelKey: 'nav.agents' },
  { key: 'shell', labelKey: 'nav.shell' },
  { key: 'files', labelKey: 'nav.explorer' },
  { key: 'system', labelKey: 'nav.system' },
  { key: 'othersoft', labelKey: 'nav.softwareData' },
  { key: 'proxy', labelKey: 'nav.proxyBrowser' },
  { key: 'ai', labelKey: 'nav.ai' },
  { key: 'builder', labelKey: 'nav.builder' },
  { key: 'audit', labelKey: 'nav.auditLogs' },
  { key: 'plugins', labelKey: 'nav.plugins' },
];

const ACTION_OPTIONS = [
  'shell.command', 'file.list', 'file.read', 'file.write', 'file.delete',
  'file.mkdir', 'file.rename', 'file.move', 'file.copy', 'file.compress', 'file.decompress',
  'system.info', 'system.processes', 'system.process.kill', 'system.network',
  'credentials',
  'proxy.fetch',
];
