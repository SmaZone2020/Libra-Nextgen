'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@heroui/react';
import { Check, Picture, Xmark } from '@gravity-ui/icons';
import {
  WALLPAPER_BLUR_MAX,
  WALLPAPER_FROST_MAX,
  WALLPAPER_PRESETS,
  applyWallpaperPrefs,
  applyWallpaperVarsTo,
  isWallpaperEnabled,
  loadWallpaperPrefs,
  resetWallpaperPrefs,
  type WallpaperPrefs,
} from '../../utils/wallpaper';

const FROST_SCALE_MAX = Math.round(WALLPAPER_FROST_MAX * 100);

function percent(v: number, min: number, max: number): string {
  return `${Math.round(((v - min) / (max - min)) * 100)}%`;
}

/** Canvas-downscale the picked image to at most 1920px wide (JPEG data-url). */
function downscaleImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 1920 / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('image decode failed'));
    };
    img.src = objectUrl;
  });
}

function RangeRow({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  valueText,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  valueText: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="lw-range-label">
          {label}
        </label>
        <span className="lw-range-value">{valueText}</span>
      </div>
      <input
        id={id}
        type="range"
        className="lw-range"
        style={{ '--lw-range-pct': percent(value, min, max) } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function AppearanceTab() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<WallpaperPrefs>(() => loadWallpaperPrefs());
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const enabled = isWallpaperEnabled(prefs);

  // Live preview mirrors the same CSS variables the app frame consumes.
  useEffect(() => {
    if (previewRef.current) applyWallpaperVarsTo(previewRef.current, prefs);
  }, [prefs]);

  const commit = (next: WallpaperPrefs) => {
    setPrefs(next);
    applyWallpaperPrefs(next);
  };

  const pickPreset = (id: WallpaperPrefs['presetId']) => {
    setUploadError(null);
    if (id === 'custom') {
      fileRef.current?.click();
      return;
    }
    // Switching to a bundled/none preset drops the uploaded image.
    commit({ ...prefs, presetId: id, customUrl: null });
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await downscaleImageFile(file);
      setUploadError(null);
      commit({ ...prefs, presetId: 'custom', customUrl: dataUrl });
    } catch {
      setUploadError(t('settings.wallpaper.uploadFailed'));
    }
  };

  const handleReset = () => {
    resetWallpaperPrefs();
    setPrefs(loadWallpaperPrefs());
  };

  const selectedLabel = enabled
    ? prefs.presetId === 'custom'
      ? t('settings.wallpaper.custom')
      : t(`settings.wallpaper.preset.${prefs.presetId}`)
    : t('settings.wallpaper.none');

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.wallpaper.title')}</h3>
            <p className="mt-1 max-w-2xl text-sm text-default-500">
              {t('settings.wallpaper.desc')}
            </p>
          </div>
          <Button size="sm" variant="ghost" onPress={handleReset}>
            {t('settings.wallpaper.reset')}
          </Button>
        </div>

        {/* Live scene preview */}
        <div ref={previewRef} className="lw-preview-scene mt-5 h-44 sm:h-56" aria-hidden="true">
          <div className="relative z-10 flex h-full flex-col justify-end p-5 opacity-95">
            <div className="mx-auto h-full max-h-24 w-full max-w-md rounded-2xl bg-[var(--lw-workspace-solid)] shadow-lg shadow-black/10 sm:max-h-28" />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">{t('settings.wallpaper.source')}</h3>
            <p className="mt-1 text-sm text-default-500">
              {t('settings.appearanceDesc')}
            </p>
          </div>
          <span className="rounded-full bg-default/10 px-3 py-1 text-xs font-medium text-foreground">
            {selectedLabel}
          </span>
        </div>

        {/* Source grid: none / bundled presets / custom upload */}
        <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
          <button
            type="button"
            aria-pressed={!enabled}
            onClick={() => pickPreset('none')}
            className="lw-wall-opt lw-wall-opt--none"
          >
            {!enabled && <Check className="size-4" />}
            <span>{t('settings.wallpaper.none')}</span>
          </button>
          {WALLPAPER_PRESETS.map((preset) => {
            const selected = enabled && prefs.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                aria-label={t(`settings.wallpaper.preset.${preset.id}`)}
                onClick={() => pickPreset(preset.id)}
                className="lw-wall-opt"
              >
                <img src={preset.url} alt="" loading="lazy" />
                {selected && (
                  <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-accent-foreground shadow">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={enabled && prefs.presetId === 'custom'}
            onClick={() => pickPreset('custom')}
            className="lw-wall-opt lw-wall-opt--none"
          >
            {enabled && prefs.presetId === 'custom' ? (
              <img src={prefs.customUrl ?? ''} alt="" loading="lazy" />
            ) : (
              <>
                <Picture className="size-5" />
                <span>{t('settings.wallpaper.upload')}</span>
              </>
            )}
            {enabled && prefs.presetId === 'custom' && (
              <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-accent-foreground shadow">
                <Check className="size-3" />
              </span>
            )}
          </button>
        </div>
        <p className="mt-2 text-xs text-default-400">{t('settings.wallpaper.uploadHint')}</p>
        {uploadError && <p className="mt-1 text-xs text-danger">{uploadError}</p>}
        {prefs.presetId === 'custom' && prefs.customUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-3 gap-1.5 text-xs text-danger"
            onPress={() => commit({ ...prefs, presetId: 'none', customUrl: null })}
          >
            <Xmark className="size-4" />
            {t('settings.wallpaper.removeImage')}
          </Button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />

        {/* Effect sliders */}
        <div className="mt-8 space-y-6 border-t border-default-100 pt-6 dark:border-default-800">
          <RangeRow
            id="wallpaper-blur"
            label={t('settings.wallpaper.blur')}
            value={Math.round(prefs.blur)}
            min={0}
            max={WALLPAPER_BLUR_MAX}
            valueText={`${Math.round(prefs.blur)} px`}
            disabled={!enabled}
            onChange={(v) => commit({ ...prefs, blur: v })}
          />
          <RangeRow
            id="wallpaper-dim"
            label={t('settings.wallpaper.dim')}
            value={Math.round(prefs.dim * 100)}
            min={0}
            max={100}
            valueText={`${Math.round(prefs.dim * 100)}%`}
            disabled={!enabled}
            onChange={(v) => commit({ ...prefs, dim: v / 100 })}
          />
          <RangeRow
            id="wallpaper-frost"
            label={t('settings.wallpaper.frost')}
            value={Math.round(prefs.frost * 100)}
            min={0}
            max={FROST_SCALE_MAX}
            valueText={`${Math.round(prefs.frost * 100)}%`}
            disabled={!enabled}
            onChange={(v) => commit({ ...prefs, frost: v / 100 })}
          />
          <p className="text-xs text-default-400">{t('settings.wallpaper.hint')}</p>
        </div>
      </Card>
    </div>
  );
}
