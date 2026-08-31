import { useTranslation } from 'react-i18next';
import {
  Accordion,
  Card,
  Label,
  ListBox,
  NumberField,
  Select,
} from '@heroui/react';
import { ChevronDown } from '@gravity-ui/icons';
import { Input, TextField } from '@heroui/react';
import type { BuildConfigRequest } from '../../types/models';

interface BuilderConnectionCardProps {
  config: BuildConfigRequest;
  set: <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) => void;
}

const DEFAULT_PATHS: { key: keyof BuildConfigRequest; placeholder: string }[] = [
  { key: 'registerPath', placeholder: '/api/beacon/register' },
  { key: 'heartbeatPath', placeholder: '/api/beacon/heartbeat' },
  { key: 'resultPath', placeholder: '/api/beacon/result' },
  { key: 'wsPath', placeholder: '/ws/agent' },
  { key: 'coreDownloadPath', placeholder: '/api/v1/models/{buildId}' },
  { key: 'coreKeyPath', placeholder: '/api/v1/auth/token' },
];

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
              className="w-full"
              value={config.heartbeatIntervalMs || 3000}
              variant="secondary"
              minValue={500}
              maxValue={120000}
              step={500}
              name="unit"
              formatOptions={{
                style: "unit",
                unit: "millisecond",
                unitDisplay: "short",
              }}
              onChange={(v) => set('heartbeatIntervalMs', v ?? undefined)}
            >
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input className="w-[120px]" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>
          <p className="text-xs text-default-500">{t('builder.heartbeatIntervalDesc')}</p>
        </div>

        <div className="space-y-2">
          <Label>{t('builder.jitter')}</Label>

          <NumberField
            formatOptions={{ style: "percent", minimumFractionDigits: 0 }}
            maxValue={0.9}
            minValue={0}
            name="percentage"
            step={0.05}
            value={config.jitterPercent ?? 0.2}
            variant="secondary"
            onChange={(v) => set('jitterPercent', v ?? undefined)}
          >
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-[120px]" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
          <p className="text-xs text-default-500">{t('builder.jitterDesc')}</p>
        </div>
      </div>

      <Accordion className="mt-2 w-full" variant="surface" hideSeparator>
        <Accordion.Item>
          <Accordion.Heading>
            <Accordion.Trigger className="w-full flex items-center justify-between">
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
