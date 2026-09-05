'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Input, Label, Switch, TextField } from '@heroui/react';
import { getListener, updateListener, getSecurity, updateSecurity } from '../../api/system';
import type { DesktopListenerSettings } from '../../desktop/DesktopTopBar';
import { isLibraDesktopShell } from '../../desktop/DesktopTopBar';

/**
 * Access security: listener port, loopback-only binding and LAN openness.
 *
 * Two apply paths, because the listener is configured at process start:
 *  - Libra Desktop shell: the shell owns libra.conf.json and restarts the
 *    service — listener changes go through the shell bridge, so a web-app
 *    request never kills the process underneath the shell.
 *  - Bare web-app deployment: /api/settings persists to the service settings
 *    file and the service relaunches itself with the same command line.
 * Switches apply immediately (no separate save button).
 */
export default function SecurityTab() {
  const { t } = useTranslation();
  const desktop = isLibraDesktopShell();
  const bridge = window.libraDesktop;

  const [port, setPort] = useState('');
  const [bindLoopbackOnly, setBindLoopbackOnly] = useState(false);
  const [openLan, setOpenLan] = useState(true);
  const [listenUrl, setListenUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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

  const loadDesktop = useCallback(async () => {
    if (!desktop || !bridge?.getListenerConfig) return;
    try {
      const conf: DesktopListenerSettings = await bridge.getListenerConfig();
      setPort(String(conf.port));
      setBindLoopbackOnly(conf.bindLoopback);
      setListenUrl(
        `http://${conf.bindLoopback ? '127.0.0.1' : '0.0.0.0'}:${conf.port}`,
      );
      const security = await getSecurity();
      setOpenLan(security.openLan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [desktop, bridge]);

  useEffect(() => {
    if (desktop && bridge?.getListenerConfig) void loadDesktop();
    else void load();
  }, [desktop, bridge, load, loadDesktop]);

  const restartAfterApply = useCallback(async () => {
    setRestarting(true);
    showSaved();
    try {
      if (desktop && bridge?.restartService) {
        // The shell restarts the service and reloads the window afterwards.
        await bridge.restartService();
        setTimeout(() => loadDesktop(), 3000);
      }
      // Bare web-app: the server schedules its own relaunch (1.5s) after the
      // response returns; the UI just explains what is happening.
      setTimeout(() => setRestarting(false), 2500);
    } catch (e) {
      setRestarting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [desktop, bridge, loadDesktop]);

  const saveListener = useCallback(
    async (nextPort: number, nextLoopback: boolean) => {
      if (busyRef.current) return;
      if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
        setError(t('settings.backendPortInvalid'));
        return;
      }
      busyRef.current = true;
      setError(null);
      setSaved(false);
      try {
        if (desktop && bridge?.setListenerConfig) {
          // The bridge writes libra.conf.json and restarts the service
          // itself (shell-supervised), so no extra restart below.
          await bridge.setListenerConfig({ port: nextPort, bindLoopback: nextLoopback });
          setPort(String(nextPort));
          setBindLoopbackOnly(nextLoopback);
          setListenUrl(`http://${nextLoopback ? '127.0.0.1' : '0.0.0.0'}:${nextPort}`);
          showSaved();
        } else {
          const res = await updateListener({ port: nextPort, bindLoopbackOnly: nextLoopback });
          setPort(String(res.port));
          setBindLoopbackOnly(res.bindLoopbackOnly);
          setListenUrl(res.listenUrl);
          await restartAfterApply();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busyRef.current = false;
      }
    },
    [desktop, bridge, restartAfterApply, t],
  );

  const saveSecurity = useCallback(
    async (next: boolean) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError(null);
      setSaved(false);
      try {
        const res = await updateSecurity({ openLan: next });
        setOpenLan(res.openLan);
        // Server-side security (CORS) also binds at startup: apply needs a
        // restart — via the shell bridge here, or the server relaunching
        // itself in bare web-app mode (updateSecurity schedules it).
        if (desktop && bridge?.restartService) {
          await restartAfterApply();
        } else {
          setRestarting(true);
          showSaved();
          setTimeout(() => setRestarting(false), 2500);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busyRef.current = false;
      }
    },
    [desktop, bridge, restartAfterApply],
  );

  const handlePortSave = () => saveListener(Number(port.trim()), bindLoopbackOnly);

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
            <Button size="sm" variant="primary" isDisabled={busyRef.current} onPress={() => void handlePortSave()}>
              {saved ? t('settings.backendPortSaved') : t('common.save')}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.bindLoopbackOnly')}</h3>
            <p className="text-sm text-default-500">{t('settings.bindLoopbackOnlyDesc')}</p>
          </div>
          <Switch
            isSelected={bindLoopbackOnly}
            onChange={(v) => void saveListener(Number(port.trim()) || 5270, v)}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
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
            <Switch isSelected={openLan} onChange={(v) => void saveSecurity(v)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          </div>
        </div>
        {bindLoopbackOnly && (
          <p className="text-xs text-default-400">{t('settings.openLanLoopbackHint')}</p>
        )}
      </Card>

      {restarting && (
        <p className="text-sm text-success" role="status">
          {t('settings.appliedRestarting')}
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
