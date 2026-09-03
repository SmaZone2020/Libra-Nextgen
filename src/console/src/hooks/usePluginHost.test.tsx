import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable mock state shared with the hoisted vi.mock factories.
const mocks = vi.hoisted(() => ({
  selectedAgent: { id: 'agent-1', status: 'Online' as const },
  selectAgent: vi.fn(),
  invokePluginAction: vi.fn(),
  onAnyHandlers: [] as Array<(msg: unknown) => void>,
}));

vi.mock('../contexts/AgentContext', () => ({
  useAgent: () => ({
    selectedAgent: mocks.selectedAgent,
    selectAgent: mocks.selectAgent,
  }),
}));

vi.mock('../ws/consoleWs', () => ({
  consoleWs: {
    onAny: vi.fn((handler: (msg: unknown) => void) => {
      mocks.onAnyHandlers.push(handler);
      return () => {
        const i = mocks.onAnyHandlers.indexOf(handler);
        if (i >= 0) mocks.onAnyHandlers.splice(i, 1);
      };
    }),
  },
}));

vi.mock('../api/plugins', () => ({
  invokePluginAction: (...args: unknown[]) => mocks.invokePluginAction(...args),
}));

import { usePluginHost } from './usePluginHost';

function pushWsMessage(msg: unknown) {
  act(() => {
    mocks.onAnyHandlers.forEach((h) => h(msg));
  });
}

describe('usePluginHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onAnyHandlers.length = 0;
    mocks.invokePluginAction.mockResolvedValue({ pluginId: 'p1', action: 'run', result: '{"ok":true}' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches a task to the selected agent and parses JSON string results', async () => {
    const { result } = renderHook(() => usePluginHost());

    await act(async () => {
      const res = await result.current.dispatchTask('p1', 'run', { cmd: 'ls' });
      expect(res).toEqual({ pluginId: 'p1', action: 'run', result: { ok: true } });
    });

    expect(mocks.invokePluginAction).toHaveBeenCalledWith('p1', 'run', 'agent-1', { cmd: 'ls' });
  });

  it('keeps plain-text results as strings', async () => {
    mocks.invokePluginAction.mockResolvedValue({ pluginId: 'p1', action: 'run', result: 'hello world' });
    const { result } = renderHook(() => usePluginHost());

    await act(async () => {
      const res = await result.current.dispatchTask('p1', 'run');
      expect(res.result).toBe('hello world');
    });
  });

  it('throws when no agent is selected', async () => {
    mocks.selectedAgent = null as never;
    const { result } = renderHook(() => usePluginHost());

    await expect(result.current.dispatchTask('p1', 'run')).rejects.toThrow('No agent selected');
  });

  it('collects plugin.result messages and filters by action', async () => {
    const { result } = renderHook(() => usePluginHost());
    const seen: Array<{ action: string; data: unknown }> = [];
    act(() => {
      result.current.subscribeOutput((out) => seen.push({ action: out.action, data: out.data }), 'run');
    });

    pushWsMessage({
      type: 'plugin.result',
      channel: 'agent-1',
      ts: 123,
      data: { action: 'run', output: 'x' },
    });
    pushWsMessage({
      type: 'plugin.result',
      channel: 'agent-1',
      ts: 124,
      data: { action: 'other', output: 'ignored' },
    });

    expect(seen).toEqual([{ action: 'run', data: { action: 'run', output: 'x' } }]);
    expect(result.current.lastOutput?.action).toBe('other');
  });

  it('unsubscribing stops delivery', async () => {
    const { result } = renderHook(() => usePluginHost());
    const seen: unknown[] = [];
    act(() => {
      const unsub = result.current.subscribeOutput((out) => seen.push(out));
      unsub();
    });

    pushWsMessage({ type: 'plugin.result', channel: 'agent-1', ts: 1, data: { action: 'run' } });
    expect(seen).toEqual([]);
  });
});
