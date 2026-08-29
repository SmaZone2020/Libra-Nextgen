'use client';

/** Justitia 四档权限定义（浏览器持久化，随 SSE 请求提交，后端强制校验）。 */

export type JustitiaTierKey = 'cognitio' | 'arbitrium' | 'imperium' | 'dictatura';

export const JUSTITIA_TIERS: { key: JustitiaTierKey; name: string; desc: string; index: number }[] = [
  {
    key: 'cognitio',
    name: 'Cognitio',
    desc: '仅察不处 · 只读侦查，自主执行',
    index: 0,
  },
  {
    key: 'arbitrium',
    name: 'Arbitrium',
    desc: '衡而断之 · 常规任务，自主并通报',
    index: 1,
  },
  {
    key: 'imperium',
    name: 'Imperium',
    desc: '请命后行 · 高危操作，须人工批准',
    index: 2,
  },
  {
    key: 'dictatura',
    name: 'Dictatura',
    desc: '毋须请命 · 全权行动，仅管理员可启',
    index: 3,
  },
] as const;

/**
 * 档位在 0–100 滑块上的吸附位置（四档：0 / 33 / 66 / 100）。
 * 与 JUSTITIA_TIERS 数组顺序一一对应。
 */
export const JUSTITIA_TIER_VALUES = [0, 33, 66, 100] as const;

/** 将任意 0–100 数值吸附到最近档位位置（自由拖动结束后调用）。 */
export function snapJustitiaValue(value: number): (typeof JUSTITIA_TIER_VALUES)[number] {
  let best: (typeof JUSTITIA_TIER_VALUES)[number] = JUSTITIA_TIER_VALUES[0];
  for (const pos of JUSTITIA_TIER_VALUES) {
    if (Math.abs(pos - value) < Math.abs(best - value)) best = pos;
  }
  return best;
}

const STORAGE_KEY = 'justitia.tier';

export function loadJustitiaTier(): JustitiaTierKey {
  const v = localStorage.getItem(STORAGE_KEY);
  return (v as JustitiaTierKey) || 'cognitio';
}

export function saveJustitiaTier(tier: JustitiaTierKey): void {
  localStorage.setItem(STORAGE_KEY, tier);
}
