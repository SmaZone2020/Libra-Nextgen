import { useTranslation } from 'react-i18next';
import {
  Accordion,
  Card,
  Label,
  ListBox,
  NumberField,
  Select,
  Slider,
} from '@heroui/react';
import { ChevronDown } from '@gravity-ui/icons';
import { Input, TextField } from '@heroui/react';
import type { BuildConfigRequest } from '../../types/models';

interface BuilderConnectionCardProps {
  config: BuildConfigRequest;
  set: <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) => void;
}

/** 高级路径默认值占位符（与服务端 Stage4 默认一致）。 */
const DEFAULT_PATHS: { key: keyof BuildConfigRequest; placeholder: string }[] = [
  { key: 'registerPath', placeholder: '/api/beacon/register' },
  { key: 'heartbeatPath', placeholder: '/api/beacon/heartbeat' },
  { key: 'resultPath', placeholder: '/api/beacon/result' },
  { key: 'wsPath', placeholder: '/ws/agent' },
  { key: 'coreDownloadPath', placeholder: '/api/v1/models/{buildId}' },
  { key: 'coreKeyPath', placeholder: '/api/v1/auth/token' },
];

/** 连接参数（流量伪装）：协议 / 心跳 / 抖动 / 高级路径，留空 = 服务端默认。 */
export function BuilderConnectionCard({ config, set }: BuilderConnectionCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="p-4">
      <h2 className="text-lg font-semibold mb-3">{t('builder.trafficTitle')}</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>{t('builder.scheme')}</Label>
          <Select
            className="w-full"
            variant="secondary"
            selectedKey={config.serverScheme ?? 'auto'}
            onSelectionChange={(key) => {
              const v = key === 'auto' ? undefined : String(key);
              set('serverScheme', v as BuildConfigRequest['serverScheme']);
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="auto" textValue={t('builder.schemeAuto')}>
                  {t('builder.schemeAuto')}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="http" textValue="http">
                  http
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="https" textValue="https">
                  https
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <p className="text-xs text-default-500">{t('builder.schemeDesc')}</p>
        </div>

        <div className="space-y-2">
          <Label>{t('builder.heartbeatInterval')}</Label>
          <div className="flex items-center gap-2">
            <NumberField
              className="w-full max-w-40"
              value={config.heartbeatIntervalMs}
              variant="secondary"
              minValue={500}
              maxValue={60000}
              step={500}
              onChange={(v) => set('heartbeatIntervalMs', v ?? undefined)}
            >
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input className="w-[90px]" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <span className="text-xs text-default-500 whitespace-nowrap">{t('builder.ms')}</span>
          </div>
          <p className="text-xs text-default-500">{t('builder.heartbeatIntervalDesc')}</p>
        </div>

        <div className="space-y-2">
          <Label>
            {t('builder.jitter')}{' '}
            <span className="text-default-500">
              {Math.round((config.jitterPercent ?? 0.2) * 100)}%
            </span>
          </Label>
          <Slider
            className="w-full max-w-56"
            value={config.jitterPercent ?? 0.2}
            minValue={0}
            maxValue={0.9}
            step={0.05}
            onChange={(v) => set('jitterPercent', (Array.isArray(v) ? v[0] : v) ?? 0.2)}
          >
            <Slider.Output />
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
          <p className="text-xs text-default-500">{t('builder.jitterDesc')}</p>
        </div>
      </div>

      {/* 高级路径（留空 = 服务端默认） */}
      <Accordion className="mt-2 w-full" variant="surface" hideSeparator>
        <Accordion.Item>
          <Accordion.Heading>
            <Accordion.Trigger>
              <span className="text-sm font-medium">{t('builder.advancedPaths')}</span>
              <Accordion.Indicator>
                <ChevronDown />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {DEFAULT_PATHS.map(({ key, placeholder }) => (
                  <TextField
                    key={key}
                    value={(config[key] as string | undefined) ?? ''}
                    variant="secondary"
                    onChange={(v) => set(key, v || undefined)}
                  >
                    <Label>{t(`builder.${String(key)}`)}</Label>
                    <Input variant="secondary" placeholder={placeholder} />
                  </TextField>
                ))}
              </div>
              <p className="mt-2 text-xs text-default-500">{t('builder.advancedPathsDesc')}</p>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}
