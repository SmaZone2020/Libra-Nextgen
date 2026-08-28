'use client';

/** 解析模型名显示信息：`deepseek-ai/deepseek-v4-flash:free` → 厂商/名称/是否免费/最新版/批量。
 *  仅影响显示；选中值仍使用原始模型 id（含 /、~、:free、:batch 后缀）。 */
export function parseModelLabel(raw: string): {
  vendor?: string;
  name: string;
  isFree: boolean;
  isLatest: boolean;
  isBatch: boolean;
} {
  let s = raw;
  let isFree = false;
  let isLatest = false;
  let isBatch = false;
  if (s.endsWith(':free')) {
    isFree = true;
    s = s.slice(0, -':free'.length);
  }
  if (s.endsWith(':batch')) {
    isBatch = true;
    s = s.slice(0, -':batch'.length);
  }
  if (s.startsWith('~')) {
    isLatest = true;
    s = s.slice(1);
  }
  const slash = s.indexOf('/');
  if (slash > 0) {
    return { vendor: s.slice(0, slash), name: s.slice(slash + 1), isFree, isLatest, isBatch };
  }
  return { name: s, isFree, isLatest, isBatch };
}

/** 连字符/下划线转空格，每词首字母大写：`deepseek-ai` → `Deepseek AI`。 */
export function titleCaseWords(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** 触发器中展示的模型名：隐藏厂商前缀与 :free/:batch 后缀，并按单词美化。 */
export function formatModelDisplay(raw: string): string {
  const { name } = parseModelLabel(raw);
  return name ? titleCaseWords(name) : raw;
}
