import { useRef, useImperativeHandle, forwardRef } from 'react';
import type { ScreenDiffBlock } from './useScreenSession';

export interface ScreenCanvasHandle {
  renderKeyframe(width: number, height: number, jpegBase64: string): void;
  renderDiff(blocks: ScreenDiffBlock[]): void;
  clear(): void;
}

export const ScreenCanvas = forwardRef<ScreenCanvasHandle, { className?: string }>(
  function ScreenCanvas({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useImperativeHandle(ref, () => ({
      renderKeyframe(width: number, height: number, jpegBase64: string) {
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        const blob = base64ToBlob(jpegBase64, 'image/jpeg');
        createImageBitmap(blob).then((bmp) => {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
        });
      },

      renderDiff(blocks: ScreenDiffBlock[]) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const promises = blocks.map((block) => {
          const blob = base64ToBlob(block.data, 'image/jpeg');
          return createImageBitmap(blob).then((bmp) => ({ bmp, block }));
        });

        Promise.all(promises).then((items) => {
          requestAnimationFrame(() => {
            for (const { bmp, block } of items) {
              ctx.drawImage(bmp, block.x, block.y, block.w, block.h);
              bmp.close();
            }
          });
        });
      },

      clear() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }}
      />
    );
  }
);

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}
