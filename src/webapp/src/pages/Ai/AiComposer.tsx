'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  Button,
  Chip,
  Description,
  Drawer,
  Label,
  ListBox,
  Popover,
  useOverlayState,
} from '@heroui/react';
import { ChevronDown, Shield, Sparkles } from '@gravity-ui/icons';
import { PromptInput, CellSlider, PressableFeedback } from '../../vendor/ui-pro';
import type { AiProvider } from '../../api/ai';
import { resolveModelIcon } from './modelIcons';
import { formatModelDisplay, parseModelLabel, titleCaseWords } from './utils';
import { JUSTITIA_TIERS, JUSTITIA_TIER_VALUES, snapJustitiaValue, type JustitiaTierKey } from './justitia';

function BrandIcon({ name, className = 'size-5' }: { name: string; className?: string }) {
  const icon = name ? resolveModelIcon(name) : null;
  if (icon) {
    return (
      <img src={icon} alt="" className={`${className} rounded-[15px] shrink-0 object-contain`} loading="lazy" />
    );
  }
  return (
    <img
      alt="icon"
      className={`${className} shrink-0 object-cover dark:invert select-none pointer-events-none`}
      loading="lazy"
      src="/images/icon2.webp"
    />
  );
}

function ProviderModelMenu({
  providers,
  activeProvider,
  activeModel,
  vendors,
  currentVendor,
  vendorModels,
  isGenerating,
  onProviderSelect,
  onVendorSelect,
  onModelSelect,
}: {
  providers: AiProvider[];
  activeProvider: AiProvider | null;
  activeModel: string;
  vendors: string[];
  currentVendor: string;
  vendorModels: string[];
  isGenerating: boolean;
  onProviderSelect: (id: string) => void;
  onVendorSelect: (vendor: string) => void;
  onModelSelect: (model: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex max-h-[300px] overflow-hidden">
      {/* 列 1：供应商 */}
      <ListBox
        aria-label={t('ai.provider')}
        selectionMode="single"
        selectedKeys={activeProvider ? [activeProvider.id] : []}
        onSelectionChange={(keys) => {
          const k = [...keys][0];
          if (k) onProviderSelect(String(k));
        }}
        className="w-44 shrink-0 overflow-y-auto scrollbar-thin border-r border-default-200 py-1 dark:border-default-800"
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
            if (k) onVendorSelect(String(k));
          }}
          className="max-w-46 shrink-0 overflow-y-auto scrollbar-thin border-r border-default-200 py-1 dark:border-default-800"
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
          if (k) onModelSelect(String(k));
        }}
        className="max-w-60 flex-1 overflow-y-auto scrollbar-thin py-1"
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
                <span className="truncate">{titleCaseWords(parsed.name)}</span>
                <div className='space-x-2 -mt-1'>
                  {parsed.isFree && (
                    <Description className="text-[11px] text-success">
                      {t('ai.free')}
                    </Description>
                  )}
                  {parsed.isLatest && (
                    <Description className="text-[11px] text-accent">
                      {t('ai.latest')}
                    </Description>
                  )}
                  {parsed.isBatch && (
                    <Description className="text-[11px] text-warning">
                      {t('ai.batch')}
                    </Description>
                  )}
                </div>
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
  );
}

export interface AiComposerProps {
  providers: AiProvider[];
  activeProviderId: string | null;
  activeModel: string;
  isGenerating: boolean;
  canSend: boolean;
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
  const mobileDrawer = useOverlayState();
  const permission = JUSTITIA_TIERS.find((x) => x.key === justitiaTier)?.index ?? 0;
  const [draftValue, setDraftValue] = useState<number | null>(null);
  const isDragging = draftValue !== null;
  const sliderValue = draftValue ?? JUSTITIA_TIER_VALUES[permission] ?? 0;
  const activeTierIndex =
    draftValue !== null
      ? JUSTITIA_TIER_VALUES.indexOf(snapJustitiaValue(draftValue))
      : permission;
  const activeTier = JUSTITIA_TIERS[activeTierIndex];
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

  const handleProviderSelect = (id: string) => {
    onSelectProvider(id);
    setVendorKey('');
  };

  const handleModelSelect = (m: string) => {
    onSelectModel(m);
    setModelMenuOpen(false);
  };

  const menuProps = {
    providers,
    activeProvider: activeProvider ?? null,
    activeModel,
    vendors,
    currentVendor,
    vendorModels,
    isGenerating,
    onProviderSelect: handleProviderSelect,
    onVendorSelect: setVendorKey,
    onModelSelect: handleModelSelect,
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isGenerating) return;
    setValue('');
    onSend(trimmed);
  };

  return (
    <>
      <PromptInput
        status={isGenerating ? 'streaming' : 'ready'}
        variant="primary"
        value={value}
        onValueChange={setValue}
        onStop={onStop}
        onSubmit={handleSubmit}
        className={permission === 3 ? 'aurora-input aurora-input--active' : undefined}
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
              <div className="hidden sm:block">
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
                      <ProviderModelMenu {...menuProps} />
                    </Popover.Dialog>
                  </Popover.Content>
                </Popover>
              </div>

              <div className="sm:hidden">
                <Button
                  aria-label={t('ai.providerModel')}
                  variant="secondary"
                  isIconOnly
                  isDisabled={isGenerating || !activeProvider}
                  onPress={mobileDrawer.open}
                  className="h-9 min-w-0 max-w-[160px] shrink-0 gap-1.5 rounded-field border border-default-200 px-3 dark:border-default-800"
                >
                  <BrandIcon name={activeProvider?.name ?? (activeProvider?.name.slice(0,2) ?? 'P')} className="size-4" />
                </Button>
              </div>
            </PromptInput.ToolbarStart>
            <PromptInput.ToolbarEnd>
              <Popover isOpen={tierMenuOpen} onOpenChange={setTierMenuOpen}>
                <Button
                  aria-label={t('ai.justitiaTier')}
                  variant="ghost"
                  isDisabled={isGenerating}
                  className="h-9 w-[140px] shrink-0 gap-1"
                >
                  <span className={`text-sm font-medium ${activeTierIndex === 3 ? 'aurora-text' : ''}`}>
                    {activeTier?.name ?? JUSTITIA_TIERS[permission]?.name}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted" />
                </Button>
                <Popover.Content offset={10}>
                  <Popover.Dialog>
                    <Popover.Arrow className="fill-accent/30" />
                    <Popover.Heading>{t('ai.adjustJustitia')}</Popover.Heading>
                    <div className="flex flex-col items-center gap-3 pb-1 mt-3">
                      <CellSlider
                        maxValue={100}
                        minValue={0}
                        step={1}
                        variant="secondary"
                        value={sliderValue}
                        data-dragging={isDragging ? 'true' : 'false'}
                        className="group"
                        onChange={(v) => {
                          const val = Array.isArray(v) ? v[0] ?? 0 : v;
                          setDraftValue(Math.round(val));
                        }}
                        onChangeEnd={(v) => {
                          const val = Array.isArray(v) ? v[0] ?? 0 : v;
                          const snapped = snapJustitiaValue(val);
                          const tier = JUSTITIA_TIERS[JUSTITIA_TIER_VALUES.indexOf(snapped)];
                          if (tier) onTierChange(tier.key);
                          setDraftValue(null);
                        }}
                      >
                        <CellSlider.Track>
                          <CellSlider.Fill className="transition-[width] duration-200 ease-out group-data-[dragging=true]:transition-none" />
                          <CellSlider.Thumb className="transition-[translate,left] duration-200 ease-out group-data-[dragging=true]:transition-none" />
                          {/* 档位中点刻度：33 / 66（与 thumb 可见指示条同用 left:p% 定位，中心对齐） */}
                          {JUSTITIA_TIER_VALUES.filter((pos) => pos !== 0 && pos !== 100).map(
                            (pos) => {
                              const tierIndex = JUSTITIA_TIER_VALUES.indexOf(pos);
                              return (
                                <span
                                  key={pos}
                                  aria-hidden="true"
                                  className={`pointer-events-none absolute top-1/2 z-[1] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200 ${
                                    tierIndex === activeTierIndex ? 'bg-accent' : 'bg-muted/50'
                                  }`}
                                  style={{ left: `${pos}%` }}
                                />
                              );
                            },
                          )}
                        </CellSlider.Track>
                      </CellSlider>
                    </div>
                  </Popover.Dialog>
                </Popover.Content>
              </Popover>

              <PromptInput.Send
                aria-label={isGenerating ? t('ai.stop') : t('ai.send')}
                isDisabled={!isGenerating && !value.trim()}
              />
            </PromptInput.ToolbarEnd>
          </PromptInput.Toolbar>
        </PromptInput.Shell>
      </PromptInput>

      <Drawer state={mobileDrawer}>
        <Drawer.Backdrop isDismissable>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className='px-0'>
              <Drawer.Header className='px-5'>
                <Drawer.Heading>{t('ai.providerModel')}</Drawer.Heading>
                <Drawer.CloseTrigger />
              </Drawer.Header>
              <Drawer.Body className='px-0'>
                <Accordion className="w-full">
                  {providers.map((p) => {
                    const expanded = p.id === activeProvider?.id;
                    const pModels = new Map<string, string[]>();
                    for (const m of p.models ?? []) {
                      const parsed = parseModelLabel(m);
                      if (!parsed.name) continue;
                      const vendor = parsed.vendor ?? '';
                      const list = pModels.get(vendor) ?? [];
                      list.push(m);
                      pModels.set(vendor, list);
                    }
                    const pVendors = [...pModels.keys()].sort((a, b) => a.localeCompare(b));
                    const pCurrentVendor = pVendors.includes(vendorKey)
                      ? vendorKey
                      : (parseModelLabel(activeModel).vendor ?? '');
                    const pVendorModels = pModels.get(pCurrentVendor) ?? [];
                    return (
                      <Accordion.Item key={p.id} id={p.id} isDisabled={isGenerating}>
                        <Accordion.Heading>
                          <Accordion.Trigger
                            onPress={() => {
                              if (!expanded) handleProviderSelect(p.id);
                            }}
                          >
                            <BrandIcon name={p.name} className="size-5" />
                            <span className="min-w-0 flex-1 truncate ml-2">{p.name}</span>
                            <Accordion.Indicator>
                              <ChevronDown className="size-4" />
                            </Accordion.Indicator>
                          </Accordion.Trigger>
                        </Accordion.Heading>
                        <Accordion.Panel>
                          <Accordion.Body>
                            <div className="flex max-h-[300px] overflow-hidden">
                              {pVendors.length > 1 && (
                                <ListBox
                                  aria-label={t('ai.vendorAll')}
                                  selectionMode="single"
                                  selectedKeys={pCurrentVendor ? [pCurrentVendor] : []}
                                  onSelectionChange={(keys) => {
                                    const k = [...keys][0];
                                    if (k) setVendorKey(String(k));
                                  }}
                                  className="w-36 shrink-0 overflow-y-auto scrollbar-thin border-r border-default-200 py-1 dark:border-default-800"
                                >
                                  {pVendors.map((vendor) => (
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
                              <ListBox
                                aria-label={t('ai.model')}
                                selectionMode="single"
                                selectedKeys={activeModel ? [activeModel] : []}
                                onSelectionChange={(keys) => {
                                  const k = [...keys][0];
                                  if (k) {
                                    onSelectModel(String(k));
                                    mobileDrawer.close();
                                  }
                                }}
                                className="min-w-0 flex-1 overflow-y-auto scrollbar-thin py-1"
                              >
                                {pVendorModels.map((m) => {
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
                                        </Label>
                                        <div className='space-x-2 -mt-1'>
                                          {parsed.isFree && (
                                            <Description className="text-[11px] text-success">
                                              {t('ai.free')}
                                            </Description>
                                          )}
                                          {parsed.isLatest && (
                                            <Description className="text-[11px] text-accent">
                                              {t('ai.latest')}
                                            </Description>
                                          )}
                                          {parsed.isBatch && (
                                            <Description className="text-[11px] text-warning">
                                              {t('ai.batch')}
                                            </Description>
                                          )}
                                        </div>
                                      </div>
                                      <ListBox.ItemIndicator />
                                    </ListBox.Item>
                                  );
                                })}
                                {pVendorModels.length === 0 && (
                                  <ListBox.Item id="__empty" textValue={t('ai.noModels')} isDisabled>
                                    <Label className="text-muted">{t('ai.noModels')}</Label>
                                  </ListBox.Item>
                                )}
                              </ListBox>
                            </div>
                          </Accordion.Body>
                        </Accordion.Panel>
                      </Accordion.Item>
                    );
                  })}
                </Accordion>
              </Drawer.Body>
              <Drawer.Footer className='px-5'>
                <Button slot="close" variant="secondary" onPress={mobileDrawer.close}>
                  {t('common.cancel')}
                </Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </>
  );
}
