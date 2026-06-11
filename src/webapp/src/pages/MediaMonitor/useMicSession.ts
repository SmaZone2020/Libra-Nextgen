import { useCallback, useRef, useState } from 'react';
import { consoleWs } from '../../ws/consoleWs';
import { getToken, API_ORIGIN } from '../../api/client';

export interface MicDevice {
  index: number;
  name: string;
}

export interface AudioChunk {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: string; // base64 PCM
}

interface UseMicSessionOptions {
  onAudio: (chunk: AudioChunk) => void;
  onError?: (error: string) => void;
}

export function useMicSession({ onAudio, onError }: UseMicSessionOptions) {
  const agentIdRef = useRef<string>('');
  const [streaming, setStreaming] = useState(false);
  const onAudioRef = useRef(onAudio);
  const onErrorRef = useRef(onError);
  const abortRef = useRef<AbortController | null>(null);
  onAudioRef.current = onAudio;
  onErrorRef.current = onError;

  const startSSE = useCallback((agentId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const token = getToken();
    if (!token) return;

    const run = async () => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/media/mic/stream/${agentId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          onErrorRef.current?.(`Mic SSE failed: HTTP ${res.status}`);
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
              if (msg.type === 'mic.data') {
                onAudioRef.current(msg.data);
              } else if (msg.type === 'mic.error') {
                onErrorRef.current?.(msg.data.error);
              }
            } catch { /* skip */ }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          onErrorRef.current?.(`Mic stream interrupted: ${(e as Error).message}`);
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
      type: 'mic.unbind',
      channel: id,
      data: { agentId: id },
      ts: Date.now(),
    });
  }, [stopSSE]);

  const bind = useCallback((agentId: string, deviceIndex: number) => {
    unbind();
    agentIdRef.current = agentId;
    setStreaming(true);

    consoleWs.send({
      type: 'mic.bind',
      channel: agentId,
      data: { agentId, deviceIndex },
      ts: Date.now(),
    });

    startSSE(agentId);
  }, [unbind, startSSE]);

  const disconnect = useCallback(() => {
    unbind();
    agentIdRef.current = '';
  }, [unbind]);

  return { bind, disconnect, streaming };
}
