'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  TextArea,
} from '@heroui/react';
import { CircleCheck } from '@gravity-ui/icons';
import {
  createAiProvider,
  testAiProvider,
  updateAiProvider,
  type AiProvider,
  type AiProviderInput,
} from '../../api/ai';

const PROVIDER_TYPES = [
  { id: 'openai-chat', label: '[OI] Chat' },
  { id: 'openai-response', label: '[OI] Response' },
  { id: 'anthropic', label: 'Claude (Anthropic)' },
  { id: 'openai-compatible', label: '[OI] 兼容自定义' },
] as const;

const DEFAULT_BASE_URLS: Record<string, string> = {
  'openai-chat': 'https://api.openai.com/v1',
  'openai-response': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  'openai-compatible': '',
};

const emptyForm = (): AiProviderInput => ({
  name: '',
  providerType: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  models: [],
  defaultModel: '',
  enabled: true,
  requireApproval: true,
});

export interface ProviderFormModalProps {
  open: boolean;
  /** 编辑中的供应商；null 表示新建。 */
  editing: AiProvider | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProviderFormModal({ open, editing, onClose, onSaved }: ProviderFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<AiProviderInput>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; models?: string[] } | null>(null);
  const [modelsText, setModelsText] = useState('');

  // 打开/切换编辑目标时初始化表单。
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        providerType: editing.providerType,
        baseUrl: editing.baseUrl,
        apiKey: '',
        models: editing.models,
        defaultModel: editing.defaultModel,
        enabled: editing.enabled,
        requireApproval: editing.requireApproval,
      });
      setModelsText(editing.models.join('\n'));
    } else {
      setForm(emptyForm());
      setModelsText('');
    }
    setTestResult(null);
  }, [open, editing]);

  const patch = (p: Partial<AiProviderInput>) =>
    setForm((f) => ({ ...f, ...p }));

  const handleTypeChange = (type: string) => {
    const baseUrl = DEFAULT_BASE_URLS[type] ?? '';
    setForm((f) => ({
      ...f,
      providerType: type,
      baseUrl: f.baseUrl && f.baseUrl !== DEFAULT_BASE_URLS[f.providerType] ? f.baseUrl : baseUrl,
    }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAiProvider(form);
      if (res.ok && res.models) {
        setTestResult({ ok: true, models: res.models });
        setModelsText(res.models.join('\n'));
      } else {
        setTestResult({ ok: false, message: res.error ?? 'unknown error' });
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const models = modelsText
        .split('\n')
        .map((m) => m.trim())
        .filter(Boolean);
      const input = { ...form, models };
      if (!input.defaultModel && models.length > 0) input.defaultModel = models[0] ?? '';
      if (editing) {
        await updateAiProvider(editing.id, input);
      } else {
        await createAiProvider(input);
      }
      onClose();
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              {editing ? t('settings.aiEditProvider') : t('settings.aiAddProvider')}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-sm">{t('settings.aiName')}</Label>
                <Input
                  value={form.name}
                  variant='secondary'
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="Libra"
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm">{t('settings.aiType')}</Label>
                <Select
                  selectedKey={form.providerType}
                  defaultSelectedKey={PROVIDER_TYPES[0].id}
                  onSelectionChange={(key) => {
                    if (key) handleTypeChange(String(key));
                  }}
                  variant='secondary'
                >
                  <Select.Trigger className="w-full">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox items={PROVIDER_TYPES}>
                      {(item) => (
                        <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                          {item.label}
                        </ListBox.Item>
                      )}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
              <div className="md:col-span-2 flex gap-4">
                <div className="flex-1">
                  <Label className="mb-1.5 block text-sm">{t('settings.aiBaseUrl')}</Label>
                  <Input
                    value={form.baseUrl}
                    onChange={(e) => patch({ baseUrl: e.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                    variant='secondary'
                  />
                </div>
                <div className="flex-1">
                  <Label className="mb-1.5 block text-sm">{t('settings.aiApiKey')}</Label>
                  <Input
                    type="password"
                    value={form.apiKey ?? ''}
                    onChange={(e) => patch({ apiKey: e.target.value })}
                    placeholder={editing ? t('settings.aiApiKeyPlaceholder') : 'sk-…'}
                    variant='secondary'
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="tertiary" isDisabled={testing} onPress={() => void handleTest()}>
                    {testing ? <Spinner size="sm" /> : <CircleCheck className="size-4" />}
                    {t('settings.aiTest')}
                  </Button>
                  {testResult && (
                    <span className={`w-full text-xs ${testResult.ok ? 'text-success' : 'text-danger'}`}>
                      {testResult.ok
                        ? `${t('settings.aiTestOk')} (${testResult.models?.length ?? 0} models)`
                        : testResult.message}
                    </span>
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1.5 block text-sm">
                  {t('settings.aiModels')}
                  {testResult?.ok && testResult.models ? `（${testResult.models.length}）` : ''}
                </Label>
                <TextArea
                  value={modelsText}
                  onChange={(e) => setModelsText(e.target.value)}
                  fullWidth
                  placeholder={'deepseek-chat\ndeepseek-reasoner\n…'}
                  rows={4}
                  variant='secondary'
                />
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
