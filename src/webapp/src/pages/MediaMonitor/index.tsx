import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ListBox, Select } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { getToken } from '../../api/client';
import { useCameraSession } from './useCameraSession';
import { useMicSession } from './useMicSession';
import type { CameraDevice } from './useCameraSession';
import type { MicDevice } from './useMicSession';
import AudioPlayer from './AudioPlayer';
import type { AudioPlayerHandle } from './AudioPlayer';
import type { AudioChunk } from './useMicSession';

const API_BASE = 'http://127.0.0.1:5270';

const FPS_OPTIONS = [
  { id: '5', label: '5 FPS' },
  { id: '10', label: '10 FPS' },
  { id: '15', label: '15 FPS' },
  { id: '20', label: '20 FPS' },
  { id: '30', label: '30 FPS' },
];

export default function MediaMonitorPage() {
  const { agentId } = useAgent();
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioPlayerHandle>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const audioActiveRef = useRef(false);

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [micIndex, setMicIndex] = useState(0);
  const [fps, setFps] = useState(10);

  // ── Fetch devices ───────────────────────────────────────────────────────
  const fetchDevices = useCallback(async (agentId: string) => {
    const token = getToken();
    if (!token) return;

    try {
      const camRes = await fetch(`${API_BASE}/api/media/camera/devices/${agentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (camRes.ok) {
        const camJson = await camRes.json();
        const camData = Array.isArray(camJson) ? camJson : (camJson.data ?? []);
        setCameras(camData);
        if (camData.length > 0) setCameraIndex(0);
      }
    } catch { }

    try {
      const micRes = await fetch(`${API_BASE}/api/media/mic/devices/${agentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (micRes.ok) {
        const micJson = await micRes.json();
        const micData = Array.isArray(micJson) ? micJson : (micJson.data ?? []);
        setMics(micData);
        if (micData.length > 0) setMicIndex(0);
      }
    } catch { }
  }, []);

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
      fetchDevices(agentId);
    } else {
      audioActiveRef.current = false;
      audioRef.current?.stop();
      cameraDisconnect();
      micDisconnect();
      setCameras([]);
      setMics([]);
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

  const noCamera = cameras.length === 0;
  const noMic = mics.length === 0;

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-180px)]">
      {/* Camera Section */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <h2 className="text-sm font-semibold text-neutral-700">Camera</h2>

          <Select
            selectedKey={String(cameraIndex)}
            onSelectionChange={
              cameraStreaming ? undefined : (key) => key && setCameraIndex(Number(key))
            }
            isDisabled={cameraStreaming || noCamera}
            className="w-[180px]"
            aria-label="Camera device"
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {cameras.map((c) => (
                  <ListBox.Item key={String(c.index)} id={String(c.index)} textValue={c.name}>
                    {c.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Select
            selectedKey={String(fps)}
            onSelectionChange={
              cameraStreaming ? undefined : (key) => key && setFps(Number(key))
            }
            className="w-[110px]"
            aria-label="Camera FPS"
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

          <span className={`w-2 h-2 rounded-full ${cameraStreaming ? 'bg-green-500' : 'bg-neutral-300'}`} />
          <span className="text-xs text-default-400">
            {cameraStreaming ? 'Streaming' : 'Stopped'}
          </span>
          {cameraStreaming ? (
            <Button size="sm" variant="tertiary" onPress={() => cameraDisconnect()}>Stop</Button>
          ) : (
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={noCamera}
              onPress={() => cameraBind(agentId, cameraIndex, { fps })}
            >
              Start
            </Button>
          )}
          {cameraError && <span className="text-xs text-red-500">{cameraError}</span>}
        </div>
        <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-neutral-200 bg-black flex items-center justify-center">
          {noCamera && !cameraStreaming ? (
            <span className="text-neutral-500 text-sm">No camera found</span>
          ) : (
            <canvas ref={cameraCanvasRef} className="max-w-full max-h-full object-contain" />
          )}
        </div>
      </div>

      {/* Mic Section */}
      <div className="h-[80px] shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-neutral-700">Microphone</h2>

          <Select
            selectedKey={String(micIndex)}
            onSelectionChange={
              micStreaming ? undefined : (key) => key && setMicIndex(Number(key))
            }
            isDisabled={micStreaming || noMic}
            className="w-[200px]"
            aria-label="Mic device"
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {mics.map((m) => (
                  <ListBox.Item key={String(m.index)} id={String(m.index)} textValue={m.name}>
                    {m.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <span className={`w-2 h-2 rounded-full ${micStreaming ? 'bg-green-500' : 'bg-neutral-300'}`} />
          <span className="text-xs text-default-400">
            {micStreaming ? 'Streaming' : 'Stopped'}
          </span>
          {micStreaming ? (
            <Button size="sm" variant="tertiary" onPress={() => { audioRef.current?.stop(); micDisconnect(); }}>Stop</Button>
          ) : (
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={noMic}
              onPress={() => { audioActiveRef.current = true; micBind(agentId, micIndex); }}
            >
              Start
            </Button>
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
