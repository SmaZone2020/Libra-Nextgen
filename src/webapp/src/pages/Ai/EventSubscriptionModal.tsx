'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Chip,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
} from '@heroui/react';
import { TrashBin } from '@gravity-ui/icons';
import { getAiSessions, type AiSession } from '../../api/ai';
import { getAiChannels, type AiChannel } from '../../api/aiChannels';
import {
  createAiEventSubscription,
  deleteAiEventSubscription,
  getAiEventSubscriptions,
  type AiEventSubscription,
} from '../../api/aiEventSubscriptions';
import { useDialog } from '../../hooks/useDialog';

const EVENT_OPTIONS = [
  { id: 'agent.online', labelKey: 'ai.eventOnline' },
  { id: 'agent.offline', labelKey: 'ai.eventOffline' },
] as const;

/**
 * 事件订阅模态框：选择事件（Agent 上线/下线）+ 送达目标（控制台会话 或 启用的 IM 频道）。
 * 事件触发时由系统视角告诉 Justitia，AI 生成提醒送达目标（服务端 AiEventNotifier 执行）。
 */
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

  const toggleEvent = (id: string, on: boolean) => {
    setEvents((prev) => (on ? [...new Set([...prev, id])] : prev.filter((e) => e !== id)));
  };

  const sessionName = useMemo(() => {
    const map = new Map(sessions.map((s) => [s.id, s.title]));
    return (id: string) => map.get(id) ?? id;
  }, [sessions]);

  const channelName = useMemo(() => {
    const map = new Map(channels.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? id;
  }, [channels]);

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
    return opt ? t(opt.labelKey) : id;
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
                  {/* 事件选择 */}
                  <div>
                    <Label className="mb-2 block text-sm">{t('ai.eventSelect')}</Label>
                    <div className="flex flex-wrap gap-3">
                      {EVENT_OPTIONS.map((opt) => (
                        <Checkbox
                          key={opt.id}
                          isSelected={events.includes(opt.id)}
                          onChange={(v) => toggleEvent(opt.id, v)}
                        >
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span className="ml-1 text-sm">{t(opt.labelKey)}</span>
                        </Checkbox>
                      ))}
                    </div>
                  </div>

                  {/* 送达目标 */}
                  <div>
                    <Label className="mb-2 block text-sm">{t('ai.eventTarget')}</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={targetType === 'session' ? 'primary' : 'ghost'}
                        onPress={() => setTargetType('session')}
                      >
                        {t('ai.eventTargetSession')}
                      </Button>
                      <Button
                        size="sm"
                        variant={targetType === 'channel' ? 'primary' : 'ghost'}
                        onPress={() => setTargetType('channel')}
                      >
                        {t('ai.eventTargetChannel')}
                      </Button>
                    </div>

                    {targetType === 'session' ? (
                      <div className="mt-3">
                        <Label className="mb-1.5 block text-sm">{t('ai.eventSession')}</Label>
                        <Select
                          selectedKey={sessionId || undefined}
                          onSelectionChange={(key) => { if (key) setSessionId(String(key)); }}
                          variant="secondary"
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
                        {sessions.length === 0 && (
                          <p className="mt-1 text-xs text-default-500">{t('ai.eventNoSessions')}</p>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3">
                        <Label className="mb-1.5 block text-sm">{t('ai.eventChannel')}</Label>
                        <Select
                          selectedKey={channelId || undefined}
                          onSelectionChange={(key) => { if (key) setChannelId(String(key)); }}
                          variant="secondary"
                          placeholder={t('ai.eventChannelPlaceholder')}
                        >
                          <Select.Trigger className="w-full">
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox items={channels}>
                              {(item) => (
                                <ListBox.Item key={item.id} id={item.id} textValue={item.name}>
                                  <span className="truncate">{item.name}</span>
                                </ListBox.Item>
                              )}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                        {channels.length === 0 && (
                          <p className="mt-1 text-xs text-default-500">{t('ai.eventNoChannels')}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={!canSave || creating}
                    onPress={() => void handleCreate()}
                  >
                    {creating ? <Spinner size="sm" /> : null}
                    {t('ai.eventCreate')}
                  </Button>

                  {/* 已有订阅 */}
                  <div>
                    <Label className="mb-2 block text-sm">{t('ai.eventList')}</Label>
                    {subs.length === 0 ? (
                      <div className="py-4 text-center text-xs text-default-400">{t('ai.eventEmpty')}</div>
                    ) : (
                      <div className="max-h-56 space-y-1.5 overflow-y-auto">
                        {subs.map((sub) => (
                          <div
                            key={sub.id}
                            className="flex items-center gap-2 rounded-xl border border-default-200 px-3 py-2 dark:border-default-800"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {sub.events.map((e) => (
                                  <Chip key={e} size="sm" variant="soft">{eventLabel(e)}</Chip>
                                ))}
                                <Chip size="sm" variant="tertiary">
                                  {sub.targetType === 'session'
                                    ? t('ai.eventTargetSession')
                                    : t('ai.eventTargetChannel')}
                                  ：{sub.targetType === 'session'
                                    ? sessionName(sub.targetId)
                                    : channelName(sub.targetId)}
                                </Chip>
                              </div>
                              <div className="mt-0.5 text-[11px] text-default-500">
                                {new Date(sub.createdAt).toLocaleString()}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              isIconOnly
                              variant="ghost"
                              className="text-danger"
                              aria-label={t('common.delete')}
                              onPress={() => void handleDelete(sub)}
                            >
                              <TrashBin className="size-4" />
                            </Button>
                          </div>
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
