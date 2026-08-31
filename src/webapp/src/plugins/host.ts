import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as HeroUI from '@heroui/react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as apiClient from '../api/client';
import * as apiFiles from '../api/files';
import * as apiPlugins from '../api/plugins';
import { FileTree } from '../components/file-tree';
import { usePluginHost as usePluginHostHook } from '../hooks/usePluginHost';
import { PLUGIN_ICONS } from './icons';

/**
 * Global host API handed to runtime-loaded plugin bundles.
 *
 * Plugin pages are compiled at pack time into standalone IIFE bundles with
 * every framework import externalized onto `window.LibraPluginHost`:
 *   react / react-dom        - React, ReactDOM
 *   @heroui/react            - HeroUI (component namespace)
 *   @gravity-ui/icons        - Icons (whitelist only)
 *   react-i18next            - useTranslation
 *   react-markdown/remark-gfm- ReactMarkdown, remarkGfm
 *   ../hooks/usePluginHost   - usePluginHost
 *   /api/client              - apiClient (api, getApiOrigin, ...)
 *   /api/plugins             - apiPlugins (listPlugins, importPlugin, ...)
 *   /components/file-tree    - FileTree
 *
 * This keeps the plugin bundle free of any framework code (small, conflict-free)
 * and gives the console an explicit, auditable API surface -- a plugin can only
 * use what the host decides to expose.
 *
 * Injected once as a side effect of importing this module, which the runtime
 * registry imports before any plugin bundle is loaded.
 */
export interface LibraPluginHostApi {
  React: typeof React;
  ReactDOM: typeof ReactDOM;
  HeroUI: typeof HeroUI;
  Icons: typeof PLUGIN_ICONS;
  useTranslation: typeof useTranslation;
  usePluginHost: typeof usePluginHostHook;
  apiClient: typeof apiClient;
  apiFiles: typeof apiFiles;
  apiPlugins: typeof apiPlugins;
  FileTree: typeof FileTree;
  ReactMarkdown: typeof ReactMarkdown;
  remarkGfm: typeof remarkGfm;
}

const GLOBAL_KEY = 'LibraPluginHost';

export function ensurePluginHost(): LibraPluginHostApi {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: LibraPluginHostApi };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      React,
      ReactDOM,
      HeroUI,
      Icons: PLUGIN_ICONS,
      useTranslation,
      usePluginHost: usePluginHostHook,
      apiClient,
      apiFiles,
      apiPlugins,
      FileTree,
      ReactMarkdown,
      remarkGfm,
    };
  }
  return g[GLOBAL_KEY]!;
}

/** The window key under which compiled plugin bundles register themselves. */
export const PLUGIN_REGISTRY_KEY = '__libraPluginRegistry';

export function getPluginRegistry(): Record<string, React.ComponentType> {
  const g = globalThis as unknown as Record<string, unknown>;
  const reg = (g[PLUGIN_REGISTRY_KEY] ?? {}) as Record<string, React.ComponentType>;
  g[PLUGIN_REGISTRY_KEY] = reg;
  return reg;
}

// Inject the host API as soon as this module is first imported.
ensurePluginHost();
