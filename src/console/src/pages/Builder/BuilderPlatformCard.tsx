import { useState } from 'react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Header, ListBox, Select, Spinner, Tabs, Tooltip } from '@heroui/react';
import { ArrowRotateRight, LogoLinux, LogoMacos, LogoWindows } from '@gravity-ui/icons';
import { refreshTemplates } from '../../api/build';
import type { BuildConfigRequest } from '../../types/models';
import { FALLBACK_PLATFORMS, PLATFORM_LABEL } from './constants';
import { useBuilderStatus } from './useBuilderStatus';

interface BuilderPlatformCardProps {
  config: BuildConfigRequest;
  set: <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) => void;
}

const OS_ORDER = ['windows', 'linux', 'macos'] as const;
const OS_TITLES: Record<string, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };
const OS_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  windows: LogoWindows,
  linux: LogoLinux,
  macos: LogoMacos,
};

/**
 * Target platform + application type. The platform options are driven by
 * GET /api/builder/status (grouped by OS, arch; options whose prebuilt
 * template is not cached yet are marked "(未下载)") with a static fallback
 * for older servers. In template mode a refresh button sits next to the
 * selector to (re-)fetch the selected platform's template.
 */
export function BuilderPlatformCard({ config, set }: BuilderPlatformCardProps) {
  const { t } = useTranslation();
  const { status, reload } = useBuilderStatus();
  const [refreshing, setRefreshing] = useState(false);
  const platforms = status?.platforms ?? FALLBACK_PLATFORMS;

  const sections = OS_ORDER
    .map((os) => ({ os, title: OS_TITLES[os], items: platforms.filter((p) => p.os === os) }))
    .filter((s) => s.items.length > 0);

  // Desktop (GUI subsystem) is Windows-only; linux-*/mac-* targets run as consoles.
  const isWindowsPlatform = config.platform === 'x64' || config.platform === 'x86' || config.platform === 'win-arm64';
  const isNonWindows = !isWindowsPlatform;

  const templateMode = status?.mode === 'template';

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshTemplates(config.platform);
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold mb-3">{t('builder.platform')}</h2>
          <div className="flex items-center gap-2">
            <Select
              className="min-w-0 flex-1"
              variant="secondary"
              selectedKey={config.platform}
              onSelectionChange={(key) => key && set('platform', String(key))}
              onOpenChange={(open) => {
                if (open) reload();
              }}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {sections.map((section) => (
                    <ListBox.Section key={section.os}>
                      <Header>{section.title}</Header>
                      {section.items.map((p) => (
                        <ListBox.Item
                          key={p.platform}
                          id={p.platform}
                          textValue={PLATFORM_LABEL[p.platform] ?? p.platform}
                        >
                          <span className="flex w-full items-center justify-between gap-3">
                            <span className="flex items-center gap-2">
                              {(() => {
                                const OsIcon = OS_ICONS[p.os];
                                return OsIcon ? <OsIcon className="h-4 w-4 shrink-0 text-default-500" /> : null;
                              })()}
                              <span>{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-default-500">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${p.template ? 'bg-success' : 'bg-warning'}`}
                                title={p.template ? undefined : t('builder.templateNotDownloaded')}
                              />
                              {p.arch.toUpperCase()}
                            </span>
                          </span>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox.Section>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            {templateMode && (
              <Tooltip delay={0}>
                <Button
                  isIconOnly
                  variant="secondary"
                  className="rounded-[15px] shrink-0"
                  isDisabled={refreshing}
                  onPress={handleRefresh}
                  aria-label={t('builder.refreshTemplate')}
                >
                  {refreshing ? <Spinner size="sm" /> : <ArrowRotateRight />}
                </Button>
                <Tooltip.Content placement="top">{t('builder.refreshTemplate')}</Tooltip.Content>
              </Tooltip>
            )}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-3">{t('builder.applicationType')}</h2>
          <Tabs
            selectedKey={config.applicationType}
            onSelectionChange={(key) => set('applicationType', String(key))}
          >
            <Tabs.ListContainer>
              <Tabs.List>
                <Tabs.Tab id="Console">{t('builder.consoleApp')}<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="Desktop" isDisabled={isNonWindows}>{t('builder.desktopApp')}<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        </div>
      </div>
    </Card>
  );
}
