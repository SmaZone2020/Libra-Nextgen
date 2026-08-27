/**
 * 任务结果解包：agent 上报的 task.output 是嵌套 JSON 字符串
 * （模块返回 `{"output":"<命令输出>","success":true}` 被 wrap_result 原样
 * 存入 output 字段）。解析出内层文本用于终端展示。
 *
 * 兼容性：
 * - 非 JSON（旧模块直接返回纯文本）→ 原样返回
 * - JSON 但无 output/error 字段（如 {"status":"..."}）→ 原样返回
 * - 命令输出本身是合法 JSON（如 `echo {"a":1}`）→ 外层解析后无 output
 *   字段，原样返回，不会误吞
 */
export function unwrapTaskOutput(raw: string): string {
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      // 非空 output 优先；output 显式为空时若 error 有值则用 error，
      // 否则视为"命令执行成功但无输出"（显示空，不打印 JSON 噪音）。
      if (typeof obj.output === 'string' && obj.output.length > 0) return obj.output;
      if (typeof obj.error === 'string' && obj.error.length > 0) return obj.error;
      if (typeof obj.output === 'string') return '';
    }
    return raw;
  } catch {
    return raw;
  }
}
