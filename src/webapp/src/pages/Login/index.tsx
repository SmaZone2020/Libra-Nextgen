import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, TextField } from '@heroui/react';
import { login } from '../../api/auth';
import type { LoginRequest } from '../../types/models';

interface LoginPageProps {
  onLogin: (username: string, role: string) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const req: LoginRequest = { username, password };
      const res = await login(req);
      onLogin(res.username, res.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.loginFailed'));
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
            {error && (
              <div className="bg-danger-50 border border-danger text-danger px-4 py-2 rounded-medium text-sm">
                {error}
              </div>
            )}
            <TextField variant="secondary" autoFocus value={username} onChange={setUsername}>
              <Label>{t('login.username')}</Label>
              <Input placeholder="admin" />
            </TextField>
            <TextField variant="secondary" type="password" value={password} onChange={setPassword}>
              <Label>{t('login.password')}</Label>
              <Input placeholder="admin123" />
            </TextField>
          </Card.Content>
          <Card.Footer className="pt-6">
            <Button
              isDisabled={loading}
              type="submit"
              variant="primary"
              className="px-10 mx-auto"
            >
              {loading ? t('login.signingIn') : t('login.signIn')}
            </Button>
          </Card.Footer>
        </form>
      </Card>
    </div>
  );
}
