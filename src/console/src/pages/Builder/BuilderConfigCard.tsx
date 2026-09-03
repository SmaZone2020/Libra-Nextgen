import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  ComboBox,
  Input,
  Label,
  ListBox,
  NumberField,
} from '@heroui/react';
import { loadBuildPresets } from '../../utils/buildPresets';
import type { BuildConfigRequest } from '../../types/models';
import type { BuildPreset } from '../../utils/buildPresets';

interface BuilderConfigCardProps {
  config: BuildConfigRequest;
  set: <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) => void;
  applyConfig: (config: BuildConfigRequest) => void;
}

/** Connection config: server host / port (+ saved build presets). */
export function BuilderConfigCard({ config, set, applyConfig }: BuilderConfigCardProps) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<BuildPreset[]>([]);

  useEffect(() => {
    setPresets(loadBuildPresets());
  }, []);

  const filteredPresets = useMemo(() => {
    const q = config.serverHost.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter((p) => p.config.serverHost.toLowerCase().includes(q));
  }, [presets, config.serverHost]);

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
    </Card>
  );
}
