'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  Switch,
} from '@heroui/react';
import { CircleCheck, QrCode } from '@gravity-ui/icons';
import {
  createAiChannel,
  getAiChannelQrStatus,
  getAiChannelWechatQrCode,
  setAiChannelWechatToken,
  testAiChannel,
  updateAiChannel,
  type AiChannel,
  type AiChannelInput,
  type AiChannelType,
  type AiChannelQrStatus,
} from '../../api/aiChannels';
import { getAiProviders, type AiProvider } from '../../api/ai';

const CHANNEL_TYPES: { id: AiChannelType; label: string }[] = [
  { id: 'telegram', label: 'Telegram' },
  { id: 'lark', label: '飞书 Lark' },
  { id: 'wechat-claw', label: '微信 Claw（iLink）' },
];

const TIERS = [
  { id: 0, label: 'Cognitio · 审理（只读）' },
  { id: 1, label: 'Arbitrium · 裁量（常规）' },
  { id: 2, label: 'Imperium · 治权（高危需审批）' },
  { id: 3, label: 'Dictatura · 独裁（全权）' },
];

const emptyForm = (): AiChannelInput => ({
  name: '',
  channelType: 'telegram',
  enabled: true,
  config: {},
  defaultTier: 0,
  requireBind: true,
  defaultProviderId: '',
  defaultModel: '',
  showToolCalls: true,
  streamOutput: false,
  allowInGroups: false,
});

export interface ChannelFormModalProps {
  open: boolean;
  /** 编辑中的频道；null 表示新建。 */
  editing: AiChannel | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ChannelFormModal({ open, editing, onClose, onSaved }: ChannelFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<AiChannelInput>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        channelType: editing.channelType,
        enabled: editing.enabled,
        config: { ...editing.config },
        defaultTier: editing.defaultTier,
        requireBind: editing.requireBind,
        defaultProviderId: editing.defaultProviderId,
        defaultModel: editing.defaultModel,
        showToolCalls: editing.showToolCalls,
        streamOutput: editing.streamOutput,
        allowInGroups: editing.allowInGroups,
      });
    } else {
      setForm(emptyForm());
    }
    setTestResult(null);
    void getAiProviders().then(setProviders).catch(() => undefined);
  }, [open, editing]);

  const patch = (p: Partial<AiChannelInput>) => setForm((f) => ({ ...f, ...p }));
  const patchConfig = (key: string, value: string) =>
    setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.models.length > 0),
    [providers],
  );
  const activeProvider = useMemo(
    () => enabledProviders.find((p) => p.id === form.defaultProviderId) ?? enabledProviders[0] ?? null,
    [enabledProviders, form.defaultProviderId],
  );
  const activeModels = useMemo(() => activeProvider?.models ?? [], [activeProvider]);

  // 切换供应商时重置模型选择。
  useEffect(() => {
    if (form.defaultProviderId !== activeProvider?.id) {
      patch({ defaultProviderId: activeProvider?.id ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider?.id]);

  const handleTypeChange = (type: string) => {
    setForm((f) => ({ ...f, channelType: type as AiChannelType, config: {} }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAiChannel(editing?.id ?? '', { ...form });
      setTestResult(res.ok ? { ok: true } : { ok: false, message: res.error ?? 'unknown error' });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await updateAiChannel(editing.id, form);
      } else {
        await createAiChannel(form);
      }
      onClose();
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const cfg = form.config;
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              {editing ? t('channels.edit') : t('channels.add')}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-sm">{t('channels.name')}</Label>
                <Input
                  value={form.name}
                  variant="secondary"
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="红队微信 / TG 指挥频道…"
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm">{t('channels.type')}</Label>
                <Select
                  selectedKey={form.channelType}
                  onSelectionChange={(key) => { if (key) handleTypeChange(String(key)); }}
                  variant="secondary"
                >
                  <Select.Trigger className="w-full">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox items={CHANNEL_TYPES}>
                      {(item) => (
                        <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                          {item.label}
                        </ListBox.Item>
                      )}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              {form.channelType === 'telegram' && (
                <div className="md:col-span-2">
                  <Label className="mb-1.5 block text-sm">{t('channels.tgToken')}</Label>
                  <Input
                    type="password"
                    value={cfg.botToken ?? ''}
                    onChange={(e) => patchConfig('botToken', e.target.value)}
                    placeholder={editing ? t('channels.keepSecret') : '123456:ABC-DEF…'}
                    variant="secondary"
                  />
                  <p className="mt-1 text-xs text-default-500">{t('channels.tgTokenHint')}</p>
                </div>
              )}

              {form.channelType === 'lark' && (
                <>
                  <div className="md:col-span-2">
                    <Label className="mb-1.5 block text-sm">{t('channels.larkTransport')}</Label>
                    <Select
                      selectedKey={cfg.transport ?? 'websocket'}
                      onSelectionChange={(key) => { if (key) patchConfig('transport', String(key)); }}
                      variant="secondary"
                    >
                      <Select.Trigger className="w-full">
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox items={[
                          { id: 'websocket', label: t('channels.larkWs') },
                          { id: 'webhook', label: t('channels.larkWebhook') },
                        ]}>
                          {(item) => (
                            <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                              {item.label}
                            </ListBox.Item>
                          )}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <p className="mt-1 text-xs text-default-500">{t('channels.larkTransportHint')}</p>
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-sm">App ID</Label>
                    <Input
                      value={cfg.appId ?? ''}
                      onChange={(e) => patchConfig('appId', e.target.value)}
                      placeholder="cli_xxx"
                      variant="secondary"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-sm">App Secret</Label>
                    <Input
                      type="password"
                      value={cfg.appSecret ?? ''}
                      onChange={(e) => patchConfig('appSecret', e.target.value)}
                      placeholder={editing ? t('channels.keepSecret') : ''}
                      variant="secondary"
                    />
                  </div>
                  {cfg.transport === 'webhook' && (
                    <>
                      <div>
                        <Label className="mb-1.5 block text-sm">Verification Token</Label>
                        <Input
                          value={cfg.verificationToken ?? ''}
                          onChange={(e) => patchConfig('verificationToken', e.target.value)}
                          variant="secondary"
                        />
                      </div>
                      <div>
                        <Label className="mb-1.5 block text-sm">Encrypt Key</Label>
                        <Input
                          type="password"
                          value={cfg.encryptKey ?? ''}
                          onChange={(e) => patchConfig('encryptKey', e.target.value)}
                          placeholder={editing ? t('channels.keepSecret') : ''}
                          variant="secondary"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {form.channelType === 'wechat-claw' && (
                <>
                  <div className="md:col-span-2">
                    <Label className="mb-1.5 block text-sm">{t('channels.clawToken')}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        className="flex-1"
                        value={cfg.botToken ?? ''}
                        onChange={(e) => patchConfig('botToken', e.target.value)}
                        placeholder={editing ? t('channels.keepSecret') : ''}
                        variant="secondary"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        className="shrink-0"
                        onPress={() => setAuthOpen(true)}
                      >
                        <QrCode className="size-4" />
                        {t('channels.clawAuthorize')}
                      </Button>
                    </div>
                  </div>
                  <WechatAuthModal
                    channel={editing}
                    open={authOpen}
                    onClose={() => setAuthOpen(false)}
                    onTokenSet={(token) => {
                      patchConfig('botToken', token);
                      setAuthOpen(false);
                    }}
                  />
                </>
              )}

              <div>
                <Label className="mb-1.5 block text-sm">{t('channels.provider')}</Label>
                <Select
                  selectedKey={activeProvider?.id ?? ''}
                  onSelectionChange={(key) => {
                    if (!key) return;
                    const p = enabledProviders.find((x) => x.id === key);
                    patch({ defaultProviderId: String(key), defaultModel: p?.defaultModel || p?.models[0] || '' });
                  }}
                  variant="secondary"
                >
                  <Select.Trigger className="w-full">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox items={enabledProviders}>
                      {(item) => (
                        <ListBox.Item key={item.id} id={item.id} textValue={item.name}>
                          {item.name}
                        </ListBox.Item>
                      )}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-sm">{t('channels.model')}</Label>
                <Select
                  selectedKey={form.defaultModel || activeModels[0] || ''}
                  onSelectionChange={(key) => { if (key) patch({ defaultModel: String(key) }); }}
                  variant="secondary"
                  isDisabled={activeModels.length === 0}
                >
                  <Select.Trigger className="w-full">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox items={activeModels.map((m) => ({ id: m, label: m }))}>
                      {(item) => (
                        <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                          {item.label}
                        </ListBox.Item>
                      )}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block text-sm">{t('channels.defaultTier')}</Label>
                <Select
                  selectedKey={String(form.defaultTier)}
                  onSelectionChange={(key) => { if (key) patch({ defaultTier: Number(key) }); }}
                  variant="secondary"
                >
                  <Select.Trigger className="w-full">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox items={TIERS}>
                      {(item) => (
                        <ListBox.Item key={String(item.id)} id={String(item.id)} textValue={item.label}>
                          {item.label}
                        </ListBox.Item>
                      )}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <Switch isSelected={form.requireBind} onChange={(v) => patch({ requireBind: v })}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  <Label className="ml-2 text-sm">{t('channels.requireBind')}</Label>
                </Switch>
                <Switch isSelected={form.showToolCalls} onChange={(v) => patch({ showToolCalls: v })}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  <Label className="ml-2 text-sm">{t('channels.showToolCalls')}</Label>
                </Switch>
                {form.channelType !== 'wechat-claw' && (
                  <Switch isSelected={form.streamOutput} onChange={(v) => patch({ streamOutput: v })}>
                    <Switch.Control><Switch.Thumb /></Switch.Control>
                    <Label className="ml-2 text-sm">{t('channels.streamOutput')}</Label>
                  </Switch>
                )}
                {form.channelType === 'telegram' && (
                  <Switch isSelected={form.allowInGroups} onChange={(v) => patch({ allowInGroups: v })}>
                    <Switch.Control><Switch.Thumb /></Switch.Control>
                    <Label className="ml-2 text-sm">{t('channels.allowInGroups')}</Label>
                  </Switch>
                )}
                {form.channelType === 'wechat-claw' && (
                  <p className="w-full text-xs text-default-500">{t('channels.clawNoStream')}</p>
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" isDisabled={saving} onPress={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" isDisabled={saving || !form.name.trim()} onPress={() => void handleSave()}>
              {saving ? <Spinner size="sm" /> : null}
              {t('common.save')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** 微信 iLink 扫码授权弹窗：申请二维码 → 展示 → 前端轮询状态 → confirmed 自动回填 bot_token。
 * 支持新建（channel 为 null）与编辑（channel 已保存）两种形态：新建时先扫码拿 token，
 * 随频道一起保存；编辑时确认后直接写入频道配置。 */
function WechatAuthModal({
  channel,
  open,
  onClose,
  onTokenSet,
}: {
  channel: AiChannel | null;
  open: boolean;
  onClose: () => void;
  onTokenSet: (token: string) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'scanning' | 'done' | 'error'>('idle');
  const [imageUrl, setImageUrl] = useState('');
  const [qrcode, setQrcode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  // 打开时申请二维码（登录接口匿名，不依赖频道是否已保存）；关闭时停止轮询并复位。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setError(null);
    void getAiChannelWechatQrCode()
      .then((r) => {
        if (cancelled) return;
        setQrcode(r.qrcode);
        setImageUrl(r.imageUrl);
        setPhase('scanning');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 扫描阶段：前端轮询扫码状态；confirmed → 写入 token（编辑态直接存频道，新建态回填表单待保存）。
  useEffect(() => {
    if (!open || phase !== 'scanning' || qrcode.length === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r: AiChannelQrStatus = await getAiChannelQrStatus(qrcode);
        if (stopped) return;
        if (r.status === 'confirmed' && r.botToken) {
          setPolling(false);
          setPhase('done');
          if (channel) await setAiChannelWechatToken(channel.id, r.botToken);
          if (!stopped) onTokenSet(r.botToken);
          return;
        }
        if (r.status === 'expired') {
          setPolling(false);
          setError(t('channels.clawQrExpired'));
          setPhase('error');
          return;
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (stopped) return;
        setPolling(false);
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    };
    setPolling(true);
    void poll();
    return () => {
      stopped = true;
      setPolling(false);
      if (timer) clearTimeout(timer);
    };
  }, [open, phase, qrcode, channel, t, onTokenSet]);

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="sm">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('channels.clawAuthorize')} · {channel?.name ?? ''}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col items-center gap-3 py-2">
              {phase === 'loading' && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Spinner size="lg" />
                  <p className="text-sm text-default-500">{t('channels.clawQrLoading')}</p>
                </div>
              )}
              {phase === 'scanning' && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt={t('channels.clawAuthorize')}
                    className="size-56 rounded-2xl border border-default-200 object-contain p-2 dark:border-default-800"
                  />
                  <p className="flex items-center gap-2 text-sm text-default-500">
                    {polling && <Spinner size="sm" />}
                    {t('channels.clawQrHint')}
                  </p>
                </>
              )}
              {phase === 'done' && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <CircleCheck className="size-10 text-success" />
                  <p className="text-sm font-medium">{t('channels.clawQrSuccess')}</p>
                </div>
              )}
              {phase === 'error' && (
                <div className="flex w-full flex-col items-center gap-3 py-4 text-center">
                  <p className="text-sm text-danger">{error}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      setPhase('loading');
                      setError(null);
                      setQrcode('');
                      void getAiChannelWechatQrCode()
                        .then((r) => {
                          setQrcode(r.qrcode);
                          setImageUrl(r.imageUrl);
                          setPhase('scanning');
                        })
                        .catch((e) => {
                          setError(e instanceof Error ? e.message : String(e));
                          setPhase('error');
                        });
                    }}
                  >
                    {t('common.retry')}
                  </Button>
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>
              {phase === 'done' ? t('common.close') : t('common.cancel')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
