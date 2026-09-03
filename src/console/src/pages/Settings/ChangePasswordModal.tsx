import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';
import { changePassword } from '../../api/account';

export interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const { t } = useTranslation();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrentPw('');
    setNewPw('');
    setPwError(null);
  }, [open]);

  const handleChangePassword = async () => {
    if (!currentPw) { setPwError(t('settings.account.currentPasswordRequired')); return; }
    if (newPw.length < 6) { setPwError(t('settings.account.passwordMinLength')); return; }
    setPwError(null);
    setPwSaving(true);
    try {
      await changePassword({ currentPassword: currentPw, newPassword: newPw });
      onClose();
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : String(err));
    } finally { setPwSaving(false); }
  };

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="sm">
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
            <Button variant="ghost" onPress={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" isPending={pwSaving} onPress={handleChangePassword}>
              {t('settings.account.changePassword')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
