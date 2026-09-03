import { describe, expect, it } from 'vitest';
import { unwrapTaskOutput } from './taskOutput';

describe('unwrapTaskOutput', () => {
  it('extracts the inner output from the nested agent envelope', () => {
    const raw = '{"output":"1\\r\\n","success":true}';
    expect(unwrapTaskOutput(raw)).toBe('1\r\n');
  });

  it('extracts error text when output is empty', () => {
    const raw = '{"output":"","success":true,"error":"boom"}';
    expect(unwrapTaskOutput(raw)).toBe('boom');
  });

  it('returns plain text as-is (non-JSON module output)', () => {
    expect(unwrapTaskOutput('hello world')).toBe('hello world');
  });

  it('shows nothing for an explicit empty output (no JSON noise)', () => {
    expect(unwrapTaskOutput('{"output":"","success":true}')).toBe('');
  });

  it('returns JSON without output/error fields as-is', () => {
    expect(unwrapTaskOutput('{"status":"destroying"}')).toBe('{"status":"destroying"}');
  });

  it('does not swallow command output that is itself JSON', () => {
    const raw = '{"output":"{\\"a\\":1}","success":true}';
    expect(unwrapTaskOutput(raw)).toBe('{"a":1}');
  });

  it('handles empty input', () => {
    expect(unwrapTaskOutput('')).toBe('');
    expect(unwrapTaskOutput(undefined as unknown as string)).toBe('');
  });

  it('handles GBK-decoded multi-line Chinese output', () => {
    const raw = '{"output":"适配器名称: 以太网\\r\\n","success":true}';
    expect(unwrapTaskOutput(raw)).toBe('适配器名称: 以太网\r\n');
  });
});
