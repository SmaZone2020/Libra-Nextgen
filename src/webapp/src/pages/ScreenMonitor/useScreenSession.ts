import { useCallback, useRef, useState } from 'react';
import { consoleWs } from '../../ws/consoleWs';
import { getToken } from '../../api/client';

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

const API_BASE = 'http://127.0.0.1:5270';

export function useScreenSession({ onFrame, onError }: UseScreenSessionOptions) {
  const agentIdRef = useRef<string>('');
  const [streaming, setStreaming] = useState(false);
  const [config, setConfig] = useState<ScreenConfig>({ fps: 5, quality: '720p' });
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
        const res = await fetch(`${API_BASE}/api/screen/stream/${agentId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onErrorRef.current?.(`SSE connection failed: HTTP ${res.status}`);
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
              if (msg.type === 'screen.frame') {
                const d = msg.data;
                onFrameRef.current({ type: 'keyframe', width: d.width, height: d.height, jpeg: d.jpeg });
              } else if (msg.type === 'screen.diff') {
                onFrameRef.current({ type: 'diff', blocks: msg.data.blocks });
              } else if (msg.type === 'screen.error') {
                onErrorRef.current?.(msg.data.error);
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          onErrorRef.current?.(`Stream interrupted: ${(e as Error).message}`);
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
      type: 'screen.unbind',
      channel: id,
      data: { agentId: id },
      ts: Date.now(),
    });
  }, [stopSSE]);

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

    startSSE(agentId);
  }, [config, unbind, startSSE]);

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
