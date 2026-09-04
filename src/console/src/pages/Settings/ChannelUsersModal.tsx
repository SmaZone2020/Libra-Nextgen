'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListBox, Modal, Select, Spinner } from '@heroui/react';
import { TrashBin } from '@gravity-ui/icons';
import {
  getAiChannelUsers,
  setAiChannelUserTier,
  unbindAiChannelUser,
  type AiChannel,
  type AiChannelUser,
} from '../../api/aiChannels';
import { useDialog } from '../../hooks/useDialog';
import { TIER_LABELS } from './ChannelsTab';

export default function ChannelUsersModal({
  channel,
  onClose,
  onChanged,
}: {
  channel: AiChannel;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { confirm, alert, DialogComponent } = useDialog();
  const [users, setUsers] = useState<AiChannelUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await getAiChannelUsers(channel.id));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [channel.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleTier = async (u: AiChannelUser, tier: string) => {
    const value = tier === 'default' ? null : Number(tier);
    try {
      await setAiChannelUserTier(u.id, value);
      await load();
      onChanged();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUnbind = async (u: AiChannelUser) => {
    const { confirmed } = await confirm(t('channels.unbindConfirm', { name: u.externalName }));
    if (!confirmed) return;
    try {
      await unbindAiChannelUser(u.id);
      await load();
      onChanged();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
    <Modal.Backdrop isOpen onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('channels.boundUsers')} · {channel.name}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {loading ? (
              <div className="flex justify-center py-8"><Spinner size="sm" /></div>
            ) : users.length === 0 ? (
              <div className="py-8 text-center text-sm text-default-400">{t('channels.noUsers')}</div>
            ) : (
              <div className="space-y-2">
                {users.map((u) => (
                  <div key={u.id} className="flex flex-col gap-2 rounded-2xl border border-default-200 p-3 sm:flex-row sm:items-center dark:border-default-800">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {u.externalName}
                        <span className="ml-2 text-xs text-default-500">{u.boundUserName}</span>
                      </span>
                      <span className="truncate font-mono text-[11px] text-default-500">{u.externalId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        selectedKey={u.tierOverride === null ? 'default' : String(u.tierOverride)}
                        onSelectionChange={(key) => { if (key) void handleTier(u, String(key)); }}
                        variant="secondary"
                        className="w-36"
                      >
                        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                        <Select.Popover>
                          <ListBox items={[
                            { id: 'default', label: `跟随频道` },
                            ...TIER_LABELS.map((label, i) => ({ id: String(i), label })),
                          ]}>
                            {(item) => (
                              <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            )}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button size="sm" variant="ghost" className="text-danger" onPress={() => void handleUnbind(u)}>
                        <TrashBin className="size-4" />
                        {t('channels.unbind')}
                      </Button>
                    </div>
                  </div>
                ))}
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
