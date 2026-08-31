import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiOrigin } from '../api/client';
import { usePluginHost, type PluginOutput } from '../hooks/usePluginHost';
import { getPluginRegistry, PLUGIN_REGISTRY_KEY } from './host';

/**
 * Runtime plugin page renderer.
 *
 * A plugin page arrives from the server in one of two forms (see
 * PluginPageController):
 *  - react: a pre-compiled IIFE bundle at `page/dist/index.js` whose default
 *    export is a React component. We inject it via a <script> tag; the bundle
 *    registers itself on `window[__libraPluginRegistry][pluginId]` and the
 *    component renders in-host with React/HeroUI taken from LibraPluginHost.
 *  - html: a plain `page/index.html` + js/css loaded in an iframe. The page
 *    talks to the console through the postMessage bridge (page/_bridge.js).
 *
 * Neither path recompiles the console: dev and preview behave identically, and
 * installing/updating a plugin only requires the server to expose new files.
 */

export interface PluginPageSpec {
  pluginId: string;
  kind: 'react' | 'html';
  entry: string;
  version: string;
}

function pageBase(pluginId: string): string {
  return `${getApiOrigin()}/api/plugins/${encodeURIComponent(pluginId)}/page`;
}

// ── react form ────────────────────────────────────────────────────────

const loadedScripts = new Set<string>();
const pendingLoads = new Map<string, Promise<void>>();

/** Inject the plugin bundle once; resolves when its component is registered. */
function loadReactBundle(pluginId: string, url: string): Promise<void> {
  const existing = pendingLoads.get(url);
  if (existing) return existing;
  const registry = getPluginRegistry();
  if (registry[pluginId]) return Promise.resolve();

  const load = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    const onOk = () => {
      const comp = getPluginRegistry()[pluginId];
      if (comp) {
        loadedScripts.add(url);
        resolve();
      } else {
        reject(new Error(`Plugin bundle loaded but did not register '${pluginId}'`));
      }
    };
    const onErr = () => reject(new Error(`Failed to load plugin bundle: ${url}`));
    script.addEventListener('load', onOk, { once: true });
    script.addEventListener('error', onErr, { once: true });
    document.head.appendChild(script);
  });
  pendingLoads.set(url, load);
  load.finally(() => pendingLoads.delete(url)).catch(() => {
    /* error surfaced via the load() promise consumers */
  });
  return load;
}

function ReactPluginPage({ spec }: { spec: PluginPageSpec }) {
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const url = `${pageBase(spec.pluginId)}/${spec.entry}?v=${encodeURIComponent(spec.version)}`;

  useEffect(() => {
    let cancelled = false;
    if (getPluginRegistry()[spec.pluginId]) return;
    loadReactBundle(spec.pluginId, url)
      .then(() => {
        if (!cancelled) setTick((t) => t + 1);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [spec.pluginId, url]);

  const Component = getPluginRegistry()[spec.pluginId];
  if (error) return <PluginLoadError message={error} />;
  if (!Component) {
    return (
      <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">
        Loading plugin page…
      </div>
    );
  }
  return <Component />;
}

function PluginLoadError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-danger-300 bg-danger-50 dark:bg-danger-950/40 p-4 text-sm text-danger-600 dark:text-danger-400">
      <div className="font-medium mb-1">插件页面加载失败</div>
      <div className="font-mono text-xs opacity-80">{message}</div>
    </div>
  );
}

// ── html form (iframe + postMessage bridge) ───────────────────────────

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
          reply({ ok: true, result: { selectedAgent: current.selectedAgent ?? null, lastOutput: current.lastOutput } });
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
        case 'subscribe': {
          const action = (msg.params?.[0] as string) || undefined;
          const unsub = current.subscribeOutput((out: PluginOutput) => {
            frameRef.current?.contentWindow?.postMessage(
              { __libraRpc: true, __libraMsg: { event: 'output', data: out } },
              frameOrigin,
            );
          }, action);
          // The iframe re-subscribes on every load; one active subscription per
          // frame is enough. The unsubscribe is intentionally not retained for
          // unmount — the frame's message handler is the lifecycle.
          void unsub;
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
      className="w-full h-full min-h-[60vh] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950"
    />
  );
}

// ── dispatcher ────────────────────────────────────────────────────────

export function PluginPageHost({ spec }: { spec: PluginPageSpec }) {
  if (spec.kind === 'html') return <HtmlPluginFrame spec={spec} />;
  return <ReactPluginPage spec={spec} />;
}

/** Convenience: expose the registry key for debugging / tests. */
export const __pluginRegistryKey = PLUGIN_REGISTRY_KEY;
