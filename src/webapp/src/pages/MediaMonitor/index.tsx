import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { useCameraSession } from './useCameraSession';
import { useMicSession } from './useMicSession';
import AudioPlayer from './AudioPlayer';
import type { AudioPlayerHandle } from './AudioPlayer';
import type { AudioChunk } from './useMicSession';

export default function MediaMonitorPage() {
  const { agentId } = useAgent();
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioPlayerHandle>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const audioActiveRef = useRef(false);

  // ── Camera ──────────────────────────────────────────────────────────────
  const onCameraFrame = useCallback((jpegBase64: string) => {
    const canvas = cameraCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${jpegBase64}`;
  }, []);

  const onCameraError = useCallback((err: string) => setCameraError(err), []);

  const {
    bind: cameraBind,
    disconnect: cameraDisconnect,
    streaming: cameraStreaming,
  } = useCameraSession({ onFrame: onCameraFrame, onError: onCameraError });

  // ── Mic ─────────────────────────────────────────────────────────────────
  const onMicAudio = useCallback((chunk: AudioChunk) => {
    audioRef.current?.playChunk(chunk);
  }, []);

  const onMicError = useCallback((err: string) => setMicError(err), []);

  const {
    bind: micBind,
    disconnect: micDisconnect,
    streaming: micStreaming,
  } = useMicSession({ onAudio: onMicAudio, onError: onMicError });

  // ── Lifecycle ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (agentId) {
      setCameraError(null);
      setMicError(null);
      audioActiveRef.current = true;
      cameraBind(agentId);
      micBind(agentId);
    } else {
      audioActiveRef.current = false;
      audioRef.current?.stop();
      cameraDisconnect();
      micDisconnect();
    }
    return () => {
      audioActiveRef.current = false;
      audioRef.current?.stop();
      cameraDisconnect();
      micDisconnect();
    };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!agentId) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        Select an online agent to monitor its camera and microphone.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-180px)]">
      {/* Camera Section */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex items-center gap-3 shrink-0">
          <h2 className="text-sm font-semibold text-neutral-700">Camera</h2>
          <span className={`w-2 h-2 rounded-full ${cameraStreaming ? 'bg-green-500' : 'bg-neutral-300'}`} />
          <span className="text-xs text-default-400">
            {cameraStreaming ? 'Streaming' : 'Stopped'}
          </span>
          {cameraStreaming ? (
            <Button size="sm" variant="tertiary" onPress={() => cameraDisconnect()}>Stop</Button>
          ) : (
            <Button size="sm" variant="tertiary" onPress={() => cameraBind(agentId)}>Start</Button>
          )}
          {cameraError && <span className="text-xs text-red-500">{cameraError}</span>}
        </div>
        <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-neutral-200 bg-black flex items-center justify-center">
          <canvas ref={cameraCanvasRef} className="max-w-full max-h-full object-contain" />
        </div>
      </div>

      {/* Mic Section */}
      <div className="h-[80px] shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-700">Microphone</h2>
          <span className={`w-2 h-2 rounded-full ${micStreaming ? 'bg-green-500' : 'bg-neutral-300'}`} />
          <span className="text-xs text-default-400">
            {micStreaming ? 'Streaming' : 'Stopped'}
          </span>
          {micStreaming ? (
            <Button size="sm" variant="tertiary" onPress={() => { audioRef.current?.stop(); micDisconnect(); }}>Stop</Button>
          ) : (
            <Button size="sm" variant="tertiary" onPress={() => { audioActiveRef.current = true; micBind(agentId); }}>Start</Button>
          )}
          {micError && <span className="text-xs text-red-500">{micError}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="block h-1 flex-1 rounded bg-neutral-200 overflow-hidden">
            <span
              className="block h-full bg-green-500 transition-all duration-75"
              style={{ width: micStreaming ? '100%' : '0%' }}
            />
          </span>
          {micStreaming && <span>Receiving audio...</span>}
        </div>
      </div>

      <AudioPlayer ref={audioRef} active={audioActiveRef.current} />
    </div>
  );
}
