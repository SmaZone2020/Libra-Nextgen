import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { AudioChunk } from './useMicSession';

interface AudioPlayerProps {
  active: boolean;
}

export interface AudioPlayerHandle {
  playChunk: (chunk: AudioChunk) => void;
  stop: () => void;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ active }, ref) {
    const ctxRef = useRef<AudioContext | null>(null);
    const nextTimeRef = useRef(0);
    const queueRef = useRef<AudioChunk[]>([]);
    const playingRef = useRef(false);

    useImperativeHandle(ref, () => ({
      playChunk(chunk: AudioChunk) {
        if (!active) return;
        queueRef.current.push(chunk);
        if (!playingRef.current) flushQueue();
      },
      stop() {
        queueRef.current = [];
        playingRef.current = false;
        ctxRef.current?.close();
        ctxRef.current = null;
      },
    }));

    const flushQueue = () => {
      if (!active || queueRef.current.length === 0) {
        playingRef.current = false;
        return;
      }
      playingRef.current = true;

      const chunk = queueRef.current.shift()!;

      if (!ctxRef.current) {
        ctxRef.current = new AudioContext({ sampleRate: chunk.sampleRate });
        nextTimeRef.current = ctxRef.current.currentTime;
      }

      const ctx = ctxRef.current;
      if (!ctx) return;
      const raw = atob(chunk.data);
      const len = raw.length;
      const pcm = new Int16Array(len / 2);
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      }

      const floatBuf = Float32Array.from(pcm, v => v / 32768);

      const buf = ctx.createBuffer(chunk.channels, pcm.length, chunk.sampleRate);
      buf.getChannelData(0).set(floatBuf);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);

      const t = Math.max(nextTimeRef.current, ctx.currentTime);
      src.start(t);
      nextTimeRef.current = t + buf.duration;

      src.onended = () => flushQueue();
    };

    useEffect(() => {
      return () => {
        ctxRef.current?.close();
        ctxRef.current = null;
      };
    }, []);

    return null;
  }
);

export default AudioPlayer;
