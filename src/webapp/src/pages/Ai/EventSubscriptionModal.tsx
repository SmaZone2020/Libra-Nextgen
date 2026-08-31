'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  Chip,
  Description,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  Tabs,
} from '@heroui/react';
import clsx from 'clsx';
import { ArrowRightFromSquare, DisplayPulse, TrashBin } from '@gravity-ui/icons';
import { getAiSessions, type AiSession } from '../../api/ai';
import { getAiChannels, type AiChannel } from '../../api/aiChannels';
import {
  createAiEventSubscription,
  deleteAiEventSubscription,
  getAiEventSubscriptions,
  type AiEventSubscription,
} from '../../api/aiEventSubscriptions';
import { useDialog } from '../../hooks/useDialog';
import { TIER_LABELS } from '../Settings/ChannelsTab';

const EVENT_OPTIONS = [
  { id: 'agent.online', titleKey: 'ai.eventOnline', descKey: 'ai.eventOnlineDesc', icon: DisplayPulse },
  { id: 'agent.offline', titleKey: 'ai.eventOffline', descKey: 'ai.eventOfflineDesc', icon: ArrowRightFromSquare },
] as const;

const CHANNEL_ICONS: Record<string, string> = {
  telegram: '/icon/app/tg.png',
  lark: '/icon/app/lark.png',
  'wechat-claw': '/icon/app/wechat.png',
};
export function EventSubscriptionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { confirm, alert, DialogComponent } = useDialog();

  const [events, setEvents] = useState<string[]>([]);
  const [targetType, setTargetType] = useState<'session' | 'channel'>('session');
  const [sessionId, setSessionId] = useState('');
  const [channelId, setChannelId] = useState('');

  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [channels, setChannels] = useState<AiChannel[]>([]);
  const [subs, setSubs] = useState<AiEventSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ss, cs, list] = await Promise.all([
        getAiSessions(),
        getAiChannels(),
        getAiEventSubscriptions(),
      ]);
      setSessions(ss);
      setChannels(cs.filter((c) => c.enabled));
      setSubs(list);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setEvents([]);
    setTargetType('session');
    setSessionId('');
    setChannelId('');
    void load();
  }, [open, load]);

  const sessionName = useMemo(() => {
    const map = new Map(sessions.map((s) => [s.id, s.title]));
    return (id: string) => map.get(id) ?? id;
  }, [sessions]);

  const channelName = useMemo(() => {
    const map = new Map(channels.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? id;
  }, [channels]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === channelId) ?? null,
    [channels, channelId],
  );

  const canSave = events.length > 0 && (targetType === 'session' ? sessionId : channelId) !== '';

  const handleCreate = async () => {
    if (!canSave) return;
    setCreating(true);
    try {
      await createAiEventSubscription({
        events,
        targetType,
        targetId: targetType === 'session' ? sessionId : channelId,
      });
      await load();
      setEvents([]);
      setSessionId('');
      setChannelId('');
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (sub: AiEventSubscription) => {
    const target = sub.targetType === 'session' ? sessionName(sub.targetId) : channelName(sub.targetId);
    const { confirmed } = await confirm(t('ai.eventDeleteConfirm', { target }));
    if (!confirmed) return;
    try {
      await deleteAiEventSubscription(sub.id);
      await load();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    }
  };

  const eventLabel = (id: string) => {
    const opt = EVENT_OPTIONS.find((o) => o.id === id);
    return opt ? t(opt.titleKey) : id;
  };

  return (
    <>
      <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <Modal.Container placement="center" size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('ai.eventSub')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {loading ? (
                <div className="flex justify-center py-10"><Spinner size="sm" /></div>
              ) : (
                <div className="space-y-5">
                  {}
                  <CheckboxGroup
                    name="events"
                    value={events}
                    onChange={(vals) => setEvents([...vals])}
                  >
                    <Description className="mb-2">{t('ai.eventSelectDesc')}</Description>
                    <div className="grid grid-cols-2 gap-2">
                      {EVENT_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <Checkbox key={opt.id} value={opt.id} variant="secondary">
                            <Checkbox.Content
                              className={clsx(
                                'group relative flex w-full flex-row items-start justify-start gap-4 rounded-2xl bg-default px-5 py-4 transition-all',
                                'data-[selected=true]:bg-accent/10',
                              )}
                            >
                              <Checkbox.Control className="absolute end-4 top-3 size-5 rounded-full before:rounded-full">
                                <Checkbox.Indicator />
                              </Checkbox.Control>
                              <Icon className="size-5 text-accent-soft-foreground" />
                              <div className="flex flex-col gap-1">
                                <span>{t(opt.titleKey)}</span>
                                <Description>{t(opt.descKey)}</Description>
                              </div>
                            </Checkbox.Content>
                          </Checkbox>
                        );
                      })}
                    </div>
                  </CheckboxGroup>

                  {}
                  <div>
                    <Label className="mb-2 block text-sm">{t('ai.eventTarget')}</Label>

                    <Tabs className="w-full max-w-md">
                      <Tabs.ListContainer>
                        <Tabs.List aria-label="channel">
                          <Tabs.Tab id="channel" onPress={() => setTargetType('session')}>
                            {t('ai.eventTargetChannel')}
                            <Tabs.Indicator />
                          </Tabs.Tab>
                          <Tabs.Tab id="session" onPress={() => setTargetType('channel')}>
                            {t('ai.eventTargetSession')}
                            <Tabs.Indicator />
                          </Tabs.Tab>
                        </Tabs.List>
                      </Tabs.ListContainer>
                    </Tabs>
                    <div className='flex space-x-2 pt-3 w-full'>
                      {targetType === 'session' ? (
                        <Select
                          selectedKey={sessionId || undefined}
                          onSelectionChange={(key) => { if (key) setSessionId(String(key)); }}
                          variant="secondary"
                          className="w-full"
                          placeholder={t('ai.eventSessionPlaceholder')}
                        >
                          <Select.Trigger className="w-full">
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox items={sessions}>
                              {(item) => (
                                <ListBox.Item key={item.id} id={item.id} textValue={item.title}>
                                  <span className="truncate">{item.title || t('ai.untitled')}</span>
                                </ListBox.Item>
                              )}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      ) : (
                        <Select
                          selectedKey={sessionId || undefined}
                          onSelectionChange={(key) => { if (key) setChannelId(String(key)); }}
                          variant="secondary"
                          className="w-full"
                          placeholder={t('ai.eventChannelPlaceholder')}
                        >
                          <Select.Trigger className="w-full">
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox items={channels}>
                              {(item) => (
                                <ListBox.Item key={item.id} id={item.id}>
                                  <div className='flex space-x-2'>
                                    <img
                                      src={CHANNEL_ICONS[item.channelType]}
                                      alt=""
                                      className="size-5 shrink-0 rounded-full object-contain"
                                    />
                                    <span className="truncate">{item.name} ({TIER_LABELS[item.defaultTier]})</span>
                                  </div>
                                </ListBox.Item>
                              )}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      )}
                      <Button
                        variant="primary"
                        isDisabled={!canSave || creating}
                        onPress={() => void handleCreate()}
                        className="rounded-[16px]"
                      >
                        {creating ? <Spinner size="sm" /> : null}
                        {t('ai.eventCreate')}
                      </Button>
                    </div>

                  </div>

                  {}
                  <div>
                    <Label className="mb-2 block text-sm">{t('ai.eventList')}</Label>
                    {subs.length === 0 ? (
                      <div className="py-4 text-center text-xs text-default-400">{t('ai.eventEmpty')}</div>
                    ) : (
                      <div className="max-h-56 space-y-1.5 overflow-y-auto">
                        {subs.map((sub) => (
                          <Card key={sub.id} className='bg-default'>
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {sub.events.map((e) => (
                                    <p key={e} className='text-foreground'>{eventLabel(e)}</p>
                                  ))}
                                  <Chip size="sm" variant="primary" color='accent'>
                                    {sub.targetType === 'session'
                                      ? sessionName(sub.targetId)
                                      : channelName(sub.targetId)}
                                  </Chip>
                                </div>
                                <div className="mt-0.5 text-[11px] text-default-500">
                                  {new Date(sub.createdAt).toLocaleString()}
                                </div>
                              </div>
                              <Button
                                isIconOnly
                                variant="ghost"
                                className="text-danger hover:bg-background/30"
                                aria-label={t('common.delete')}
                                onPress={() => void handleDelete(sub)}
                              >
                                <TrashBin className="size-4" />
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>{t('common.close')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {DialogComponent}
    </>
  );
}
