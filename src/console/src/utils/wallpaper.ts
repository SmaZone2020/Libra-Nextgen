import { useEffect, useState } from 'react';

/**
 * Wallpaper preferences — appearance layer on top of the workspace layout.
 *
 * Values are persisted in localStorage and mirrored onto CSS custom
 * properties consumed by styles/workspace.css:
 *
 *   --lw-wall-img     url() of the wallpaper image (or `none`)
 *   --lw-wall-blur    blur radius applied to the wallpaper layer
 *   --lw-veil-opacity theme-tinted readability veil over the wallpaper
 *   --lw-frost        UI translucency (0 = opaque workspace, 1 = glass)
 *
 * The `frost` control is what makes the wallpaper feel like part of the UI:
 * the workspace surface becomes translucent and blurs whatever sits behind
 * it via backdrop-filter.
 */

export const WALLPAPER_STORAGE_KEY = 'libra.wallpaper';
export const WALLPAPER_EVENT = 'libra:wallpaper';

export type WallpaperPresetId = 'none' | 'custom' | 'aurora' | 'dusk' | 'graphite' | 'dawn' | 'mist';

export interface WallpaperPreset {
  id: Exclude<WallpaperPresetId, 'none' | 'custom'>;
  url: string;
}

export interface WallpaperPrefs {
  /** Selected source: a bundled preset, a user-uploaded image, or none. */
  presetId: WallpaperPresetId;
  /** data-URL produced by the settings uploader (canvas-downscaled). */
  customUrl: string | null;
  /** Blur applied to the wallpaper layer, px (0-40). */
  blur: number;
  /** Readability veil over the wallpaper, 0-1. */
  dim: number;
  /** UI translucency / glass level, 0-1. */
  frost: number;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: 'aurora', url: `${import.meta.env.BASE_URL}wallpapers/aurora.svg` },
  { id: 'dusk', url: `${import.meta.env.BASE_URL}wallpapers/dusk.svg` },
  { id: 'graphite', url: `${import.meta.env.BASE_URL}wallpapers/graphite.svg` },
  { id: 'dawn', url: `${import.meta.env.BASE_URL}wallpapers/dawn.svg` },
  { id: 'mist', url: `${import.meta.env.BASE_URL}wallpapers/mist.svg` },
];

export const WALLPAPER_BLUR_MAX = 40;
export const WALLPAPER_FROST_MAX = 0.8;

export function wallpaperImageUrl(p: WallpaperPrefs): string | null {
  if (p.presetId === 'custom' && p.customUrl) return p.customUrl;
  if (p.presetId === 'none' || p.presetId === 'custom') return null;
  return WALLPAPER_PRESETS.find((x) => x.id === p.presetId)?.url ?? null;
}

export function isWallpaperEnabled(p: WallpaperPrefs): boolean {
  return wallpaperImageUrl(p) !== null;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function defaultWallpaperPrefs(): WallpaperPrefs {
  return { presetId: 'none', customUrl: null, blur: 14, dim: 0.5, frost: 0.55 };
}

export function loadWallpaperPrefs(): WallpaperPrefs {
  const d = defaultWallpaperPrefs();
  if (typeof window === 'undefined') return d;
  try {
    const raw = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<WallpaperPrefs>;
    const presets = new Set(WALLPAPER_PRESETS.map((p) => p.id));
    const presetId =
      parsed.presetId === 'none' || parsed.presetId === 'custom' || presets.has(parsed.presetId as never)
        ? (parsed.presetId as WallpaperPrefs['presetId'])
        : d.presetId;
    return {
      presetId,
      customUrl: typeof parsed.customUrl === 'string' ? parsed.customUrl : d.customUrl,
      blur: clamp(Number(parsed.blur) || d.blur, 0, WALLPAPER_BLUR_MAX),
      dim: clamp(Number(parsed.dim) || d.dim, 0, 1),
      frost: clamp(Number(parsed.frost) || d.frost, 0, WALLPAPER_FROST_MAX),
    };
  } catch {
    return d;
  }
}

/** Stores prefs and mirrors them onto the document root. */
export function applyWallpaperPrefs(p: WallpaperPrefs): void {
  const enabled = isWallpaperEnabled(p);
  const url = wallpaperImageUrl(p);
  const root = document.documentElement;
  root.setAttribute('data-wallpaper', enabled ? 'on' : 'off');
  root.style.setProperty('--lw-wall-img', url ? `url("${url}")` : 'none');
  root.style.setProperty('--lw-wall-blur', `${clamp(p.blur, 0, WALLPAPER_BLUR_MAX)}px`);
  root.style.setProperty('--lw-wall-opacity', '1');
  // Veil floor keeps text readable even with dim = 0.
  const veil = enabled ? 0.34 + clamp(p.dim, 0, 1) * 0.6 : 0;
  root.style.setProperty('--lw-veil-opacity', String(clamp(veil, 0, 0.94)));
  root.style.setProperty('--lw-frost', String(clamp(p.frost, 0, WALLPAPER_FROST_MAX)));
  try {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage full/blocked — in-memory only for this session */
  }
  window.dispatchEvent(new Event(WALLPAPER_EVENT));
}

/** Mirrors wallpaper vars onto a specific element (used by the settings preview). */
export function applyWallpaperVarsTo(el: HTMLElement, p: WallpaperPrefs): void {
  const url = wallpaperImageUrl(p);
  el.style.setProperty('--lw-wall-img', url ? `url("${url}")` : 'none');
  el.style.setProperty('--lw-wall-blur', `${clamp(p.blur, 0, WALLPAPER_BLUR_MAX)}px`);
  const veil = url ? 0.34 + clamp(p.dim, 0, 1) * 0.6 : 0;
  el.style.setProperty('--lw-veil-opacity', String(clamp(veil, 0, 0.94)));
}

/** Reset to the shipped default (no wallpaper). */
export function resetWallpaperPrefs(): void {
  try {
    localStorage.removeItem(WALLPAPER_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  applyWallpaperPrefs(defaultWallpaperPrefs());
}

export function initWallpaper(): void {
  applyWallpaperPrefs(loadWallpaperPrefs());
}

/** Reactive prefs shared between the layout and the settings page. */
export function useWallpaperPrefs(): WallpaperPrefs {
  const [prefs, setPrefs] = useState<WallpaperPrefs>(() => loadWallpaperPrefs());
  useEffect(() => {
    const sync = () => setPrefs(loadWallpaperPrefs());
    window.addEventListener(WALLPAPER_EVENT, sync);
    return () => window.removeEventListener(WALLPAPER_EVENT, sync);
  }, []);
  return prefs;
}
