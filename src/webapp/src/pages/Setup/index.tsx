import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, TextField } from '@heroui/react';
import { setup } from '../../api/auth';
import type { SetupRequest } from '../../types/models';

interface SetupPageProps {
  onSetup: (username: string, role: string) => void;
}

export default function SetupPage({ onSetup }: SetupPageProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (username.trim().length < 2) {
      setError(t('setup.usernameMinLength'));
      return;
    }
    if (password.length < 6) {
      setError(t('setup.passwordMinLength'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('setup.passwordsMismatch'));
      return;
    }

    setLoading(true);
    try {
      const req: SetupRequest = { username: username.trim(), password, confirmPassword };
      const res = await setup(req);
      onSetup(res.username, res.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('setup.setupFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={handleSubmit}>
          <Card.Header className="mb-6">
            <Card.Title className="mx-auto text-[28px] libre">Libra-Nextgen</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
              {t('setup.description')}
            </p>
            {error && (
              <div className="bg-danger-50 border border-danger text-danger px-4 py-2 rounded-medium text-sm">
                {error}
              </div>
            )}
            <TextField autoFocus value={username} onChange={setUsername}>
              <Label>{t('setup.username')}</Label>
              <Input placeholder="admin" />
            </TextField>
            <TextField type="password" value={password} onChange={setPassword}>
              <Label>{t('setup.password')}</Label>
              <Input placeholder="••••••••" />
            </TextField>
            <TextField type="password" value={confirmPassword} onChange={setConfirmPassword}>
              <Label>{t('setup.confirmPassword')}</Label>
              <Input placeholder="••••••••" />
            </TextField>
          </Card.Content>
          <Card.Footer className="pt-6">
            <Button
              isDisabled={loading}
              type="submit"
              variant="primary"
              className="px-10 mx-auto"
            >
              {loading ? t('setup.settingUp') : t('setup.createAccount')}
            </Button>
          </Card.Footer>
        </form>
      </Card>
    </div>
  );
}
