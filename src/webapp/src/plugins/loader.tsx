import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api, getApiOrigin } from '../api/client';
import { usePluginHost, type PluginOutput } from '../hooks/usePluginHost';

/**
 * Runtime plugin page renderer — HTML form only.
 *
 * Every plugin page ships as plain `page/index.html` + js/css (no TSX, no
 * HeroUI). The console loads it in an iframe pointed at the backend:
 *   /api/plugins/<id>/page/index.html
 * The plugin talks to the console through the postMessage bridge served at
 * page/_bridge.js, which exposes window.LibraPluginHost:
 *   usePluginHost()  → { selectedAgent, lastOutput, selectAgent,
 *                        dispatchTask, subscribeOutput }
 *   api.get/post/put/delete(path, body?)  → authenticated backend calls
 *   getApiOrigin()   → backend origin (same as the iframe's own origin)
 *
 * dev and preview behave identically; installing/updating a plugin only
 * requires new files on the server.
 */

export interface PluginPageSpec {
  pluginId: string;
  kind: 'html';
  entry: string;
  version: string;
}

function pageBase(pluginId: string): string {
  return `${getApiOrigin()}/api/plugins/${encodeURIComponent(pluginId)}/page`;
}

function HtmlPluginFrame({ spec }: { spec: PluginPageSpec }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const host = usePluginHost();
  const src = `${pageBase(spec.pluginId)}/${spec.entry}?v=${encodeURIComponent(spec.version)}`;
  const frameOrigin = useMemo(() => new URL(src).origin, [src]);
  const hostRef = useRef(host);
  hostRef.current = host;

  const handleMessage = useCallback(
    (ev: MessageEvent) => {
      if (ev.source !== frameRef.current?.contentWindow) return;
      if (!ev.data || ev.data.__libraRpc !== true) return;
      const msg = ev.data.__libraMsg;
      if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number') return;

      const reply = (payload: Record<string, unknown>) => {
        frameRef.current?.contentWindow?.postMessage(
          { __libraRpc: true, __libraMsg: { id: msg.id, ...payload } },
          frameOrigin,
        );
      };

      const current = hostRef.current;
      switch (msg.op) {
        case 'getState': {
          reply({
            ok: true,
            result: {
              selectedAgent: current.selectedAgent ?? null,
              lastOutput: current.lastOutput,
            },
          });
          break;
        }
        case 'call': {
          const method = msg.params?.[0] as string;
          const args = msg.params?.[1];
          if (method === 'selectAgent') {
            current.selectAgent(args as string);
            reply({ ok: true, result: null });
          } else if (method === 'dispatchTask') {
            const [pluginId, action, callArgs, agentId] = msg.params;
            current
              .dispatchTask(pluginId as string, action as string, (callArgs ?? {}) as Record<string, unknown>, agentId as string | undefined)
              .then((res) => reply({ ok: true, result: res }))
              .catch((e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          } else {
            reply({ ok: false, error: `unknown bridge method '${method}'` });
          }
          break;
        }
        case 'api': {
          // Authenticated backend call on behalf of the iframe (the plugin
          // cannot read the JWT from localStorage cross-origin).
          const method = (msg.params?.[0] as string)?.toLowerCase();
          const path = msg.params?.[1] as string;
          const body = msg.params?.[2];
          const call =
            method === 'get' ? api.get(path)
            : method === 'post' ? api.post(path, body)
            : method === 'put' ? api.put(path, body)
            : method === 'delete' ? api.delete(path)
            : Promise.reject(new Error(`unsupported api method '${method}'`));
          call
            .then((res) => reply({ ok: true, result: res }))
            .catch((e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          break;
        }
        case 'subscribe': {
          const action = (msg.params?.[0] as string) || undefined;
          current.subscribeOutput((out: PluginOutput) => {
            frameRef.current?.contentWindow?.postMessage(
              { __libraRpc: true, __libraMsg: { event: 'output', data: out } },
              frameOrigin,
            );
          }, action);
          reply({ ok: true, result: null });
          break;
        }
        default:
          reply({ ok: false, error: `unknown bridge op '${String(msg.op)}'` });
      }
    },
    [frameOrigin],
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  return (
    <iframe
      ref={frameRef}
      src={src}
      title={`plugin-${spec.pluginId}`}
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      className="w-full h-full min-h-[60vh] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950"
    />
  );
}

/** Plugin pages are always rendered inside an iframe. */
export function PluginPageHost({ spec }: { spec: PluginPageSpec }) {
  return <HtmlPluginFrame spec={spec} />;
}
