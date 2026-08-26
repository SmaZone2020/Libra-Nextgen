import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgent } from '../contexts/AgentContext';
import { consoleWs } from '../ws/consoleWs';
import { invokePluginAction } from '../api/plugins';
import type { WsMessage } from '../types/models';

export interface PluginOutput {
  /** Raw result data from the agent's plugin.result message. */
  data: unknown;
  /** Agent id that produced this output. */
  agentId: string;
  /** The action this output belongs to (may be empty for untagged output). */
  action: string;
  /** Received timestamp (ms). */
  ts: number;
}

export interface DispatchResult {
  pluginId: string;
  action: string;
  result?: unknown;
}

export interface PluginHost {
  /** Currently selected agent (shared with the console's agent picker). */
  selectedAgent: ReturnType<typeof useAgent>['selectedAgent'];
  /** Select an agent by id (shared with the console). */
  selectAgent: (id: string) => void;
  /**
   * Invoke a plugin action against an agent (defaults to the selected agent).
   * Round-trips through the plugin action gateway and resolves with the result.
   */
  dispatchTask: (
    pluginId: string,
    action: string,
    args?: Record<string, unknown>,
    agentId?: string,
  ) => Promise<DispatchResult>;
  /**
   * Subscribe to live plugin results pushed over WebSocket. Returns an
   * unsubscribe function. Optionally filter by action name.
   */
  subscribeOutput: (onOutput: (out: PluginOutput) => void, action?: string) => () => void;
  /** Latest plugin result received (convenience for simple pages). */
  lastOutput: PluginOutput | null;
}

/**
 * The host API exposed to plugin pages. It reuses the console's AgentContext
 * (agent selection is shared) and the console WebSocket (results are shared),
 * so a plugin page does NOT open its own connection or manage its own agent
 * list — it inherits the parent shell's state.
 */
export function usePluginHost(): PluginHost {
  const { selectedAgent, selectAgent } = useAgent();
  const [lastOutput, setLastOutput] = useState<PluginOutput | null>(null);
  const subscriberIdRef = useRef(0);

  // Centralized listener for `plugin.result` messages pushed from the agent.
  // Each subscribeOutput call registers a filter-backed subscriber under a
  // stable id, so a page can mount/unmount subscribers without leaking.
  const subscribersRef = useRef(new Map<number, { cb: (o: PluginOutput) => void; action?: string }>());

  useEffect(() => {
    const handle = (msg: WsMessage) => {
      if (msg.type !== 'plugin.result') return;
      const data = msg.data as Record<string, unknown> | undefined;
      const out: PluginOutput = {
        data: msg.data,
        agentId: msg.channel || '',
        action: typeof data?.action === 'string' ? data.action : '',
        ts: msg.ts || Date.now(),
      };
      setLastOutput(out);
      subscribersRef.current.forEach(({ cb, action }) => {
        if (!action || action === out.action) cb(out);
      });
    };
    const unsub = consoleWs.onAny(handle);
    return unsub;
  }, []);

  const dispatchTask = useCallback(
    async (
      pluginId: string,
      action: string,
      args?: Record<string, unknown>,
      agentId?: string,
    ): Promise<DispatchResult> => {
      const target = agentId || selectedAgent?.id;
      if (!target) throw new Error('No agent selected');
      const res = await invokePluginAction(pluginId, action, target, args);
      // 服务端把 agent 的插件输出（plugin.result）序列化为 JSON 字符串透传，
      // 这里统一反序列化：result 为对象/数组/标量时原样保留，字符串按 JSON 尝试解析，
      // 解析失败（普通文本输出）则保留原字符串——页面无需区分字符串与对象两种形态。
      const raw = res.result;
      let result: unknown = raw;
      if (typeof raw === 'string' && raw.trim().length > 0) {
        try {
          result = JSON.parse(raw);
        } catch {
          /* 非 JSON 文本输出，原样透传 */
        }
      }
      return { ...res, result };
    },
    [selectedAgent],
  );

  const subscribeOutput = useCallback(
    (onOutput: (out: PluginOutput) => void, action?: string): (() => void) => {
      const id = ++subscriberIdRef.current;
      subscribersRef.current.set(id, { cb: onOutput, action });
      return () => {
        subscribersRef.current.delete(id);
      };
    },
    [],
  );

  return useMemo(
    () => ({ selectedAgent, selectAgent, dispatchTask, subscribeOutput, lastOutput }),
    [selectedAgent, selectAgent, dispatchTask, subscribeOutput, lastOutput],
  );
}
