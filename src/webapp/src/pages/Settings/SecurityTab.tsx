'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Input, Label, Switch, TextField } from '@heroui/react';
import { getListener, updateListener, getSecurity, updateSecurity } from '../../api/system';

export default function SecurityTab() {
  const { t } = useTranslation();
  const [port, setPort] = useState('');
  const [bindLoopbackOnly, setBindLoopbackOnly] = useState(false);
  const [openLan, setOpenLan] = useState(true);
  const [listenUrl, setListenUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [listener, security] = await Promise.all([getListener(), getSecurity()]);
      setPort(String(listener.port));
      setBindLoopbackOnly(listener.bindLoopbackOnly);
      setOpenLan(security.openLan);
      setListenUrl(listener.listenUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveListener = async () => {
    const value = Number(port.trim());
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setError(t('settings.backendPortInvalid'));
      return;
    }
    setError(null);
    try {
      const res = await updateListener({ port: value, bindLoopbackOnly });
      setPort(String(res.port));
      setBindLoopbackOnly(res.bindLoopbackOnly);
      setListenUrl(res.listenUrl);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveSecurity = async () => {
    setError(null);
    try {
      const res = await updateSecurity({ openLan });
      setOpenLan(res.openLan);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.backendPort')}</h3>
            <p className="text-sm text-default-500">{t('settings.backendPortDesc')}</p>
            {listenUrl && (
              <p className="text-xs text-default-400 mt-1">
                {t('settings.backendPortCurrent')}：<code className="font-mono">{listenUrl}</code>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <TextField variant="secondary" className="w-40" value={port} onChange={setPort}>
              <Label className="sr-only">{t('settings.backendPort')}</Label>
              <Input placeholder="5270" inputMode="numeric" />
            </TextField>
            <Button size="sm" variant="primary" onPress={saveListener}>
              {saved ? t('settings.backendPortSaved') : t('common.save')}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.bindLoopbackOnly')}</h3>
            <p className="text-sm text-default-500">{t('settings.bindLoopbackOnlyDesc')}</p>
          </div>
          <Switch isSelected={bindLoopbackOnly} onChange={setBindLoopbackOnly}>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>
        </div>
      </Card>

      <Card className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.openLan')}</h3>
            <p className="text-sm text-default-500">{t('settings.openLanDesc')}</p>
            <div className="mt-2">
              <Chip size="sm" variant="soft" color={openLan ? 'success' : 'danger'}>
                {openLan ? t('settings.openLanOn') : t('settings.openLanOff')}
              </Chip>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Switch isSelected={openLan} onChange={setOpenLan}>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
            <Button size="sm" variant="primary" onPress={saveSecurity}>
              {saved ? t('settings.backendPortSaved') : t('common.save')}
            </Button>
          </div>
        </div>
        {bindLoopbackOnly && (
          <p className="text-xs text-default-400">{t('settings.openLanLoopbackHint')}</p>
        )}
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
