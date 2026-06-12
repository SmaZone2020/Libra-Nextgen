import { useCallback, useRef, useState } from 'react';
import { consoleWs } from '../../ws/consoleWs';
import { getToken, API_ORIGIN } from '../../api/client';

export interface CameraConfig {
  fps: number;
}

export interface CameraDevice {
  index: number;
  name: string;
}

export interface CameraDiffBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  data: string;
}

export interface CameraKeyframe {
  type: 'keyframe';
  width: number;
  height: number;
  data: string;
}

export interface CameraDiff {
  type: 'diff';
  blocks: CameraDiffBlock[];
}

export type CameraFrame = CameraKeyframe | CameraDiff;

interface UseCameraSessionOptions {
  onFrame: (frame: CameraFrame) => void;
  onError?: (error: string) => void;
}

export function useCameraSession({ onFrame, onError }: UseCameraSessionOptions) {
  const agentIdRef = useRef<string>('');
  const [streaming, setStreaming] = useState(false);
  const [config, setConfig] = useState<CameraConfig>({ fps: 10 });
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  const abortRef = useRef<AbortController | null>(null);
  onFrameRef.current = onFrame;
  onErrorRef.current = onError;

  const startSSE = useCallback((agentId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const token = getToken();
    if (!token) return;

    const run = async () => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/media/camera/stream/${agentId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onErrorRef.current?.(`Camera SSE failed: HTTP ${res.status}`);
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const event of events) {
            const dataLine = event.split('\n').find(l => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              const msg = JSON.parse(dataLine.slice(6));
              if (msg.type === 'camera.frame') {
                const d = msg.data;
                if (d.error) {
                  onErrorRef.current?.(d.error);
                } else if (d.type === 'keyframe') {
                  onFrameRef.current({ type: 'keyframe', width: d.width, height: d.height, data: d.data });
                } else if (d.type === 'diff') {
                  onFrameRef.current({ type: 'diff', blocks: d.blocks });
                } else if (d.data) {
                  // Legacy full-frame format fallback
                  onFrameRef.current({ type: 'keyframe', width: 0, height: 0, data: d.data });
                }
              } else if (msg.type === 'camera.error') {
                onErrorRef.current?.(msg.data.error);
              }
            } catch { /* skip */ }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          onErrorRef.current?.(`Camera stream interrupted: ${(e as Error).message}`);
        }
      }
      setStreaming(false);
    };

    run();
  }, []);

  const stopSSE = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const unbind = useCallback(() => {
    const id = agentIdRef.current;
    if (!id) return;
    setStreaming(false);
    stopSSE();
    consoleWs.send({
      type: 'camera.unbind',
      channel: id,
      data: { agentId: id },
      ts: Date.now(),
    });
  }, [stopSSE]);

  const bind = useCallback((agentId: string, cameraIndex: number, cfg?: Partial<CameraConfig>) => {
    unbind();
    agentIdRef.current = agentId;
    const finalCfg = { ...config, ...cfg };
    setConfig(finalCfg);
    setStreaming(true);

    consoleWs.send({
      type: 'camera.bind',
      channel: agentId,
      data: { agentId, fps: finalCfg.fps, cameraIndex },
      ts: Date.now(),
    });

    startSSE(agentId);
  }, [config, unbind, startSSE]);

  const updateConfig = useCallback((cfg: Partial<CameraConfig>) => {
    const id = agentIdRef.current;
    if (!id) return;
    setConfig(prev => ({ ...prev, ...cfg }));
    consoleWs.send({
      type: 'camera.config',
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
