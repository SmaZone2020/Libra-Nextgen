import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { getApiOrigin } from '../api/client';
import { getPluginManifests, type PluginManifest } from '../api/plugins';
import { PluginPageHost } from './loader';
import './host'; // side effect: injects window.LibraPluginHost before any bundle loads

/**
 * Runtime registry of plugin pages.
 *
 * Plugins are NOT compiled into this bundle. The console fetches the enabled
 * manifest feed from the backend, asks each plugin for its page manifest
 * (`/api/plugins/<id>/page/manifest.json`), and renders whatever the plugin
 * ships — a pre-compiled React bundle (kind: react) or a plain html page
 * (kind: html). dev and preview behave identically; installing or updating a
 * plugin only needs new files on the server, never a console rebuild.
 *
 * Plugins whose manifest has no `entry` (metadata/action-only plugins) or whose
 * page files are missing are skipped here — no route, no sidebar entry.
 */

/** Page description fetched from the backend at runtime. */
export interface PluginPageInfo {
  pluginId: string;
  kind: 'react' | 'html';
  entry: string;
  version: string;
}

export interface RegisteredPlugin {
  pluginId: string;
  manifest: PluginManifest;
  /** Route path (already prefixed with /plugins/). */
  route: string;
  Page: React.ComponentType;
}

async function fetchPageInfo(pluginId: string): Promise<PluginPageInfo | null> {
  const res = await fetch(`${getApiOrigin()}/api/plugins/${encodeURIComponent(pluginId)}/page/manifest.json`, {
    // Anonymous endpoint; ensure fresh data when a plugin was just reinstalled.
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    kind?: string;
    entry?: string;
    version?: string;
  };
  if (data.kind !== 'react' && data.kind !== 'html') return null;
  if (!data.entry) return null;
  return {
    pluginId,
    kind: data.kind,
    entry: data.entry,
    version: data.version ?? '',
  };
}

/** Stable component identity per plugin@version so routes don't remount. */
const pageComponentCache = new Map<string, React.ComponentType>();

function pageComponentFor(spec: PluginPageInfo): React.ComponentType {
  const key = `${spec.pluginId}@${spec.version}`;
  let comp = pageComponentCache.get(key);
  if (!comp) {
    comp = () => React.createElement(PluginPageHost, { spec });
    pageComponentCache.set(key, comp);
  }
  return comp;
}

/**
 * Fetch the enabled plugin manifests, probe each one's page manifest, and
 * expose only the plugins that actually have a page to render.
 */
export function useRegisteredPlugins(): RegisteredPlugin[] {
  const [plugins, setPlugins] = useState<RegisteredPlugin[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPluginManifests()
      .then(async (manifests: PluginManifest[]) => {
        const registered: RegisteredPlugin[] = [];
        const probes = manifests
          .filter((m) => m.entry?.route)
          .map(async (m) => {
            const info = await fetchPageInfo(m.pluginId);
            return { m, info };
          });
        for (const p of await Promise.all(probes)) {
          if (!p.info) continue; // no page output — metadata-only plugin
          registered.push({
            pluginId: p.m.pluginId,
            manifest: p.m,
            route: `/plugins/${p.m.entry!.route}`,
            Page: pageComponentFor(p.info),
          });
        }
        if (!cancelled) setPlugins(registered);
      })
      .catch(() => {
        if (!cancelled) setPlugins([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => plugins, [plugins]);
}
