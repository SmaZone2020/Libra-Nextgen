'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Input,
  Label,
  ListBox,
  Select,
  Spinner,
  Switch,
  TextArea,
  Tooltip,
} from '@heroui/react';
import { TrashBin, Pencil, CircleCheck, Plus, ArrowsRotateLeft } from '@gravity-ui/icons';
import {
  createAiProvider,
  deleteAiProvider,
  getAiMcp,
  getAiProviders,
  setAiMcp,
  testAiProvider,
  updateAiProvider,
  type AiMcpInfo,
  type AiProvider,
  type AiProviderInput,
  type AiToolDescriptor,
} from '../../api/ai';

const PROVIDER_TYPES = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'moonshot', label: 'Moonshot (Kimi)' },
  { id: 'qwen', label: '通义千问 (DashScope)' },
  { id: 'openai-compatible', label: 'OpenAI 兼容自定义' },
] as const;

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
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

export default function AiTab() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcp, setMcp] = useState<AiMcpInfo | null>(null);

  const [form, setForm] = useState<AiProviderInput>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; models?: string[] } | null>(null);
  const [modelsText, setModelsText] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, mc] = await Promise.all([getAiProviders(), getAiMcp()]);
      setProviders(ps);
      setMcp(mc);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  const startEdit = (p: AiProvider) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      providerType: p.providerType,
      baseUrl: p.baseUrl,
      apiKey: '',
      models: p.models,
      defaultModel: p.defaultModel,
      enabled: p.enabled,
      requireApproval: p.requireApproval,
    });
    setModelsText(p.models.join('\n'));
    setTestResult(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm());
    setModelsText('');
    setTestResult(null);
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
      if (editingId) {
        await updateAiProvider(editingId, input);
      } else {
        await createAiProvider(input);
      }
      resetForm();
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: AiProvider) => {
    if (!window.confirm(t('settings.aiDeleteConfirm', { name: p.name }))) return;
    try {
      await deleteAiProvider(p.id);
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleMcpToggle = async (toolsEnabled: boolean) => {
    if (!mcp) return;
    const next = { ...mcp, toolsEnabled };
    setMcp(next);
    try {
      await setAiMcp(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const toolNames = useMemo(
    () => new Set((mcp?.tools ?? []).map((tool) => tool.name)),
    [mcp],
  );

  const handleToolWhitelist = async (tool: AiToolDescriptor, on: boolean) => {
    if (!mcp) return;
    const allowed = new Set(mcp.allowedTools.length ? mcp.allowedTools : [...toolNames]);
    if (on) allowed.add(tool.name);
    else allowed.delete(tool.name);
    const next = { ...mcp, allowedTools: [...allowed] };
    setMcp(next);
    try {
      await setAiMcp(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && providers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 供应商列表 ── */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('settings.aiProviders')}</h2>
            <p className="text-sm text-default-500">{t('settings.aiProvidersDesc')}</p>
          </div>
          <Tooltip delay={0}>
            <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.refresh')} onPress={() => void reload()}>
              <ArrowsRotateLeft className="size-4" />
            </Button>
            <Tooltip.Content>{t('common.refresh')}</Tooltip.Content>
          </Tooltip>
        </div>

        {providers.length === 0 ? (
          <div className="py-10 text-center text-sm text-default-400">
            {t('settings.aiNoProviders')}
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-3 rounded-2xl border border-default-200 p-4 sm:flex-row sm:items-center dark:border-default-800"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Chip size="sm" color={p.enabled ? 'success' : 'default'} variant="soft">
                      {p.enabled ? t('mcp.enabled') : t('mcp.disabled')}
                    </Chip>
                    <Chip size="sm" variant="tertiary">{p.providerType}</Chip>
                  </div>
                  <span className="truncate font-mono text-xs text-default-500">{p.baseUrl}</span>
                  <span className="text-xs text-default-500">
                    {p.defaultModel || (p.models[0] ?? '')} · {p.models.length} {t('settings.aiModels')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="tertiary" onPress={() => startEdit(p)}>
                    <Pencil className="size-4" />
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onPress={() => void handleDelete(p)}>
                    <TrashBin className="size-4" />
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!editingId && (
          <Button className="mt-4" variant="tertiary" onPress={resetForm}>
            <Plus className="size-4" />
            {t('settings.aiAddProvider')}
          </Button>
        )}
      </Card>

      {/* ── 供应商编辑表单 ── */}
      {(editingId || form.name || providers.length === 0) && (
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">
            {editingId ? t('settings.aiEditProvider') : t('settings.aiAddProvider')}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-sm">{t('settings.aiName')}</Label>
              <Input
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="DeepSeek / OpenAI / 自建网关…"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t('settings.aiType')}</Label>
              <Select
                selectedKey={form.providerType}
                onSelectionChange={(key) => {
                  if (key) handleTypeChange(String(key));
                }}
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
            <div className="md:col-span-2">
              <Label className="mb-1.5 block text-sm">{t('settings.aiBaseUrl')}</Label>
              <Input
                value={form.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="mb-1.5 block text-sm">{t('settings.aiApiKey')}</Label>
              <Input
                type="password"
                value={form.apiKey ?? ''}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder={editingId ? t('settings.aiApiKeyPlaceholder') : 'sk-…'}
              />
              <div className="mt-1.5 flex items-center gap-2">
                <Button size="sm" variant="tertiary" isDisabled={testing} onPress={() => void handleTest()}>
                  {testing ? <Spinner size="sm" /> : <CircleCheck className="size-4" />}
                  {t('settings.aiTest')}
                </Button>
                {testResult && (
                  <span className={`text-xs ${testResult.ok ? 'text-success' : 'text-danger'}`}>
                    {testResult.ok
                      ? `${t('settings.aiTestOk')} (${testResult.models?.length ?? 0} models)`
                      : testResult.message}
                  </span>
                )}
              </div>
            </div>
            <div className="md:col-span-2">
              <Label className="mb-1.5 block text-sm">{t('settings.aiModels')}</Label>
              <TextArea
                value={modelsText}
                onChange={(e) => setModelsText(e.target.value)}
                placeholder={'deepseek-chat\ndeepseek-reasoner\n…（每行一个模型 ID）'}
                rows={4}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t('settings.aiDefaultModel')}</Label>
              <Input
                value={form.defaultModel}
                onChange={(e) => patch({ defaultModel: e.target.value })}
                placeholder="deepseek-chat"
              />
            </div>
            <div className="flex flex-col justify-end gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{t('settings.aiEnabled')}</span>
                <Switch isSelected={form.enabled} onChange={(v) => patch({ enabled: v })}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Tooltip delay={0}>
                  <span className="text-sm">{t('settings.aiRequireApproval')}</span>
                  <Tooltip.Content>{t('settings.aiRequireApprovalDesc')}</Tooltip.Content>
                </Tooltip>
                <Switch isSelected={form.requireApproval} onChange={(v) => patch({ requireApproval: v })}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch>
              </div>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2">
            <Button variant="primary" isDisabled={saving || !form.name.trim()} onPress={() => void handleSave()}>
              {saving ? <Spinner size="sm" /> : null}
              {t('common.save')}
            </Button>
            {editingId && (
              <Button variant="ghost" onPress={resetForm}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* ── MCP 工具连接 ── */}
      <Card className="p-6">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('settings.aiMcpTitle')}</h2>
            <p className="text-sm text-default-500">{t('settings.aiMcpDesc')}</p>
          </div>
          <Switch isSelected={mcp?.toolsEnabled ?? false} onChange={(v) => void handleMcpToggle(v)}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
            <Switch.Content>
              <Label className="text-sm">
                {mcp?.toolsEnabled ? t('mcp.enabled') : t('mcp.disabled')}
              </Label>
            </Switch.Content>
          </Switch>
        </div>

        {mcp?.toolsEnabled && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-default-500">
              {t('settings.aiMcpWhitelistHint')}（{mcp.tools.length} tools）
            </p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {mcp.tools.map((tool) => {
                const whitelistMode = mcp.allowedTools.length > 0;
                const checked = whitelistMode ? mcp.allowedTools.includes(tool.name) : true;
                return (
                  <div key={tool.name} className="flex items-start gap-2 rounded-xl border border-default-200 p-3 dark:border-default-800">
                    <Checkbox
                      isSelected={checked}
                      onChange={(v) => void handleToolWhitelist(tool, v)}
                    >
                      <Checkbox.Indicator />
                      <div className="flex min-w-0 flex-col">
                        <span className="font-mono text-sm">{tool.name}</span>
                        <span className="line-clamp-2 text-xs text-default-500">{tool.description}</span>
                      </div>
                    </Checkbox>
                  </div>
                );
              })}
              {mcp.tools.length === 0 && (
                <div className="col-span-full py-6 text-center text-sm text-default-400">
                  {t('mcp.noTools')}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
