'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Label, Radio, RadioGroup, Switch, TextField, Input } from '@heroui/react';
import { getStorageStatus } from '../../api/system';
import type { SystemStorageStatus } from '../../api/system';
import { isLibraDesktopShell } from '../../desktop/DesktopTopBar';

/**
 * Desktop-only storage settings. Only meaningful inside the Libra Desktop
 * shell (it writes libra.conf.json and restarts the local service); renders
 * nothing in a plain browser / cloud deployment. Switching storage restarts
 * the service and never migrates data between SQLite and MongoDB.
 */
export default function StorageTab() {
  const { t } = useTranslation();
  const desktop = isLibraDesktopShell();
  const bridge = window.libraDesktop;

  const [status, setStatus] = useState<SystemStorageStatus | null>(null);
  const [mode, setMode] = useState<'sqlite' | 'mongo'>('sqlite');
  const [connectString, setConnectString] = useState('');
  const [fallback, setFallback] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getStorageStatus();
      setStatus(s);
      setMode(s.requested === 'mongo' ? 'mongo' : 'sqlite');
      setFallback(true);
    } catch {
      /* service may be mid-restart; keep last state */
    }
  }, []);

  useEffect(() => {
    if (desktop) load();
  }, [desktop, load]);

  if (!desktop || !bridge?.setStorageConfig) {
    return (
      <Card className="p-6">
        <p className="text-sm text-default-500">{t('settings.storageNotDesktop')}</p>
      </Card>
    );
  }

  // Mongo mode without a connect string cannot be applied.
  const canApply = mode === 'sqlite' || connectString.trim().length > 0;

  const apply = async () => {
    setError(null);
    setBusy(true);
    try {
      await bridge.setStorageConfig!({
        mode,
        connectString: mode === 'mongo' ? connectString.trim() : '',
        fallback,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
      // The service restarts; refresh the status view once it is back.
      setTimeout(() => load(), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fellBack = status != null && status.effective !== status.requested;

  return (
    <div className="space-y-6">
      {fellBack && status?.message && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          {status.message}
        </div>
      )}

      <Card className="p-6 space-y-5">
        <div>
          <h3 className="font-semibold">{t('settings.storageTab')}</h3>
          <p className="text-sm text-default-500">{t('settings.storageDesc')}</p>
        </div>

        {status && (
          <div className="flex items-center gap-2 text-sm">
            <Chip size="sm" variant="soft" color={fellBack ? 'warning' : 'success'}>
              {t('settings.storageCurrent')}: {status.effective}
            </Chip>
            {status.requested !== status.effective && (
              <span className="text-xs text-default-500">
                {t('settings.storageRequested')}: {status.requested}
              </span>
            )}
          </div>
        )}

        <RadioGroup value={mode} onChange={(v: string) => setMode(v as 'sqlite' | 'mongo')}>
          <Radio value="sqlite">
            <span className="text-sm">{t('settings.storageModeSqlite')}</span>
          </Radio>
          <Radio value="mongo">
            <span className="text-sm">{t('settings.storageModeMongo')}</span>
          </Radio>
        </RadioGroup>

        {mode === 'mongo' && (
          <TextField variant="secondary" value={connectString} onChange={setConnectString}>
            <Label>{t('settings.storageConnectString')}</Label>
            <Input placeholder="mongodb://user:pass@host:27017" />
          </TextField>
        )}

        <div className="flex items-center gap-3">
          <Switch isSelected={fallback} onChange={setFallback} size="sm" />
          <span className="text-sm text-default-600">{t('settings.storageFallbackSwitch')}</span>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {saved && <p className="text-sm text-success">{t('settings.storageSaved')}</p>}

        <div className="flex items-center gap-3">
          <Button size="sm" variant="primary" isDisabled={busy || !canApply} onPress={apply}>
            {t('settings.storageApply')}
          </Button>
          <span className="text-xs text-default-400">{t('settings.storageApplyHint')}</span>
        </div>
      </Card>
    </div>
  );
}
