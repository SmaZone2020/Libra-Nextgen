import type { BuildConfigRequest } from '../types/models';

const STORAGE_KEY = 'libra_build_presets';
const MAX_PRESETS = 5;

export interface BuildPreset {
  id: string;
  label: string;
  savedAt: number;
  config: BuildConfigRequest;
}

function readPresets(): BuildPreset[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePresets(presets: BuildPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

/** 当前配置是否与某预设的配置完全一致（用于去重）。 */
function sameConfig(a: BuildConfigRequest, b: BuildConfigRequest): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 构建成功时记录当前配置为预设（最近 5 个，精确去重）。 */
export function saveBuildPreset(config: BuildConfigRequest): BuildPreset[] {
  const presets = readPresets();
  const entry: BuildPreset = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: `${config.serverHost}:${config.serverPort}`,
    savedAt: Date.now(),
    config,
  };
  const rest = presets.filter((p) => !sameConfig(p.config, config));
  const next = [entry, ...rest].slice(0, MAX_PRESETS);
  writePresets(next);
  return next;
}

/** 读取已保存的构建预设（新的在前）。 */
export function loadBuildPresets(): BuildPreset[] {
  return readPresets();
}
