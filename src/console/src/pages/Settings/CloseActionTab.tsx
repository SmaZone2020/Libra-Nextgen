'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Tabs } from '@heroui/react';
import type { CloseBehavior } from '../../desktop/DesktopTopBar';
import { isLibraDesktopShell } from '../../desktop/DesktopTopBar';

/**
 * Desktop-only window close behavior, rendered inside Preferences with the
 * same row layout as the language picker (label on the left, tabs on the
 * right). Persists desktop.closeBehavior via the shell bridge.
 */
export default function CloseActionTab() {
  const { t } = useTranslation();
  const desktop = isLibraDesktopShell();
  const bridge = window.libraDesktop;

  const [behavior, setBehavior] = useState<CloseBehavior>('quit');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop || !bridge?.getCloseBehavior) return;
    let alive = true;
    bridge
      .getCloseBehavior!()
      .then((v) => {
        if (alive) setBehavior(v === 'tray' ? 'tray' : 'quit');
      })
      .catch(() => {
        /* shell not ready; keep the default */
      });
    return () => {
      alive = false;
    };
  }, [desktop, bridge]);

  if (!desktop || !bridge?.setCloseBehavior) return null;

  const handleChange = async (key: string | number) => {
    const next: CloseBehavior = key === 'tray' ? 'tray' : 'quit';
    setError(null);
    try {
      const ok = await bridge.setCloseBehavior!(next);
      if (ok) setBehavior(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="font-semibold">{t('settings.closeActionTab')}</h3>
        <Tabs selectedKey={behavior} onSelectionChange={(key) => void handleChange(key)}>
          <Tabs.List>
            <Tabs.Tab id="quit" className="w-36">{t('settings.closeActionQuit')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="tray" className="w-36">{t('settings.closeActionTray')}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}
