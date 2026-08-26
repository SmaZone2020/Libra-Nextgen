import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  Button,
  Card,
  Input,
  Label,
  ListBox,
  Select,
  Slider,
  Spinner,
  TextField,
} from '@heroui/react';
import { NumberField } from '@heroui/react/number-field';
import { ChevronDown, Picture } from '@gravity-ui/icons';
import { uploadIcon } from '../../api/build';
import type { BuildConfigRequest } from '../../types/models';
import { HEARTBEAT_PRESETS } from './constants';

interface BuilderConfigCardProps {
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

export function BuilderConfigCard({ config, set }: BuilderConfigCardProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  // PE icon/metadata embedding is Windows-only; hide for Linux targets.
  const isLinux = config.platform === 'linux-x64';

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIconUploading(true);
    // Create local preview
    const previewUrl = URL.createObjectURL(file);
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(previewUrl);
    try {
      const path = await uploadIcon(file);
      set('iconUrl', path);
    } catch {
      setIconPreview(null);
    } finally {
      setIconUploading(false);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-lg font-semibold mb-3">{t('builder.connection')}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <TextField
          className="col-span-2"
          value={config.serverHost}
          variant="secondary"
          onChange={(v) => set('serverHost', v)}
        >
          <Label>{t('builder.serverHost')}</Label>
          <Input variant="secondary" placeholder="127.0.0.1" />
        </TextField>
        <NumberField
          className="w-full max-w-64"
          value={config.serverPort}
          variant="secondary"
          minValue={1}
          maxValue={65535}
          onChange={(v) => set('serverPort', v)}
        >
          <Label>{t('builder.serverPort')}</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input className="w-[120px]" />
            <NumberField.IncrementButton />
          </NumberField.Group>
        </NumberField>
      </div>

      {/* ── 连接参数：协议 / 心跳 / 抖动 ── */}
      <hr className="my-4 border-default-200" />
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
            <div className="flex gap-1">
              {HEARTBEAT_PRESETS.map((p) => (
                <Button
                  key={p.ms}
                  size="sm"
                  variant="ghost"
                  className="h-8 min-w-0 px-2 text-xs"
                  onPress={() => set('heartbeatIntervalMs', p.ms)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
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

      {/* ── 高级路径（留空 = 服务端默认） ── */}
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

      <hr className="my-4 border-default-200" />
      {!isLinux && (
      <>
      <h2 className="text-lg font-semibold mb-3">{t('builder.metadata')}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <TextField
          value={config.productName || ''}
          variant="secondary"
          onChange={(v) => set('productName', v || undefined)}
        >
          <Label>{t('builder.productName')}</Label>
          <Input variant="secondary" />
        </TextField>
        <TextField
          value={config.fileDescription || ''}
          variant="secondary"
          onChange={(v) => set('fileDescription', v || undefined)}
        >
          <Label>{t('builder.fileDescription')}</Label>
          <Input variant="secondary" />
        </TextField>
        <TextField
          value={config.companyName || ''}
          variant="secondary"
          onChange={(v) => set('companyName', v || undefined)}
        >
          <Label>{t('builder.companyName')}</Label>
          <Input variant="secondary" />
        </TextField>
        <TextField
          value={config.copyright || ''}
          variant="secondary"
          onChange={(v) => set('copyright', v || undefined)}
        >
          <Label>{t('builder.copyright')}</Label>
          <Input variant="secondary" />
        </TextField>
        <TextField
          value={config.fileVersion || ''}
          variant="secondary"
          onChange={(v) => set('fileVersion', v || undefined)}
        >
          <Label>{t('builder.fileVersion')}</Label>
          <Input variant="secondary" placeholder="1.0.0.0" />
        </TextField>
        <div className="space-y-2">
          <Label>{t('builder.icon')}</Label>
          <div className="flex items-center gap-3">
            <Input variant="secondary"
              title={t('builder.iconUpload')}
              ref={fileInputRef}
              type="file"
              accept=".ico"
              className="hidden"
              onChange={handleIconUpload}
            />
            <div
              className="relative shrink-0 w-10 h-10 border-2 border-dashed border-default-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-primary-400 transition-colors overflow-hidden"
              role="button"
              tabIndex={0}
              aria-label={t('builder.iconUpload')}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              {iconUploading ? (
                <Spinner />
              ) : iconPreview ? (
                <img src={iconPreview} alt="icon" className="w-full h-full object-contain p-0.5" />
              ) : (
                <Picture />
              )}
            </div>
            <TextField
              className="flex-1 w-[80%]"
              value={config.iconUrl || ''}
              onChange={(v) => set('iconUrl', v || undefined)}
            >
              <Input variant="secondary" placeholder="https://example.com/icon.ico" />
            </TextField>
          </div>
        </div>
      </div>
      </>
      )}
    </Card>
  );
}
