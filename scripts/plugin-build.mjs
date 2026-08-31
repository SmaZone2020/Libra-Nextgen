#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  plugin-build.mjs — 插件页面编译共享模块(主仓库 scripts/)
//
//  把 page/index.tsx 编译成 page/dist/index.js(IIFE bundle):
//    - react / react-dom / @heroui/react / @gravity-ui/icons /
//      react-i18next / **/usePluginHost 全部 external,运行时从
//      window.LibraPluginHost 取(host 由控制台在加载插件前注入)
//    - 产物注册到 window.__libraPluginRegistry[pluginId]
//    - CJS shim 垫片:esbuild 把对宿主 API 的属性访问变成运行时动态读取,
//      无需静态导出列表,插件可随意 import 宿主暴露的任何具名导出
//  被 pack.mjs(模板/市场仓库)与 install-builtin-plugins.mjs 复用。
// ═══════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** 定位 esbuild:优先调用方环境,回退到主仓库 webapp 的 node_modules(vite 自带)。 */
export async function resolveEsbuild() {
  try {
    const local = await import('esbuild');
    return local;
  } catch {
    /* fall through */
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const webappPkg = path.join(repoRoot, 'src', 'webapp', 'package.json');
  const req = createRequire(pathToFileURL(webappPkg));
  return req('esbuild');
}

/**
 * esbuild 插件:把宿主依赖 import 重定向到 window.LibraPluginHost 的 CJS 垫片。
 * CJS 垫片的属性访问发生在运行时,因此插件源码可以 import 宿主 API 的
 * 任意具名导出(如 @heroui/react 的 Button/Input/Table…),打包零配置。
 */
export function hostShimPlugin() {
  // 精确包名 → 宿主全局键
  const nsMap = {
    react: 'React',
    'react-dom': 'ReactDOM',
    'react-dom/client': 'ReactDOM',
    '@heroui/react': 'HeroUI',
    '@gravity-ui/icons': 'Icons',
    'react-markdown': 'ReactMarkdown',
    'remark-gfm': 'remarkGfm',
  };
  // 宿主内部模块(相对路径后缀,插件源码常写成 ../../api/client 之类)
  const pathMap = {
    '/api/client': 'apiClient',
    '/api/files': 'apiFiles',
    '/api/plugins': 'apiPlugins',
    '/components/file-tree': 'FileTree',
    './client': 'apiClient',
  };
  const MATCH =
    /^(react|react-dom|react-dom\/client|react\/jsx-runtime|@heroui\/react|@gravity-ui\/icons|react-i18next|react-markdown|remark-gfm)$|usePluginHost$|api\/(client|files|plugins)$|components\/file-tree$|(\.\/|\.\.\/)client$/;

  return {
    name: 'libra-host-shim',
    setup(build) {
      build.onResolve({ filter: MATCH }, (args) => {
        const p = args.path;
        if (p === 'react/jsx-runtime') return { path: 'libra-host:jsx-runtime', namespace: 'libra-host' };
        if (p === 'react-i18next') return { path: 'libra-host:i18next', namespace: 'libra-host' };
        if (p.endsWith('usePluginHost')) return { path: 'libra-host:usePluginHost', namespace: 'libra-host' };
        if (p in nsMap) return { path: `libra-host:${p}`, namespace: 'libra-host' };
        for (const [suffix, key] of Object.entries(pathMap)) {
          if (p.endsWith(suffix)) return { path: `libra-host:${key}`, namespace: 'libra-host' };
        }
        return null;
      });

      build.onLoad({ filter: /.*/, namespace: 'libra-host' }, (args) => {
        const cjs = (code) => ({ contents: code, loader: 'js' });
        switch (args.path) {
          case 'libra-host:jsx-runtime':
            return cjs(`var R = globalThis.LibraPluginHost.React;
module.exports = { jsx: R.jsx || R.createElement, jsxs: R.jsxs || R.createElement, Fragment: R.Fragment };`);
          case 'libra-host:i18next':
            return cjs('module.exports = { useTranslation: globalThis.LibraPluginHost.useTranslation };');
          case 'libra-host:usePluginHost':
            return cjs('module.exports = { usePluginHost: globalThis.LibraPluginHost.usePluginHost };');
          default: {
            const key = args.path.startsWith('libra-host:') ? args.path.slice('libra-host:'.length) : null;
            if (key && key in nsMap) {
              return cjs(`module.exports = globalThis.LibraPluginHost.${nsMap[key]};`);
            }
            if (key && Object.values(pathMap).includes(key)) {
              return cjs(`module.exports = globalThis.LibraPluginHost.${key};`);
            }
            return cjs('module.exports = {};');
          }
        }
      });
    },
  };
}

/**
 * 编译 page/index.tsx → outDir/dist/index.js。
 * @param {object} opts
 * @param {string} opts.pluginDir  插件根目录(含 meta.json)
 * @param {string} opts.pluginId   用于产物注册
 * @param {string} opts.outDir     产物目录(通常 page/)
 * @param {object} [opts.esbuild]  已解析的 esbuild(不传则自动解析)
 * @param {boolean} [opts.force]   产物已存在时是否强制重编
 * @returns {Promise<{written: boolean, outfile: string}>}
 */
export async function buildPluginPage({ pluginDir, pluginId, outDir, esbuild, force = false }) {
  const entry = path.join(pluginDir, 'page', 'index.tsx');
  const outfile = path.join(outDir, 'dist', 'index.js');
  const esb = esbuild ?? (await resolveEsbuild());
  const registration = `\n;(function(){var r=globalThis.__libraPluginRegistry||(globalThis.__libraPluginRegistry={});` +
    `r[${JSON.stringify(pluginId)}]=globalThis.__libra_plugin__.default||globalThis.__libra_plugin__;})();`;
  await esb.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    globalName: '__libra_plugin__',
    jsx: 'automatic',
    target: ['es2020'],
    legalComments: 'none',
    logLevel: 'warning',
    plugins: [hostShimPlugin()],
    footer: { js: registration },
  });
  return { written: true, outfile };
}

/** 判断插件是否带有可编译的 TSX 页面。 */
export function hasTsxPage(pluginDir) {
  return path.join(pluginDir, 'page', 'index.tsx');
}

export default { resolveEsbuild, hostShimPlugin, buildPluginPage };
