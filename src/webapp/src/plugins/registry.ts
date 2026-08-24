import { lazy, useEffect, useState } from 'react';
import { getPluginManifests, type PluginManifest } from '../api/plugins';

/**
 * Build-time registry of plugin pages. Each entry is a lazy component loaded
 * from `src/plugins/<pluginId>/index.tsx`.
 *
 * Vite bundles these into separate chunks via `import.meta.glob`, so they are
 * loaded on demand (never in the initial bundle). The key MUST match the
 * plugin's `pluginId` so the runtime can align a page component with the
 * enabled-manifest served by the backend.
 */
const pageModules = import.meta.glob<{ default: React.ComponentType }>('../plugins/*/index.tsx');

/** Cache a React.lazy wrapper per pluginId so identity is stable across renders. */
const lazyCache = new Map<string, React.LazyExoticComponent<React.ComponentType>>();

function resolvePage(pluginId: string): React.LazyExoticComponent<React.ComponentType> | null {
  const path = `../plugins/${pluginId}/index.tsx`;
  const loader = pageModules[path];
  if (!loader) return null;

  let comp = lazyCache.get(pluginId);
  if (!comp) {
    comp = lazy(loader);
    lazyCache.set(pluginId, comp);
  }
  return comp;
}

/**
 * A registered plugin: runtime metadata (from the backend manifest) combined
 * with its page component (from the build-time registry).
 */
export interface RegisteredPlugin {
  pluginId: string;
  manifest: PluginManifest;
  /** Route path (already prefixed with /plugins/). */
  route: string;
  Page: React.ComponentType;
}

/**
 * Fetch the enabled plugin manifests and align them with build-time page
 * components. Plugins whose page component is present in the registry get a
 * route + sidebar entry; metadata-only plugins (no page) are ignored here.
 */
export function useRegisteredPlugins(): RegisteredPlugin[] {
  const [plugins, setPlugins] = useState<RegisteredPlugin[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPluginManifests()
      .then((manifests: PluginManifest[]) => {
        if (cancelled) return;
        const registered: RegisteredPlugin[] = [];
        for (const m of manifests) {
          if (!m.entry?.route) continue;
          const page = resolvePage(m.pluginId);
          if (!page) continue;
          registered.push({
            pluginId: m.pluginId,
            manifest: m,
            route: `/plugins/${m.entry.route}`,
            Page: page,
          });
        }
        setPlugins(registered);
      })
      .catch(() => {
        if (!cancelled) setPlugins([]);
      });
    return () => { cancelled = true; };
  }, []);

  return plugins;
}
