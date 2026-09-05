'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Tabs } from '@heroui/react';
import type { CloseBehavior } from '../../desktop/DesktopTopBar';
import { isLibraDesktopShell } from '../../desktop/DesktopTopBar';

/**
 * Desktop-only window close behavior. Only meaningful inside the Libra
 * Desktop shell (it persists desktop.closeBehavior into libra.conf.json);
 * renders a fallback card in older shells without the capability.
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

  if (!desktop || !bridge?.setCloseBehavior) {
    return (
      <Card className="p-6">
        <p className="text-sm text-default-500">{t('settings.closeActionNotDesktop')}</p>
      </Card>
    );
  }

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
    <div className="space-y-6">
      <Card className="p-6 space-y-5">
        <div>
          <h3 className="font-semibold">{t('settings.closeActionTab')}</h3>
          <p className="text-sm text-default-500">{t('settings.closeActionDesc')}</p>
        </div>

        <Tabs selectedKey={behavior} onSelectionChange={(key) => void handleChange(key)}>
          <Tabs.List>
            <Tabs.Tab id="quit" className="w-40">{t('settings.closeActionQuit')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="tray" className="w-40">{t('settings.closeActionTray')}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <p className="text-xs text-default-400">
          {behavior === 'tray'
            ? t('settings.closeActionNoteTray')
            : t('settings.closeActionNoteQuit')}
        </p>

        {error && <p className="text-sm text-danger">{error}</p>}
      </Card>
    </div>
  );
}
