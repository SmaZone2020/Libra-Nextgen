'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Description, Label, ListBox, Popover } from '@heroui/react';
import { ChevronDown, PaperPlane, Shield } from '@gravity-ui/icons';
import { PromptInput, CellSlider } from '../../vendor/ui-pro';
import type { AiProvider } from '../../api/ai';
import { resolveModelIcon } from './modelIcons';
import { formatModelDisplay, parseModelLabel, titleCaseWords } from './utils';
import { JUSTITIA_TIERS, type JustitiaTierKey } from './justitia';

/** 供应商/厂商/模型图标：有匹配用品牌图标，无匹配用默认 icon2.webp。 */
function BrandIcon({ name, className = 'size-5' }: { name: string; className?: string }) {
  const icon = name ? resolveModelIcon(name) : null;
  if (icon) {
    return (
      <img src={icon} alt="" className={`${className} shrink-0 object-contain`} loading="lazy" />
    );
  }
  return (
    <img
      alt="icon"
      className={`${className} shrink-0 rounded object-cover dark:invert select-none pointer-events-none`}
      loading="lazy"
      src="/images/icon2.webp"
    />
  );
}

/** 0/100 区间 → 最近档位下标（档位点 0/33/66/100）。 */
function nearestTierIndex(v: number): number {
  const pts = [0, 33, 66, 100];
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(v - pts[i]!);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export interface AiComposerProps {
  providers: AiProvider[];
  activeProviderId: string | null;
  activeModel: string;
  isGenerating: boolean;
  canSend: boolean;
  /** Justitia 档位 key（浏览器持久化，随 SSE 请求提交）。 */
  justitiaTier: JustitiaTierKey;
  onTierChange: (tier: JustitiaTierKey) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onSelectProvider: (id: string) => void;
  onSelectModel: (model: string) => void;
}

export function AiComposer({
  providers,
  activeProviderId,
  activeModel,
  isGenerating,
  canSend,
  justitiaTier,
  onTierChange,
  onSend,
  onStop,
  onSelectProvider,
  onSelectModel,
}: AiComposerProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [vendorKey, setVendorKey] = useState<string>('');
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const permission = JUSTITIA_TIERS.find((x) => x.key === justitiaTier)?.index ?? 0;
  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? providers[0];

  // 当前供应商的模型按厂商分组（vendor/model 前缀；无前缀归「全部」）。
  const modelGroups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of activeProvider?.models ?? []) {
      const parsed = parseModelLabel(m);
      if (!parsed.name) continue;
      const vendor = parsed.vendor ?? '';
      const list = map.get(vendor) ?? [];
      list.push(m);
      map.set(vendor, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const la = parseModelLabel(a);
        const lb = parseModelLabel(b);
        if (la.isLatest !== lb.isLatest) return la.isLatest ? -1 : 1;
        return la.name.localeCompare(lb.name);
      });
    }
    return map;
  }, [activeProvider]);

  // 厂商列按 a-z 排序；无厂商（全部模型无 vendor 前缀）时隐藏厂商列（两列布局）。
  const vendors = useMemo(
    () => [...modelGroups.keys()].sort((a, b) => a.localeCompare(b)),
    [modelGroups],
  );
  const showVendorColumn = vendors.length > 0;
  const currentVendor = vendors.includes(vendorKey)
    ? vendorKey
    : (parseModelLabel(activeModel).vendor ?? '');
  const vendorModels = modelGroups.get(currentVendor) ?? [];

  const handleProviderSelect = (id: string) => {
    onSelectProvider(id);
    setVendorKey(''); // 切换供应商后重置厂商过滤。
  };

  const handleModelSelect = (m: string) => {
    onSelectModel(m);
    setModelMenuOpen(false);
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isGenerating) return;
    setValue('');
    onSend(trimmed);
  };

  return (
    <PromptInput
      status={isGenerating ? 'streaming' : 'ready'}
      variant="primary"
      value={value}
      onValueChange={setValue}
      onStop={onStop}
      onSubmit={handleSubmit}
    >
      <PromptInput.Shell>
        <PromptInput.Content>
          <PromptInput.TextArea
            placeholder={t('ai.inputPlaceholder')}
            aria-label={t('ai.inputPlaceholder')}
          />
        </PromptInput.Content>
        <PromptInput.Toolbar>
          <PromptInput.ToolbarStart>
            {/* 供应商 + 模型：单按钮，弹出三列（供应商 | 厂商 | 模型；无厂商时两列） */}
            <Popover isOpen={modelMenuOpen} onOpenChange={setModelMenuOpen}>
              <Popover.Trigger>
                <Button
                  aria-label={t('ai.providerModel')}
                  variant="secondary"
                  isDisabled={isGenerating || !activeProvider}
                  className="h-9 min-w-0 max-w-[220px] shrink-0 gap-1.5 rounded-field border border-default-200 px-3 dark:border-default-800"
                >
                  <BrandIcon name={activeProvider?.name ?? ''} className="size-4" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {activeProvider?.name ?? t('ai.provider')}
                  </span>
                  <span className="shrink-0 text-xs text-muted">/</span>
                  <span className="min-w-0 max-w-[90px] truncate text-sm text-foreground">
                    {activeModel ? formatModelDisplay(activeModel) : t('ai.model')}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted" />
                </Button>
              </Popover.Trigger>
              <Popover.Content className="p-0">
                <Popover.Dialog>
                  <div className="flex max-h-[300px] overflow-hidden">
                    {/* 列 1：供应商 */}
                    <ListBox
                      aria-label={t('ai.provider')}
                      selectionMode="single"
                      selectedKeys={activeProvider ? [activeProvider.id] : []}
                      onSelectionChange={(keys) => {
                        const k = [...keys][0];
                        if (k) handleProviderSelect(String(k));
                      }}
                      className="w-44 shrink-0 overflow-y-auto border-r border-default-200 py-1 dark:border-default-800"
                    >
                      {providers.map((p) => (
                        <ListBox.Item key={p.id} id={p.id} textValue={p.name}>
                          <BrandIcon name={p.name} className="size-5" />
                          <div className="flex min-w-0 flex-col">
                            <Label className="truncate">{p.name}</Label>
                            <Description className="truncate text-[11px]">{p.providerType}</Description>
                          </div>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>

                    {/* 列 2：模型厂商（无厂商时隐藏） */}
                    {vendors.length > 1 && (
                      <ListBox
                        aria-label={t('ai.vendorAll')}
                        selectionMode="single"
                        selectedKeys={currentVendor ? [currentVendor] : []}
                        onSelectionChange={(keys) => {
                          const k = [...keys][0];
                          if (k) setVendorKey(String(k));
                        }}
                        className="max-w-46 shrink-0 overflow-y-auto border-r border-default-200 py-1 dark:border-default-800"
                      >
                        {vendors.map((vendor) => (
                          <ListBox.Item
                            key={vendor || '(all)'}
                            id={vendor || '(all)'}
                            textValue={vendor || t('ai.vendorAll')}
                          >
                            <BrandIcon name={vendor} className="size-4" />
                            <Label className="truncate">{vendor ? titleCaseWords(vendor) : t('ai.vendorAll')}</Label>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    )}

                    {/* 列 3：模型 */}
                    <ListBox
                      aria-label={t('ai.model')}
                      selectionMode="single"
                      selectedKeys={activeModel ? [activeModel] : []}
                      onSelectionChange={(keys) => {
                        const k = [...keys][0];
                        if (k) handleModelSelect(String(k));
                      }}
                      className="max-w-46 flex-1 overflow-y-auto py-1"
                    >
                      {vendorModels.map((m) => {
                        const parsed = parseModelLabel(m);
                        const vendorIcon = parsed.vendor ? resolveModelIcon(parsed.vendor) : null;
                        const modelIcon = vendorIcon ? null : resolveModelIcon(parsed.name);
                        return (
                          <ListBox.Item key={m} id={m} textValue={m}>
                            {modelIcon ? (
                              <img
                                src={modelIcon}
                                alt=""
                                className="size-5 shrink-0 object-contain"
                                loading="lazy"
                              />
                            ) : (
                              <BrandIcon name={parsed.name} className="size-5" />
                            )}
                            <div className="flex min-w-0 flex-col">
                              <Label className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate">{titleCaseWords(parsed.name)}</span>
                                {parsed.isLatest && (
                                  <Chip color="accent" variant="primary" size="sm" className="shrink-0 text-white">
                                    <Chip.Label>{t('ai.latest')}</Chip.Label>
                                  </Chip>
                                )}
                                {parsed.isBatch && (
                                  <Chip color="accent" variant="primary" size="sm" className="shrink-0 text-white">
                                    <Chip.Label>{t('ai.batch')}</Chip.Label>
                                  </Chip>
                                )}
                              </Label>
                              {parsed.isFree && (
                                <Description className="text-[11px] text-success">
                                  {t('ai.free')}
                                </Description>
                              )}
                            </div>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        );
                      })}
                      {vendorModels.length === 0 && (
                        <ListBox.Item id="__empty" textValue={t('ai.noModels')} isDisabled>
                          <Label className="text-muted">{t('ai.noModels')}</Label>
                        </ListBox.Item>
                      )}
                    </ListBox>
                  </div>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          </PromptInput.ToolbarStart>
          <PromptInput.ToolbarEnd>
            <Popover isOpen={tierMenuOpen} onOpenChange={setTierMenuOpen}>
              <Button
                aria-label={t('ai.justitiaTier')}
                variant="ghost"
                isDisabled={isGenerating}
                className="h-9 w-[140px] shrink-0 gap-1"
              >
                <span className="text-sm font-medium">
                  {JUSTITIA_TIERS[permission]?.name}
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-muted" />
              </Button>
              <Popover.Content className="w-64" offset={10}>
                <Popover.Dialog>
                  <Popover.Arrow />
                  <Popover.Heading>{t('ai.adjustJustitia')}</Popover.Heading>
                  <div className="flex flex-col items-center gap-3 pb-1 mt-3">
                    <CellSlider
                      maxValue={100}
                      minValue={0}
                      step={1}
                      variant="secondary"
                      value={permission * (100 / 3)}
                      onChange={(v) => {
                        const val = Array.isArray(v) ? v[0] ?? 0 : v;
                        // 拖动中实时吸附到最近档位（0/33/66/100），松开后由 onChangeEnd 最终确认。
                        const idx = nearestTierIndex(val);
                        const tier = JUSTITIA_TIERS[idx];
                        if (tier) onTierChange(tier.key);
                      }}
                      onChangeEnd={(v) => {
                        const val = Array.isArray(v) ? v[0] ?? 0 : v;
                        const idx = nearestTierIndex(val);
                        const tier = JUSTITIA_TIERS[idx];
                        if (tier) onTierChange(tier.key);
                      }}
                    >
                      <CellSlider.Track>
                        <CellSlider.Fill className="transition-[width] duration-200 ease-out" />
                        <CellSlider.Thumb className="transition-[translate,left] duration-200 ease-out" />
                      </CellSlider.Track>
                    </CellSlider>
                    <div className="flex w-full justify-between px-0.5 text-[11px] text-muted">
                      {JUSTITIA_TIERS.map((tier) => (
                        <span
                          key={tier.key}
                          className={`transition-colors duration-200 ${
                            tier.key === justitiaTier ? 'font-medium text-accent' : ''
                          }`}
                        >
                          {tier.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>

            <PromptInput.Send
              aria-label={isGenerating ? t('ai.stop') : t('ai.send')}
              isDisabled={!isGenerating && !value.trim()}
            >
              <PaperPlane/>
            </PromptInput.Send>
          </PromptInput.ToolbarEnd>
        </PromptInput.Toolbar>
      </PromptInput.Shell>
    </PromptInput>
  );
}
