import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Selection } from '@heroui/react';
import { Button, Dropdown, Label } from '@heroui/react';
import { useAgent } from '../../contexts/AgentContext';
import { api } from '../../api/client';
import { useCameraSession } from './useCameraSession';
import { useMicSession } from './useMicSession';
import type { CameraDevice, CameraFrame } from './useCameraSession';
import type { MicDevice } from './useMicSession';
import AudioPlayer from './AudioPlayer';
import type { AudioPlayerHandle } from './AudioPlayer';
import type { AudioChunk } from './useMicSession';

export default function MediaMonitorPage() {
  const { t } = useTranslation();
  const { agentId, selectedAgent } = useAgent();
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

  const [selectedMic, setSelectedMic] = useState<Selection>(new Set(['0']));
  const [selectedCamera, setSelectedCamera] = useState<Selection>(new Set(['0']));
  const [selectedFps, setSelectedFps] = useState<Selection>(new Set(['10']));

  const FPS_OPTIONS = [
    { id: '5', label: t('mediaMonitor.fps.5') },
    { id: '10', label: t('mediaMonitor.fps.10') },
    { id: '15', label: t('mediaMonitor.fps.15') },
    { id: '20', label: t('mediaMonitor.fps.20') },
    { id: '30', label: t('mediaMonitor.fps.30') },
  ];

  // ── Fetch devices ───────────────────────────────────────────────────────
  const fetchDevices = useCallback(async (agentId: string) => {
    console.log('[MediaMonitor] Fetching camera devices...');
    try {
      const raw = await api.get<CameraDevice[] | CameraDevice>(`/media/camera/devices/${agentId}`);
      const cams: CameraDevice[] = Array.isArray(raw) ? raw
        : (raw as any)?.data ? (raw as any).data
        : raw ? [raw as CameraDevice]
        : [];
      console.log('[MediaMonitor] Camera devices:', cams);
      setCameras(cams);
      if (cams.length > 0) {
        setCameraIndex(0);
        setSelectedCamera(new Set(['0']));
      }
    } catch (e) {
      console.warn('[MediaMonitor] Camera devices fetch failed:', e);
    }

    console.log('[MediaMonitor] Fetching mic devices...');
    try {
      const raw = await api.get<MicDevice[] | MicDevice>(`/media/mic/devices/${agentId}`);
      const mics: MicDevice[] = Array.isArray(raw) ? raw
        : (raw as any)?.data ? (raw as any).data
        : raw ? [raw as MicDevice]
        : [];
      console.log('[MediaMonitor] Mic devices:', mics);
      setMics(mics);
      if (mics.length > 0) {
        setMicIndex(0);
        setSelectedMic(new Set(['0']));
      }
    } catch (e) {
      console.warn('[MediaMonitor] Mic devices fetch failed:', e);
    }
  }, []);

  // ── Camera ──────────────────────────────────────────────────────────────
  const onCameraFrame = useCallback((frame: CameraFrame) => {
    const canvas = cameraCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (frame.type === 'keyframe') {
      const img = new Image();
      img.onload = () => {
        if (frame.width && frame.height) {
          canvas.width = frame.width;
          canvas.height = frame.height;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        ctx.drawImage(img, 0, 0);
      };
      img.src = `data:image/jpeg;base64,${frame.data}`;
    } else if (frame.type === 'diff') {
      for (const block of frame.blocks) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, block.x, block.y);
        };
        img.src = `data:image/jpeg;base64,${block.data}`;
      }
    }
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
        {t('mediaMonitor.selectAgent')}
      </div>
    );
  }

  // Camera/mic streaming is Windows-only; hide the whole module for Linux
  // agents. On Windows, hide each section when no matching device exists.
  const isLinux = selectedAgent?.osVersion?.toLowerCase().includes('linux');
  if (isLinux) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        {t('mediaMonitor.linuxUnsupported')}
      </div>
    );
  }

  const noCamera = cameras.length === 0;
  const noMic = mics.length === 0;

  if (noCamera && noMic) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        {t('mediaMonitor.noDevices')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-180px)]">

      {/* Mic Section */}
      {!noMic && (
      <div className="h-[80px] shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-neutral-700">{t('mediaMonitor.microphone')}</h2>

          <Dropdown>
            <Button
              variant="secondary"
              isDisabled={micStreaming || noMic}
            >
              {mics.find((m) => String(m.index) === [...selectedMic][0])?.name || t('mediaMonitor.microphone')}
            </Button>
            <Dropdown.Popover className="min-w-[200px]">
              <Dropdown.Menu
                selectedKeys={selectedMic}
                selectionMode="single"
                disabledKeys={micStreaming ? [...selectedMic] : []}
                onSelectionChange={(sel) => {
                  if (micStreaming) return;
                  setSelectedMic(sel);
                  const key = [...sel][0];
                  if (key != null) setMicIndex(Number(key));
                }}
              >
                <Dropdown.Section>
                  {mics.map((m) => (
                    <Dropdown.Item key={String(m.index)} id={String(m.index)} textValue={m.name}>
                      <Dropdown.ItemIndicator />
                      <Label>{m.name}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Section>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          <span className={`w-2 h-2 rounded-full ${micStreaming ? 'bg-green-500' : 'bg-neutral-300'}`} />
          <span className="text-xs text-default-400">
            {micStreaming ? t('mediaMonitor.streaming') : t('mediaMonitor.stopped')}
          </span>
          {micStreaming ? (
            <Button size="sm" variant="tertiary" onPress={() => { audioRef.current?.stop(); micDisconnect(); }}>{t('common.stop')}</Button>
          ) : (
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={noMic}
              onPress={() => { audioActiveRef.current = true; micBind(agentId, micIndex); }}
            >
              {t('common.start')}
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
          {micStreaming ? <span>{t('mediaMonitor.receivingAudio')}</span> : <span>{t('mediaMonitor.micStopped')}</span>}
        </div>
      </div>
      )}

      <AudioPlayer ref={audioRef} active={audioActiveRef.current} />

      {/* Camera Section */}
      {!noCamera && (
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <h2 className="text-sm font-semibold text-neutral-700">{t('mediaMonitor.camera')}</h2>

          <Dropdown>
            <Button
              variant="secondary"
              isDisabled={cameraStreaming || noCamera}
            >
              {cameras.find((c) => String(c.index) === [...selectedCamera][0])?.name || t('mediaMonitor.camera')}
            </Button>
            <Dropdown.Popover className="min-w-[200px]">
              <Dropdown.Menu
                selectedKeys={selectedCamera}
                selectionMode="single"
                disabledKeys={cameraStreaming ? [...selectedCamera] : []}
                onSelectionChange={(sel) => {
                  if (cameraStreaming) return;
                  setSelectedCamera(sel);
                  const key = [...sel][0];
                  if (key != null) setCameraIndex(Number(key));
                }}
              >
                <Dropdown.Section>
                  {cameras.map((c) => (
                    <Dropdown.Item key={String(c.index)} id={String(c.index)} textValue={c.name}>
                      <Dropdown.ItemIndicator />
                      <Label>{c.name}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Section>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          <Dropdown>
            <Button
              variant="secondary"
              isDisabled={cameraStreaming}
            >
              {FPS_OPTIONS.find((o) => o.id === [...selectedFps][0])?.label || t('screenMonitor.frameRate')}
            </Button>
            <Dropdown.Popover className="min-w-[160px]">
              <Dropdown.Menu
                selectedKeys={selectedFps}
                selectionMode="single"
                disabledKeys={cameraStreaming ? [...selectedFps] : []}
                onSelectionChange={(sel) => {
                  if (cameraStreaming) return;
                  setSelectedFps(sel);
                  const key = [...sel][0];
                  if (key) setFps(Number(key));
                }}
              >
                <Dropdown.Section>
                  {FPS_OPTIONS.map((opt) => (
                    <Dropdown.Item key={opt.id} id={opt.id} textValue={opt.label}>
                      <Dropdown.ItemIndicator />
                      <Label>{opt.label}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Section>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          <span className={`w-2 h-2 rounded-full ${cameraStreaming ? 'bg-green-500' : 'bg-neutral-300'}`} />
          <span className="text-xs text-default-400">
            {cameraStreaming ? t('mediaMonitor.streaming') : t('mediaMonitor.stopped')}
          </span>
          {cameraStreaming ? (
            <Button size="sm" variant="tertiary" onPress={() => cameraDisconnect()}>{t('common.stop')}</Button>
          ) : (
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={noCamera}
              onPress={() => cameraBind(agentId, cameraIndex, { fps })}
            >
              {t('common.start')}
            </Button>
          )}
          {cameraError && <span className="text-xs text-red-500">{cameraError}</span>}
        </div>
        <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-neutral-700 bg-neutral-900 flex items-center justify-center">
          {cameraStreaming ? (
            <canvas ref={cameraCanvasRef} className="max-w-full max-h-full object-contain" />
          ) : noCamera ? (
            <span className="text-neutral-500 text-sm select-none">{t('mediaMonitor.noCamera')}</span>
          ) : (
            <span className="text-neutral-500 text-sm select-none">{t('mediaMonitor.cameraStopped')}</span>
          )}
        </div>
      </div>
      )}

    </div>
  );
}
