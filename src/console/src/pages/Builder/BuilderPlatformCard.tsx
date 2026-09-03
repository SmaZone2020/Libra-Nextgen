import { useTranslation } from 'react-i18next';
import { Card, Header, ListBox, Select, Tabs } from '@heroui/react';
import type { BuildConfigRequest } from '../../types/models';
import { FALLBACK_PLATFORMS, PLATFORM_LABEL } from './constants';
import { useBuilderStatus } from './useBuilderStatus';

interface BuilderPlatformCardProps {
  config: BuildConfigRequest;
  set: <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) => void;
}

const OS_ORDER = ['windows', 'linux', 'macos'] as const;
const OS_TITLES: Record<string, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };

/**
 * Target platform + application type. The platform options are driven by
 * GET /api/builder/status (grouped by OS, arch + template-cache state per
 * option, refreshed on open) with a static fallback for older servers.
 */
export function BuilderPlatformCard({ config, set }: BuilderPlatformCardProps) {
  const { t } = useTranslation();
  const { status, reload } = useBuilderStatus();
  const platforms = status?.platforms ?? FALLBACK_PLATFORMS;

  const sections = OS_ORDER
    .map((os) => ({ os, title: OS_TITLES[os], items: platforms.filter((p) => p.os === os) }))
    .filter((s) => s.items.length > 0);

  // Desktop (GUI subsystem) is Windows-only; linux-*/mac-* targets run as consoles.
  const isWindowsPlatform = config.platform === 'x64' || config.platform === 'x86' || config.platform === 'win-arm64';
  const isNonWindows = !isWindowsPlatform;

  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold mb-3">{t('builder.platform')}</h2>
          <Select
            className="w-full"
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
                          <span>{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                          <span className="flex items-center gap-1.5 text-xs text-default-500">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${p.template ? 'bg-success' : 'bg-warning'}`}
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
          <p className="text-xs text-default-500 mt-2">
            {t(config.applicationType === 'Desktop' ? 'builder.desktopAppDesc' : 'builder.consoleAppDesc')}
          </p>
        </div>
      </div>
    </Card>
  );
}
