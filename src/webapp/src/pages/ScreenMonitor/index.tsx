import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ListBox, Select } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { useScreenSession } from './useScreenSession';
import { ScreenCanvas } from './ScreenCanvas';
import type { ScreenCanvasHandle } from './ScreenCanvas';
import type { ScreenFrame } from './useScreenSession';

const FPS_OPTIONS = [
  { id: '1', label: '1 FPS' },
  { id: '3', label: '3 FPS' },
  { id: '5', label: '5 FPS' },
  { id: '10', label: '10 FPS' },
  { id: '15', label: '15 FPS' },
];

const QUALITY_OPTIONS = [
  { id: 'original', label: 'Original' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
  { id: '540p', label: '540p' },
  { id: '360p', label: '360p' },
  { id: '240p', label: '240p' },
];

export default function ScreenMonitorPage() {
  const { agentId } = useAgent();
  const canvasRef = useRef<ScreenCanvasHandle>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (agentId) {
      setError(null);
      canvasRef.current?.clear();
      bind(agentId);
    } else {
      disconnect();
      canvasRef.current?.clear();
    }
    return () => { disconnect(); };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!agentId) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        Select an online agent to view its screen.
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
          aria-label="Frame rate"
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
          aria-label="Quality"
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
            {streaming ? 'Streaming' : 'Stopped'}
          </span>
        </div>

        {streaming && (
          <Button size="sm" variant="tertiary" onPress={() => disconnect()}>
            Stop
          </Button>
        )}
        {!streaming && agentId && (
          <Button size="sm" variant="tertiary" onPress={() => bind(agentId)}>
            Start
          </Button>
        )}

        {error && (
          <span className="text-sm text-red-500">{error}</span>
        )}
      </div>

      <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-neutral-200">
        <ScreenCanvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
}
