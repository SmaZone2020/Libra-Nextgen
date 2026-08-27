import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, ListBox, Modal, Surface, Switch, Tabs, TextField } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { Check } from '@gravity-ui/icons';
import i18n, { switchLang } from '../../i18n';
import { getStoredTheme, applyTheme, type ThemePreference } from '../../utils/theme';
import { EVENT_TYPE_IDS, getEnabledEventTypes, setEnabledEventTypes } from '../../utils/eventTypes';
import { api } from '../../api/client';

const NOTICE_SOUND_KEY = 'notice_sound';

interface ListenerInfo {
  host: string;
  port: number;
  listenUrl: string;
}

export default function PreferencesTab() {
  const { t } = useTranslation();
  const [lang, setLang] = useState(() => (i18n.language.startsWith('zh') ? 'zh' : 'en'));
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme());
  const [sound, setSound] = useState(() => localStorage.getItem(NOTICE_SOUND_KEY) !== 'false');
  const [port, setPort] = useState('');
  const [portSaved, setPortSaved] = useState(false);
  const [portError, setPortError] = useState<string | null>(null);
  const [listener, setListener] = useState<ListenerInfo | null>(null);

  // 事件流事件类型选择
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Selection>(new Set());

  const loadListener = useCallback(async () => {
    try {
      const res = await api.get<ListenerInfo>('/settings/listener');
      setListener(res);
      setPort(String(res.port));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadListener(); }, [loadListener]);

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

  const savePort = async () => {
    const value = Number(port.trim());
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setPortError(t('settings.backendPortInvalid'));
      return;
    }
    setPortError(null);
    try {
      const res = await api.put<ListenerInfo>('/settings/listener', { port: value });
      setListener(res);
      setPort(String(res.port));
      setPortSaved(true);
      setTimeout(() => setPortSaved(false), 2000);
    } catch (err: unknown) {
      setPortError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-semibold">{t('settings.language')}</h3>
          <Tabs selectedKey={lang} onSelectionChange={(key) => handleLang(String(key))}>
            <Tabs.List>
              <Tabs.Tab id="zh" className="w-30">简体中文<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="en" className="w-30">English<Tabs.Indicator /></Tabs.Tab>
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
      </Card>

      <Card className="p-6 space-y-6">
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

      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.backendPort')}</h3>
            <p className="text-sm text-default-500">{t('settings.backendPortDesc')}</p>
            {listener && (
              <p className="text-xs text-default-400 mt-1">
                {t('settings.backendPortCurrent')}：<code className="font-mono">{listener.listenUrl}</code>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <TextField
              variant="secondary"
              className="w-40"
              value={port}
              onChange={(v) => {
                setPort(v);
                setPortError(null);
                setPortSaved(false);
              }}
            >
              <Label className="sr-only">{t('settings.backendPort')}</Label>
              <Input placeholder="5270" inputMode="numeric" />
            </TextField>
            {portError && <p className="text-xs text-danger">{portError}</p>}
            <Button size="sm" variant="primary" onPress={savePort}>
              {portSaved ? t('settings.backendPortSaved') : t('common.save')}
            </Button>
          </div>
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
