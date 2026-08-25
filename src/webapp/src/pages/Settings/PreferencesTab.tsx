import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Label, ListBox, Modal, Surface, Switch, Tabs } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { Check } from '@gravity-ui/icons';
import i18n, { switchLang } from '../../i18n';
import { getStoredTheme, applyTheme, type ThemePreference } from '../../utils/theme';
import { EVENT_TYPE_IDS, getEnabledEventTypes, setEnabledEventTypes } from '../../utils/eventTypes';

const NOTICE_SOUND_KEY = 'notice_sound';

export default function PreferencesTab() {
  const { t } = useTranslation();
  const [lang, setLang] = useState(() => (i18n.language.startsWith('zh') ? 'zh' : 'en'));
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme());
  const [sound, setSound] = useState(() => localStorage.getItem(NOTICE_SOUND_KEY) !== 'false');

  // 事件流事件类型选择
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Selection>(new Set());

  const openEventModal = () => {
    const enabled = getEnabledEventTypes();
    setSelectedEvents(new Set(EVENT_TYPE_IDS.filter((id) => !enabled || enabled.has(id))));
    setEventModalOpen(true);
  };

  const handleSaveEvents = () => {
    setEnabledEventTypes(Array.from(selectedEvents as Set<string>));
    setEventModalOpen(false);
  };

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
      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-semibold">{t('settings.language')}</h3>
          <Tabs selectedKey={lang} onSelectionChange={(key) => handleLang(String(key))}>
            <Tabs.List>
              <Tabs.Tab id="zh">中文<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="en">English<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </div>

        <div className="flex items-center justify-between gap-4">
          <h3 className="font-semibold">{t('settings.theme')}</h3>
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

        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.eventTypes')}</h3>
            <p className="text-sm text-default-500">{t('settings.eventTypesDesc')}</p>
          </div>
          <Button size="sm" variant="ghost" onPress={openEventModal}>
            {t('settings.selectEvents')}
          </Button>
        </div>
      </Card>

      <Modal.Backdrop isOpen={eventModalOpen} onOpenChange={(open) => { if (!open) setEventModalOpen(false); }}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{t('settings.selectEvents')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Surface className="rounded-3xl shadow-surface">
                <ListBox
                  aria-label={t('settings.eventTypes')}
                  selectedKeys={selectedEvents}
                  selectionMode="multiple"
                  onSelectionChange={setSelectedEvents}
                >
                  {EVENT_TYPE_IDS.map((id) => (
                    <ListBox.Item key={id} id={id} textValue={t(`settings.eventType.${id}`)}>
                      <div className="flex flex-col">
                        <Label>{t(`settings.eventType.${id}`)}</Label>
                      </div>
                      <ListBox.ItemIndicator>
                        {({ isSelected }) => (isSelected ? <Check className="size-4 text-accent" /> : null)}
                      </ListBox.ItemIndicator>
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Surface>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setEventModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onPress={handleSaveEvents}>
                {t('common.save')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
