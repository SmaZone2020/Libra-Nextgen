'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Label, Tabs, TextField, Input } from '@heroui/react';
import { getStorageStatus } from '../../api/system';
import type { SystemStorageStatus } from '../../api/system';
import { isLibraDesktopShell } from '../../desktop/DesktopTopBar';

const STORE_LABEL: Record<string, string> = { sqlite: 'SQLite', mongo: 'MongoDB' };

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
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getStorageStatus();
      setStatus(s);
      setMode(s.requested === 'mongo' ? 'mongo' : 'sqlite');
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

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-5">
        <div>
          <h3 className="font-semibold">{t('settings.storageTab')}</h3>
          <p className="text-sm text-default-500">{t('settings.storageDesc')}</p>
        </div>

        {status && (
          <div className="flex items-center gap-2 text-sm">
            <Chip size="sm" variant="soft" color="success">
              {t('settings.storageCurrent')}: {STORE_LABEL[status.effective] ?? status.effective}
            </Chip>
          </div>
        )}

        <Tabs selectedKey={mode} onSelectionChange={(key) => setMode(String(key) as 'sqlite' | 'mongo')}>
          <Tabs.List>
            <Tabs.Tab id="sqlite" className="w-32">{STORE_LABEL.sqlite}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="mongo" className="w-32">{STORE_LABEL.mongo}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {mode === 'mongo' && (
          <TextField variant="secondary" value={connectString} onChange={setConnectString}>
            <Label>{t('settings.storageConnectString')}</Label>
            <Input placeholder="mongodb://user:pass@host:27017" />
          </TextField>
        )}

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
