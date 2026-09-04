import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, TextField } from '@heroui/react';
import { setup } from '../../api/auth';
import { getApiOrigin, pingBackend, setApiOriginOverride } from '../../api/client';
import type { SetupRequest } from '../../types/models';

interface SetupPageProps {
  onSetup: (username: string, role: string) => void;
}

type Phase = 'backend' | 'account';

function withScheme(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

export default function SetupPage({ onSetup }: SetupPageProps) {
  const { t } = useTranslation();

  // Step 1 — backend address (defaults to the effective origin)
  const [phase, setPhase] = useState<Phase>('backend');
  const [origin, setOrigin] = useState(() => getApiOrigin());
  const [originError, setOriginError] = useState('');
  const [probing, setProbing] = useState(false);

  // Step 2 — create the initial admin account
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNext = async () => {
    setOriginError('');
    const value = origin.trim();
    if (!value) {
      setOriginError(t('network.invalidOrigin'));
      return;
    }
    const target = withScheme(value);
    if (target === getApiOrigin()) {
      // Keeping the current (default) backend: go straight to account setup.
      setPhase('account');
      return;
    }
    // A different backend was typed in: probe it first, then persist & reboot
    // so the whole app (and the setup state) targets the new address.
    setProbing(true);
    try {
      const ok = await pingBackend(target);
      if (!ok) {
        setOriginError(t('network.unreachableOrigin'));
        return;
      }
      setApiOriginOverride(target);
      window.location.reload();
    } catch {
      setOriginError(t('network.unreachableOrigin'));
    } finally {
      setProbing(false);
    }
  };

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
        <Card.Header className="mb-4">
          <Card.Title className="mx-auto text-[28px] libre">Libra-Nextgen</Card.Title>
        </Card.Header>

        <p className="mb-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
          {t('setup.stepLabel', {
            current: phase === 'backend' ? 1 : 2,
            total: 2,
          })}
        </p>

        {phase === 'backend' ? (
          <>
            <Card.Content className="flex flex-col gap-4">
              <h2 className="text-center text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {t('setup.backendTitle')}
              </h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
                {t('setup.backendDesc')}
              </p>
              <div className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {t('setup.currentOrigin')}：
                <code className="font-mono">{getApiOrigin()}</code>
              </div>
              <TextField
                variant="secondary"
                autoFocus
                value={origin}
                onChange={setOrigin}
                aria-label={t('setup.currentOrigin')}
              >
                <Label>{t('setup.currentOrigin')}</Label>
                <Input variant="secondary" placeholder="http://host:5270" />
              </TextField>
              {originError && (
                <div className="bg-danger-50 border border-danger text-danger px-4 py-2 rounded-medium text-sm">
                  {originError}
                </div>
              )}
            </Card.Content>
            <Card.Footer className="flex items-center justify-between gap-2 pt-6">
              <Button
                variant="ghost"
                className="shrink-0"
                isDisabled={probing || origin.trim() === getApiOrigin()}
                onPress={() => setOrigin(getApiOrigin())}
              >
                {t('setup.resetDefault')}
              </Button>
              <Button
                variant="primary"
                isDisabled={probing}
                onPress={() => void handleNext()}
              >
                {probing ? t('common.loading') : t('setup.nextStep')}
              </Button>
            </Card.Footer>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <Card.Content className="flex flex-col gap-4">
              <h2 className="text-center text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {t('setup.createAccount')}
              </h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
                {t('setup.description')}
              </p>
              {error && (
                <div className="bg-danger-50 border border-danger text-danger px-4 py-2 rounded-medium text-sm">
                  {error}
                </div>
              )}
              <TextField variant="secondary" autoFocus value={username} onChange={setUsername}>
                <Label>{t('setup.username')}</Label>
                <Input variant="secondary" placeholder="admin" />
              </TextField>
              <TextField variant="secondary" type="password" value={password} onChange={setPassword}>
                <Label>{t('setup.password')}</Label>
                <Input variant="secondary" placeholder="••••••••" />
              </TextField>
              <TextField variant="secondary" type="password" value={confirmPassword} onChange={setConfirmPassword}>
                <Label>{t('setup.confirmPassword')}</Label>
                <Input variant="secondary" placeholder="••••••••" />
              </TextField>
            </Card.Content>
            <Card.Footer className="flex items-center justify-between gap-2 pt-6">
              <Button variant="ghost" className="shrink-0" onPress={() => setPhase('backend')}>
                {t('setup.backStep')}
              </Button>
              <Button
                isDisabled={loading}
                type="submit"
                variant="primary"
                className="px-10"
              >
                {loading ? t('setup.settingUp') : t('setup.createAccount')}
              </Button>
            </Card.Footer>
          </form>
        )}
      </Card>
    </div>
  );
}
