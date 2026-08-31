export function unwrapTaskOutput(raw: string): string {
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.output === 'string' && obj.output.length > 0) return obj.output;
      if (typeof obj.error === 'string' && obj.error.length > 0) return obj.error;
      if (typeof obj.output === 'string') return '';
    }
    return raw;
  } catch {
    return raw;
  }
}
