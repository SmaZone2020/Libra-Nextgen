import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListBox, Select } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { useScreenSession } from './useScreenSession';
import { ScreenCanvas } from './ScreenCanvas';
import type { ScreenCanvasHandle } from './ScreenCanvas';
import type { ScreenFrame } from './useScreenSession';

export default function ScreenMonitorPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const canvasRef = useRef<ScreenCanvasHandle>(null);
  const [error, setError] = useState<string | null>(null);

  const FPS_OPTIONS = [
    { id: '1', label: t('screenMonitor.fps.1') },
    { id: '3', label: t('screenMonitor.fps.3') },
    { id: '5', label: t('screenMonitor.fps.5') },
    { id: '10', label: t('screenMonitor.fps.10') },
    { id: '15', label: t('screenMonitor.fps.15') },
  ];

  const QUALITY_OPTIONS = [
    { id: 'original', label: t('screenMonitor.qualityOpts.original') },
    { id: '1080p', label: t('screenMonitor.qualityOpts.1080p') },
    { id: '720p', label: t('screenMonitor.qualityOpts.720p') },
    { id: '540p', label: t('screenMonitor.qualityOpts.540p') },
    { id: '360p', label: t('screenMonitor.qualityOpts.360p') },
    { id: '240p', label: t('screenMonitor.qualityOpts.240p') },
  ];

  const onFrame = useCallback((frame: ScreenFrame) => {
    if (!canvasRef.current) return;
    if (frame.type === 'keyframe') {
      canvasRef.current.renderKeyframe(frame.width, frame.height, frame.jpeg);
    } else {
      canvasRef.current.renderDiff(frame.blocks);
    }
  }, []);

  const onError = useCallback((err: string) => {
    setError(err);
  }, []);

  const { bind, disconnect, updateConfig, streaming, config } = useScreenSession({ onFrame, onError });

  useEffect(() => {
    if (!agentId) {
      disconnect();
      canvasRef.current?.clear();
      setError(null);
    }
    return () => { disconnect(); };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!agentId) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        {t('screenMonitor.selectAgent')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-180px)]">
      <div className="flex items-center gap-3 shrink-0">
        <Select
          selectedKey={String(config.fps)}
          onSelectionChange={(key) => {
            if (key) updateConfig({ fps: Number(key) });
          }}
          className="w-[120px]"
          aria-label={t('screenMonitor.frameRate')}
        >
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {FPS_OPTIONS.map((opt) => (
                <ListBox.Item key={opt.id} id={opt.id} textValue={opt.label}>
                  {opt.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Select
          selectedKey={config.quality}
          onSelectionChange={(key) => {
            if (key) updateConfig({ quality: String(key) });
          }}
          className="w-[140px]"
          aria-label={t('screenMonitor.quality')}
        >
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {QUALITY_OPTIONS.map((opt) => (
                <ListBox.Item key={opt.id} id={opt.id} textValue={opt.label}>
                  {opt.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${streaming ? 'bg-green-500' : 'bg-neutral-300'}`} />
          <span className="text-sm text-default-500">
            {streaming ? t('screenMonitor.streaming') : t('screenMonitor.stopped_status')}
          </span>
        </div>

        {streaming && (
          <Button size="sm" variant="tertiary" onPress={() => disconnect()}>
            {t('common.stop')}
          </Button>
        )}
        {!streaming && agentId && (
          <Button size="sm" variant="tertiary" onPress={() => bind(agentId)}>
            {t('common.start')}
          </Button>
        )}

        {error && (
          <span className="text-sm text-red-500">{error}</span>
        )}
      </div>

      <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-900 flex items-center justify-center">
        {streaming ? (
          <ScreenCanvas ref={canvasRef} className="w-full h-full" />
        ) : (
          <span className="text-neutral-500 text-sm select-none">{t('screenMonitor.stopped')}</span>
        )}
      </div>
    </div>
  );
}
