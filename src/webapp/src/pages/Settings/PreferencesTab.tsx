import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Switch, Tabs } from '@heroui/react';
import i18n, { switchLang } from '../../i18n';
import { getStoredTheme, applyTheme, type ThemePreference } from '../../utils/theme';

const NOTICE_SOUND_KEY = 'notice_sound';

export default function PreferencesTab() {
  const { t } = useTranslation();
  const [lang, setLang] = useState(() => (i18n.language.startsWith('zh') ? 'zh' : 'en'));
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme());
  const [sound, setSound] = useState(() => localStorage.getItem(NOTICE_SOUND_KEY) !== 'false');

  const handleLang = (key: string) => {
    const next = key === 'zh' ? 'zh' : 'en';
    setLang(next);
    switchLang(next);
  };

  const handleTheme = (key: string) => {
    const next = key as ThemePreference;
    setTheme(next);
    applyTheme(next);
  };

  const handleSound = (checked: boolean) => {
    setSound(checked);
    localStorage.setItem(NOTICE_SOUND_KEY, String(checked));
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-8">
        <div>
          <h3 className="font-semibold mb-3">{t('settings.language')}</h3>
          <Tabs selectedKey={lang} onSelectionChange={(key) => handleLang(String(key))}>
            <Tabs.List>
              <Tabs.Tab id="zh">中文<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="en">English<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </div>

        <div>
          <h3 className="font-semibold mb-3">{t('settings.theme')}</h3>
          <Tabs selectedKey={theme} onSelectionChange={(key) => handleTheme(String(key))}>
            <Tabs.List>
              <Tabs.Tab id="light">{t('settings.themeLight')}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="dark">{t('settings.themeDark')}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="system">{t('settings.themeSystem')}<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.noticeSound')}</h3>
            <p className="text-sm text-default-500">{t('settings.noticeSoundDesc')}</p>
          </div>
          <Switch isSelected={sound} onChange={handleSound}>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>
        </div>
      </Card>
    </div>
  );
}
