'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, ListBox, Popover, Select } from '@heroui/react';
import { ChevronDown, PaperPlane, Shield, Sparkles } from '@gravity-ui/icons';
import { PromptInput, CellSlider } from '../../vendor/ui-pro';
import type { AiProvider } from '../../api/ai';
import { resolveModelIcon } from './modelIcons';
import { formatModelDisplay, parseModelLabel, titleCaseWords } from './utils';
import { JUSTITIA_TIERS, type JustitiaTierKey } from './justitia';

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

  const vendors = useMemo(
    () => [...modelGroups.keys()].sort((a, b) => a.localeCompare(b)),
    [modelGroups],
  );
  const currentVendor = vendors.includes(vendorKey)
    ? vendorKey
    : (parseModelLabel(activeModel).vendor ?? '');
  const vendorModels = modelGroups.get(currentVendor) ?? [];

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
            <Select
              aria-label={t('ai.provider')}
              selectedKey={activeProvider?.id}
              onSelectionChange={(key) => {
                if (key) onSelectProvider(String(key));
              }}
              isDisabled={isGenerating}
              placeholder={t('ai.provider')}
              variant="secondary"
              className="min-w-0 max-w-[110px] sm:max-w-[140px]"
            >
              <Select.Trigger className="flex w-full items-center gap-1 overflow-hidden">
                <Select.Value className="min-w-0 flex-1 truncate" />
                <Select.Indicator className="shrink-0" />
              </Select.Trigger>
              <Select.Popover>
                <ListBox items={providers} className="max-h-[200px] overflow-y-auto">
                  {(item) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={item.name} className="truncate">
                      {item.name}
                    </ListBox.Item>
                  )}
                </ListBox>
              </Select.Popover>
            </Select>
            <Popover
              isOpen={modelMenuOpen}
              onOpenChange={setModelMenuOpen}
            >
              <Popover.Trigger>
                <Button
                  aria-label={t('ai.model')}
                  variant="secondary"
                  isDisabled={isGenerating || !activeProvider}
                  className="h-9 text-foreground min-w-0 max-w-[120px] shrink-0 gap-1 rounded-field border border-default-200 px-3 sm:max-w-[160px] dark:border-default-800"
                >
                  <Sparkles className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {activeModel ? formatModelDisplay(activeModel) : t('ai.model')}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted" />
                </Button>
              </Popover.Trigger>
              <Popover.Content className="min-w-[240px] p-0">
                <Popover.Dialog>
                  <div className="flex max-h-[280px] overflow-hidden">
                    <div className="w-auto min-w-[100px] shrink-0 overflow-y-auto border-r border-default-200 py-1 dark:border-default-800">
                      {vendors.map((vendor) => {
                        const active = vendor === currentVendor;
                        const vendorIcon = vendor ? resolveModelIcon(vendor) : null;
                        return (
                          <button
                            key={vendor || '(all)'}
                            type="button"
                            onClick={() => {
                              setVendorKey(vendor);
                            }}
                            className={`flex w-full items-center gap-1.5 truncate px-3 py-1.5 text-left text-sm transition-colors ${
                              active
                                ? 'bg-accent font-medium text-white'
                                : 'text-foreground hover:bg-default/60'
                            }`}
                          >
                            {vendorIcon && (
                              <img
                                src={vendorIcon}
                                alt=""
                                className="size-4 shrink-0 object-contain"
                                loading="lazy"
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {vendor ? titleCaseWords(vendor) : t('ai.vendorAll')}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="min-w-0 w-auto flex-1 overflow-y-auto py-1">
                      {vendorModels.map((m) => {
                        const parsed = parseModelLabel(m);
                        const selected = m === activeModel;
                        const vendorIcon = parsed.vendor ? resolveModelIcon(parsed.vendor) : null;
                        const modelIcon = vendorIcon ? null : resolveModelIcon(parsed.name);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              onSelectModel(m);
                              setModelMenuOpen(false);
                            }}
                            className={`flex min-w-[170px] w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                              selected
                                ? 'bg-accent font-medium text-white'
                                : 'text-foreground hover:bg-default/60'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-1.5 flex-1 relative">
                              {modelIcon && (
                                <img
                                  src={modelIcon}
                                  alt=""
                                  className="size-4 shrink-0 object-contain"
                                  loading="lazy"
                                />
                              )}
                              <span className="min-w-0 flex-1 truncate">
                                {titleCaseWords(parsed.name)}
                              </span>
                              <span className="right-0 flex items-center gap-1">
                                {parsed.isLatest && (
                                  <Chip
                                    color="accent"
                                    variant="primary"
                                    size="sm"
                                    className="shrink-0 text-white"
                                  >
                                    <Chip.Label>{t('ai.latest')}</Chip.Label>
                                  </Chip>
                                )}
                                {parsed.isBatch && (
                                  <Chip
                                    color="accent"
                                    variant="primary"
                                    size="sm"
                                    className="shrink-0 text-white"
                                  >
                                    <Chip.Label>{t('ai.batch')}</Chip.Label>
                                  </Chip>
                                )}
                                {parsed.isFree && (
                                  <Chip
                                    color="success"
                                    variant="primary"
                                    size="sm"
                                    className="shrink-0 text-white"
                                  >
                                    <Chip.Label>{t('ai.free')}</Chip.Label>
                                  </Chip>
                                )}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                      {vendorModels.length === 0 && (
                        <div className="px-3 py-6 text-center text-xs text-muted">
                          {t('ai.noModels')}
                        </div>
                      )}
                    </div>
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
                  <div className="flex flex-col items-center gap-3 pb-1">
                    <CellSlider
                      maxValue={3}
                      minValue={0}
                      step={1}
                      variant="secondary"
                      value={permission}
                      onChange={(v) => {
                        const val = Array.isArray(v) ? v[0] ?? 0 : v;
                        const tier = JUSTITIA_TIERS[val];
                        if (tier) onTierChange(tier.key);
                      }}
                    >
                      <CellSlider.Track>
                        <CellSlider.Fill className="transition-[width] duration-300 ease-out" />
                        <CellSlider.Thumb className="transition-[translate,left] duration-300 ease-out" />
                      </CellSlider.Track>
                    </CellSlider>
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
