import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  ComboBox,
  Input,
  Label,
  ListBox,
  NumberField,
  Spinner,
  TextField,
} from '@heroui/react';
import { Picture } from '@gravity-ui/icons';
import { uploadIcon } from '../../api/build';
import { loadBuildPresets } from '../../utils/buildPresets';
import type { BuildConfigRequest } from '../../types/models';
import type { BuildPreset } from '../../utils/buildPresets';

interface BuilderConfigCardProps {
  config: BuildConfigRequest;
  set: <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) => void;
  applyConfig: (config: BuildConfigRequest) => void;
}

export function BuilderConfigCard({ config, set, applyConfig }: BuilderConfigCardProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [presets, setPresets] = useState<BuildPreset[]>([]);
  // PE icon/metadata embedding is Windows-only; hide for other targets.
  const isWindowsPlatform = config.platform === 'x64' || config.platform === 'x86' || config.platform === 'win-arm64';

  useEffect(() => {
    setPresets(loadBuildPresets());
  }, []);

  const filteredPresets = useMemo(() => {
    const q = config.serverHost.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter((p) => p.config.serverHost.toLowerCase().includes(q));
  }, [presets, config.serverHost]);

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
        <ComboBox
          className="col-span-2"
          variant="secondary"
          inputValue={config.serverHost}
          allowsCustomValue
          onInputChange={(v) => set('serverHost', v)}
          onSelectionChange={(key) => {
            if (key == null) return;
            const preset = presets.find((p) => p.id === key);
            if (preset) applyConfig({ ...preset.config });
          }}
        >
          <Label>{t('builder.serverHost')}</Label>
          <ComboBox.InputGroup>
            <Input variant="secondary" placeholder="127.0.0.1" />
            <ComboBox.Trigger />
          </ComboBox.InputGroup>
          <ComboBox.Popover>
            <ListBox>
              {filteredPresets.map((p) => (
                <ListBox.Item key={p.id} id={p.id} textValue={p.config.serverHost}>
                  <span className="font-mono text-xs">{p.config.serverHost}:{p.config.serverPort}</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>
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
      <hr className="my-4 border-default-200" />
      {isWindowsPlatform && (
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
