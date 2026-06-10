import { useCallback, useEffect, useRef, useState } from 'react';
import { consoleWs } from '../../ws/consoleWs';
import type { WsMessage } from '../../types/models';

export interface ScreenConfig {
  fps: number;
  quality: string;
}

export interface ScreenKeyframe {
  type: 'keyframe';
  width: number;
  height: number;
  jpeg: string;
}

export interface ScreenDiffBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  data: string;
}

export interface ScreenDiff {
  type: 'diff';
  blocks: ScreenDiffBlock[];
}

export type ScreenFrame = ScreenKeyframe | ScreenDiff;

interface UseScreenSessionOptions {
  onFrame: (frame: ScreenFrame) => void;
  onError?: (error: string) => void;
}

export function useScreenSession({ onFrame, onError }: UseScreenSessionOptions) {
  const agentIdRef = useRef<string>('');
  const [streaming, setStreaming] = useState(false);
  const [config, setConfig] = useState<ScreenConfig>({ fps: 5, quality: '720p' });
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  onFrameRef.current = onFrame;
  onErrorRef.current = onError;

  const unbind = useCallback(() => {
    const id = agentIdRef.current;
    if (!id) return;
    setStreaming(false);
    consoleWs.send({
      type: 'screen.unbind',
      channel: id,
      data: { agentId: id },
      ts: Date.now(),
    });
  }, []);

  useEffect(() => {
    const handleMessage = (msg: WsMessage) => {
      const id = agentIdRef.current;
      if (!id || msg.channel !== id) return;

      switch (msg.type) {
        case 'screen.frame': {
          const d = msg.data as { width: number; height: number; jpeg: string };
          onFrameRef.current({ type: 'keyframe', width: d.width, height: d.height, jpeg: d.jpeg });
          break;
        }
        case 'screen.diff': {
          const d = msg.data as { blocks: ScreenDiffBlock[] };
          onFrameRef.current({ type: 'diff', blocks: d.blocks });
          break;
        }
        case 'screen.error': {
          const d = msg.data as { error: string };
          onErrorRef.current?.(d.error);
          break;
        }
      }
    };

    const unsub = consoleWs.onAny(handleMessage);
    return () => {
      unsub();
      unbind();
    };
  }, [unbind]);

  const bind = useCallback((agentId: string, cfg?: Partial<ScreenConfig>) => {
    unbind();
    agentIdRef.current = agentId;
    const finalCfg = { ...config, ...cfg };
    setConfig(finalCfg);
    setStreaming(true);
    consoleWs.send({
      type: 'screen.bind',
      channel: agentId,
      data: { agentId, fps: finalCfg.fps, quality: finalCfg.quality },
      ts: Date.now(),
    });
  }, [config, unbind]);

  const updateConfig = useCallback((cfg: Partial<ScreenConfig>) => {
    const id = agentIdRef.current;
    if (!id) return;
    setConfig(prev => ({ ...prev, ...cfg }));
    consoleWs.send({
      type: 'screen.config',
      channel: id,
      data: cfg,
      ts: Date.now(),
    });
  }, []);

  const disconnect = useCallback(() => {
    unbind();
    agentIdRef.current = '';
  }, [unbind]);

  return { bind, disconnect, updateConfig, streaming, config };
}
