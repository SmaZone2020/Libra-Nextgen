'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Chip,
  Spinner,
  Switch,
  Tooltip,
} from '@heroui/react';
import { ArrowsRotateLeft, Key, Persons, Pencil, Plus, TrashBin } from '@gravity-ui/icons';
import { deleteAiChannel, getAiChannels, type AiChannel } from '../../api/aiChannels';
import { useDialog } from '../../hooks/useDialog';
import { ChannelFormModal } from './ChannelFormModal';
import BindCodeModal from './BindCodeModal';
import ChannelIcon from './ChannelIcon';
import ChannelUsersModal from './ChannelUsersModal';

export const TIER_LABELS = ['Cognitio', 'Arbitrium', 'Imperium', 'Dictatura'];

export default function ChannelsTab() {
  const { t } = useTranslation();
  const { confirm, alert, DialogComponent } = useDialog();
  const [channels, setChannels] = useState<AiChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AiChannel | null>(null);
  const [bindChannel, setBindChannel] = useState<AiChannel | null>(null);
  const [usersChannel, setUsersChannel] = useState<AiChannel | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setChannels(await getAiChannels());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleToggle = async (ch: AiChannel, enabled: boolean) => {
    const next = { ...ch, enabled };
    setChannels((list) => list.map((c) => (c.id === ch.id ? next : c)));
    try {
      const { updateAiChannel } = await import('../../api/aiChannels');
      await updateAiChannel(ch.id, {
        name: ch.name,
        channelType: ch.channelType,
        enabled,
        config: ch.config,
        defaultTier: ch.defaultTier,
        requireBind: ch.requireBind,
        defaultProviderId: ch.defaultProviderId,
        defaultModel: ch.defaultModel,
        showToolCalls: ch.showToolCalls,
        streamOutput: ch.streamOutput,
        allowInGroups: ch.allowInGroups,
      });
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
      await reload();
    }
  };

  const handleDelete = async (ch: AiChannel) => {
    const { confirmed } = await confirm(t('channels.deleteConfirm', { name: ch.name }));
    if (!confirmed) return;
    try {
      await deleteAiChannel(ch.id);
      await reload();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && channels.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-transparent sm:bg-default-0">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('channels.title')}</h2>
            <p className="text-sm text-default-500">{t('channels.desc')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip delay={0}>
              <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.refresh')} onPress={() => void reload()}>
                <ArrowsRotateLeft className="size-4" />
              </Button>
              <Tooltip.Content>{t('common.refresh')}</Tooltip.Content>
            </Tooltip>
            <Button size="sm" variant="primary" onPress={() => { setEditing(null); setModalOpen(true); }}>
              <Plus className="size-4" />
              {t('channels.add')}
            </Button>
          </div>
        </div>

        {channels.length === 0 ? (
          <div className="py-10 text-center text-sm text-default-400">
            {t('channels.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((ch) => (
              <Card
                key={ch.id}
                className="flex flex-col gap-3 sm:flex-row sm:items-center"
              >
                <ChannelIcon type={ch.channelType} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{ch.name}</span>
                    <Chip size="sm" color={ch.enabled ? 'success' : 'default'} variant="soft">
                      {ch.enabled ? t('mcp.enabled') : t('mcp.disabled')}
                    </Chip>
                    <Chip size="sm" variant="soft">
                      {TIER_LABELS[ch.defaultTier] ?? ch.defaultTier}
                    </Chip>
                  </div>
                  <span className="truncate font-mono text-xs text-default-500">
                    {ch.channelType === 'lark' && (ch.config.transport ?? 'websocket') === 'websocket'
                      ? '长连接（内网免公网）'
                      : ch.channelType === 'lark'
                        ? 'Webhook 回调'
                        : ch.channelType === 'wechat-claw'
                          ? 'iLink 长轮询'
                          : '长轮询'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch isSelected={ch.enabled} onChange={(v) => void handleToggle(ch, v)}>
                    <Switch.Content>
                      <Switch.Control><Switch.Thumb /></Switch.Control>
                    </Switch.Content>
                  </Switch>
                  <Tooltip delay={0}>
                    <Button size="sm" variant="tertiary" isIconOnly aria-label={t('channels.bindCode')}
                      onPress={() => setBindChannel(ch)}>
                      <Key className="size-4" />
                    </Button>
                    <Tooltip.Content>{t('channels.bindCode')}</Tooltip.Content>
                  </Tooltip>
                  <Tooltip delay={0}>
                    <Button size="sm" variant="tertiary" isIconOnly aria-label={t('channels.boundUsers')}
                      onPress={() => setUsersChannel(ch)}>
                      <Persons className="size-4" />
                    </Button>
                    <Tooltip.Content>{t('channels.boundUsers')}</Tooltip.Content>
                  </Tooltip>

                  <Tooltip delay={0}>
                    <Button size="sm" isIconOnly variant="tertiary" onPress={() => { setEditing(ch); setModalOpen(true); }}>
                      <Pencil className="size-4" />
                    </Button>
                    <Tooltip.Content>{t('common.edit')}</Tooltip.Content>
                  </Tooltip>

                  <Tooltip delay={0}>
                    <Button size="sm" isIconOnly variant="ghost" className="text-danger" onPress={() => void handleDelete(ch)}>
                      <TrashBin className="size-4" />
                    </Button>
                    <Tooltip.Content>{t('common.delete')}</Tooltip.Content>
                  </Tooltip>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      <ChannelFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => void reload()}
      />

      {bindChannel && (
        <BindCodeModal
          channel={bindChannel}
          onClose={() => setBindChannel(null)}
        />
      )}

      {usersChannel && (
        <ChannelUsersModal
          channel={usersChannel}
          onClose={() => setUsersChannel(null)}
          onChanged={() => void reload()}
        />
      )}
      {DialogComponent}
    </div>
  );
}
