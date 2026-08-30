'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  Switch,
  Tooltip,
} from '@heroui/react';
import { ArrowsRotateLeft, Copy, Key, Pencil, Persons, Plus, TrashBin } from '@gravity-ui/icons';
import {
  createAiBindCode,
  deleteAiChannel,
  getAiChannelBindCodes,
  getAiChannelUsers,
  getAiChannels,
  revokeAiBindCode,
  setAiChannelUserTier,
  unbindAiChannelUser,
  type AiBindCode,
  type AiBindCodeInfo,
  type AiChannel,
  type AiChannelUser,
} from '../../api/aiChannels';
import { listAccounts } from '../../api/account';
import { useDialog } from '../../hooks/useDialog';
import { ChannelFormModal } from './ChannelFormModal';

const TYPE_ICONS: Record<string, string> = {
  telegram: '/icon/app/tg.png',
  lark: '/icon/app/lark.png',
  'wechat-claw': '/icon/app/wechat.png',
};

const TIER_LABELS = ['Cognitio', 'Arbitrium', 'Imperium', 'Dictatura'];

function ChannelIcon({ type, className }: { type: string; className?: string }) {
  const src = TYPE_ICONS[type];
  if (!src) return null;
  return <img src={src} alt={type} className={`size-10 object-contain rounded-full ${className ?? ''}`} />;
}

export default function ChannelsTab() {
  const { t } = useTranslation();
  const { confirm, alert, DialogComponent } = useDialog();
  const [channels, setChannels] = useState<AiChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AiChannel | null>(null);
  // 绑定码模态框
  const [bindChannel, setBindChannel] = useState<AiChannel | null>(null);
  // 绑定用户模态框
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

/** 生成一次性绑定码：选择控制台账号 → 生成 → 展示（15 分钟有效）；可查看并作废未使用码。 */
function BindCodeModal({ channel, onClose }: { channel: AiChannel; onClose: () => void }) {
  const { t } = useTranslation();
  const { confirm, alert, DialogComponent } = useDialog();
  const [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<AiBindCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<AiBindCodeInfo[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadCodes = useCallback(async () => {
    try {
      setCodes(await getAiChannelBindCodes(channel.id));
    } catch {
      /* ignore */
    }
  }, [channel.id]);

  useEffect(() => {
    void listAccounts()
      .then((list) => {
        setAccounts(list.map((a) => ({ id: a.id, username: a.username })));
        const first = list[0];
        if (first) setUserId(first.id);
      })
      .catch(() => undefined);
    void loadCodes();
  }, [loadCodes]);

  const handleGenerate = async () => {
    if (!userId) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      setResult(await createAiBindCode(channel.id, userId));
      await loadCodes();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (code: AiBindCodeInfo) => {
    const { confirmed } = await confirm(t('channels.revokeCodeConfirm', { tail: code.codeTail }));
    if (!confirmed) return;
    setRevoking(code.id);
    try {
      await revokeAiBindCode(channel.id, code.id);
      await loadCodes();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRevoking(null);
    }
  };

  const handleCopy = () => {
    if (result) void navigator.clipboard?.writeText(result.code).catch(() => undefined);
  };

  const now = Date.now();
  const statusOf = (c: AiBindCodeInfo): { label: string; color: string; revocable: boolean } => {
    if (c.revokedAt) return { label: t('channels.codeRevoked'), color: 'text-default-400', revocable: false };
    if (c.usedAt) return { label: t('channels.codeUsed'), color: 'text-success', revocable: false };
    if (new Date(c.expiresAt).getTime() <= now) return { label: t('channels.codeExpired'), color: 'text-default-400', revocable: false };
    return { label: t('channels.codePending'), color: 'text-warning', revocable: true };
  };

  return (
    <>
    <Modal.Backdrop isOpen onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="sm">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('channels.bindCode')} · {channel.name}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-3">
              {/* 账号选择 + 生成按钮同行：按钮与 Select 底边对齐（不与 Label 对齐） */}
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Label className="mb-1.5 block text-sm">{t('channels.bindForUser')}</Label>
                  <Select
                    selectedKey={userId}
                    onSelectionChange={(key) => { if (key) setUserId(String(key)); }}
                    variant="secondary"
                  >
                    <Select.Trigger className="w-full">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox items={accounts}>
                        {(item) => (
                          <ListBox.Item key={item.id} id={item.id} textValue={item.username}>
                            {item.username}
                          </ListBox.Item>
                        )}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
                <Button size="sm" variant="primary" isDisabled={!userId} className="shrink-0"
                  onPress={() => void handleGenerate()}>
                  {generating ? <Spinner size="sm" /> : null}
                  {t('channels.generate')}
                </Button>
              </div>
              {error && <p className="text-xs text-danger">{error}</p>}
              {result && (
                <div className="rounded-2xl border border-default-200 p-4 dark:border-default-800">
                  <p className="text-xs text-default-500">{t('channels.bindCodeHint')}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 select-all rounded-xl bg-default/10 px-3 py-2 font-mono text-lg tracking-widest">
                      {result.code}
                    </code>
                    <Button isIconOnly size="sm" variant="tertiary" onPress={handleCopy}>
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  {result.bindUrl && (
                    <a
                      href={result.bindUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate text-xs text-primary underline"
                    >
                      {result.bindUrl}
                    </a>
                  )}
                  <p className="mt-2 text-xs text-default-500">
                    {t('channels.expires')} {new Date(result.expiresAt).toLocaleString()}
                  </p>
                </div>
              )}

              {/* 绑定码列表（可作废未使用码） */}
              <div>
                <Label className="mb-1.5 block text-sm">{t('channels.codeList')}</Label>
                {codes.length === 0 ? (
                  <div className="py-4 text-center text-xs text-default-400">{t('channels.noCodes')}</div>
                ) : (
                  <div className="max-h-56 space-y-1.5 overflow-y-auto">
                    {codes.map((c) => {
                      const st = statusOf(c);
                      return (
                        <div
                          key={c.id}
                          className="flex items-center gap-2 rounded-xl border border-default-200 px-3 py-2 dark:border-default-800"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-mono text-xs">
                              ····{c.codeTail}
                              <span className={`ml-2 ${st.color}`}>{st.label}</span>
                            </span>
                            <div className="truncate text-[11px] text-default-500">
                              {c.boundUserName} · {new Date(c.createdAt).toLocaleString()}
                            </div>
                          </div>
                          {st.revocable && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-danger"
                              isDisabled={revoking === c.id}
                              onPress={() => void handleRevoke(c)}
                            >
                              {revoking === c.id ? <Spinner size="sm" /> : t('channels.revoke')}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
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

/** 绑定用户管理：档位覆盖 / 解绑。 */
function ChannelUsersModal({
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
