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
import { CircleCheck } from '@gravity-ui/icons';
import {
  createAiChannel,
  testAiChannel,
  updateAiChannel,
  type AiChannel,
  type AiChannelInput,
  type AiChannelType,
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
                    <Label className="mb-1.5 block text-sm">{t('channels.clawBaseUrl')}</Label>
                    <Input
                      value={cfg.baseUrl ?? ''}
                      onChange={(e) => patchConfig('baseUrl', e.target.value)}
                      placeholder="https://ilinkai.weixin.qq.com"
                      variant="secondary"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="mb-1.5 block text-sm">{t('channels.clawToken')}</Label>
                    <Input
                      type="password"
                      value={cfg.botToken ?? ''}
                      onChange={(e) => patchConfig('botToken', e.target.value)}
                      placeholder={editing ? t('channels.keepSecret') : ''}
                      variant="secondary"
                    />
                  </div>
                </>
              )}

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
                <Switch isSelected={form.streamOutput} onChange={(v) => patch({ streamOutput: v })}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  <Label className="ml-2 text-sm">{t('channels.streamOutput')}</Label>
                </Switch>
              </div>

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

              <div className="md:col-span-2">
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="tertiary" isDisabled={testing} onPress={() => void handleTest()}>
                    {testing ? <Spinner size="sm" /> : <CircleCheck className="size-4" />}
                    {t('channels.test')}
                  </Button>
                  {testResult && (
                    <span className={`w-full text-xs ${testResult.ok ? 'text-success' : 'text-danger'}`}>
                      {testResult.ok ? t('channels.testOk') : testResult.message}
                    </span>
                  )}
                </div>
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
