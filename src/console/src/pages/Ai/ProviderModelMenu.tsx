'use client';

import { useTranslation } from 'react-i18next';
import { Description, Label, ListBox } from '@heroui/react';
import type { AiProvider } from '../../api/ai';
import { resolveModelIcon } from './modelIcons';
import { parseModelLabel, titleCaseWords } from './utils';
import { BrandIcon } from './BrandIcon';

export function ProviderModelMenu({
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
