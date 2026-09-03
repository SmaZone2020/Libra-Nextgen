import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getApiOrigin } from '../api/client';
import { usePluginHost, type PluginOutput } from '../hooks/usePluginHost';

/**
 * Runtime plugin page renderer — HTML form, SDK-injected.
 *
 * Every plugin page ships as plain `page/index.html` + js/css. The console:
 *   1. fetches the plugin's index.html from the backend (anonymous),
 *   2. injects <base> + SDK config + the bridge script into <head>,
 *   3. renders the result via iframe srcdoc (sandboxed, no allow-same-origin).
 *
 * The plugin page therefore does NOT need to include `_bridge.js` itself — the
 * SDK is already there as `window.Libra`:
 *   Libra.pluginId / Libra.getApiOrigin()
 *   Libra.usePluginHost() → { selectedAgent, lastOutput, selectAgent,
 *                             dispatchTask, subscribeOutput }
 *   Libra.api.get/post/put/delete(path, body?)  → authenticated backend calls
 * (LibraPluginHost is kept as an alias for compatibility.)
 *
 * RPC protocol (postMessage): { __libraRpc: true, __libraMsg: { id, op, params } }
 * where params is an OBJECT. Host replies with { id, ok, result | error } and
 * pushes { event: 'output', data } for WS subscriptions.
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build the srcdoc for a plugin page: original html + injected base + SDK.
 * The bridge script is loaded from the backend (classic <script>, cross-origin
 * fetch of scripts is not CORS-restricted) after the SDK config is in place,
 * so the plugin code always sees window.Libra regardless of its own markup.
 */
function buildPluginDoc(pluginId: string, html: string): string {
  const base = pageBase(pluginId);
  const sdkConfig = JSON.stringify({ pluginId, apiOrigin: getApiOrigin() });
  const sdkBlock =
    `<base href="${escapeHtml(base)}/">` +
    `<script>window.__libraSdkConfig=${sdkConfig};</script>` +
    `<script src="${escapeHtml(base)}/_bridge.js"></script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${sdkBlock}`);
  }
  return `<!doctype html><html><head>${sdkBlock}</head><body>${html}</body></html>`;
}

function HtmlPluginFrame({ spec }: { spec: PluginPageSpec }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const host = usePluginHost();
  const [doc, setDoc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;

  const docUrl = `${pageBase(spec.pluginId)}/${spec.entry}?v=${encodeURIComponent(spec.version)}`;

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setLoadError(null);
    fetch(docUrl, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`page fetch failed: HTTP ${r.status}`);
        return r.text();
      })
      .then((html) => {
        if (!cancelled) setDoc(buildPluginDoc(spec.pluginId, html));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [spec.pluginId, docUrl]);

  const handleMessage = useCallback(
    (ev: MessageEvent) => {
      if (ev.source !== frameRef.current?.contentWindow) return;
      if (!ev.data || ev.data.__libraRpc !== true) return;
      const msg = ev.data.__libraMsg;
      if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number') return;

      // srcdoc + sandbox(no allow-same-origin) → opaque origin; use '*' target.
      const reply = (payload: Record<string, unknown>) => {
        frameRef.current?.contentWindow?.postMessage(
          { __libraRpc: true, __libraMsg: { id: msg.id, ...payload } },
          '*',
        );
      };

      const current = hostRef.current;
      const p = msg.params as Record<string, unknown> | undefined;
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
          const method = p?.method as string;
          const args = (p?.params as unknown[] | undefined) ?? [];
          if (method === 'selectAgent') {
            current.selectAgent(args[0] as string);
            reply({ ok: true, result: null });
          } else if (method === 'dispatchTask') {
            const [pluginId, action, callArgs, agentId] = args;
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
          const method = (p?.method as string)?.toLowerCase();
          const path = p?.path as string;
          const body = p?.body;
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
          const action = (p?.action as string) || undefined;
          current.subscribeOutput((out: PluginOutput) => {
            frameRef.current?.contentWindow?.postMessage(
              { __libraRpc: true, __libraMsg: { event: 'output', data: out } },
              '*',
            );
          }, action);
          reply({ ok: true, result: null });
          break;
        }
        default:
          reply({ ok: false, error: `unknown bridge op '${String(msg.op)}'` });
      }
    },
    [],
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-danger-300 bg-danger-50 dark:bg-danger-950/40 p-4 text-sm text-danger-600 dark:text-danger-400">
        <div className="font-medium mb-1">插件页面加载失败</div>
        <div className="font-mono text-xs opacity-80">{loadError}</div>
      </div>
    );
  }

  return (
    <iframe
      ref={frameRef}
      title={`plugin-${spec.pluginId}`}
      srcDoc={doc ?? undefined}
      sandbox="allow-scripts allow-forms allow-modals"
      className="w-full h-[90vh] min-h-[60vh] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950"
    />
  );
}

/** Plugin pages are always rendered inside an iframe with injected SDK. */
export function PluginPageHost({ spec }: { spec: PluginPageSpec }) {
  return <HtmlPluginFrame spec={spec} />;
}
