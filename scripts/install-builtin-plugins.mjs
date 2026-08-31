#!/usr/bin/env node
// install-builtin-plugins.mjs - build and install builtin plugins
//   node scripts/install-builtin-plugins.mjs [--src <dir>] [--dest <dir>] [--force] [--list]

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginPage, resolveEsbuild } from './plugin-build.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Read JSON, tolerating a UTF-8 BOM (some meta.json files come from Windows editors). */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

const srcDir = path.resolve(flag('--src') ?? path.join(REPO_ROOT, 'Libra-Plugins', 'plugins'));
const destDir = path.resolve(flag('--dest') ?? path.join(REPO_ROOT, 'src', 'plugins'));
const force = args.includes('--force');
const listOnly = args.includes('--list');

if (!existsSync(srcDir)) {
  console.error(`[install] plugin source dir not found: ${srcDir}`);
  console.error('          clone Libra-Plugins next to this repo, or pass --src <dir>');
  process.exit(1);
}

const pluginDirs = readdirSync(srcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(srcDir, d.name))
  .filter((d) => existsSync(path.join(d, 'meta.json')));

if (pluginDirs.length === 0) {
  console.error(`[install] no plugins (meta.json) found under ${srcDir}`);
  process.exit(1);
}

console.log(`[install] source: ${srcDir}`);
console.log(`[install] dest:   ${destDir}`);
console.log(`[install] plugins: ${pluginDirs.length}`);

if (listOnly) {
  for (const dir of pluginDirs) {
    const meta = readJson(path.join(dir, 'meta.json'));
    const hasTsx = existsSync(path.join(dir, 'page', 'index.tsx'));
    const hasHtml = existsSync(path.join(dir, 'page', 'index.html'));
    console.log(`  - ${meta.pluginId}@${meta.version}  page: ${hasTsx ? 'tsx' : hasHtml ? 'html' : 'none'}`);
  }
  process.exit(0);
}

const needBuild = pluginDirs.filter((d) => {
  const tsx = path.join(d, 'page', 'index.tsx');
  const dist = path.join(d, 'page', 'dist', 'index.js');
  return existsSync(tsx) && (force || !existsSync(dist));
});

let esbuild = null;
if (needBuild.length > 0) {
  try {
    esbuild = await resolveEsbuild();
    console.log(`[install] esbuild ready (${needBuild.length} page(s) to build)`);
  } catch (e) {
    console.error('[install] esbuild unavailable:', e.message);
    console.error('          run `npm i -D esbuild` in src/webapp or provide pre-built page/dist/index.js');
    process.exit(1);
  }
}

let built = 0;
let copied = 0;
for (const dir of pluginDirs) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const pluginId = meta.pluginId;
  const tsx = path.join(dir, 'page', 'index.tsx');
  const dist = path.join(dir, 'page', 'dist', 'index.js');

  if (existsSync(tsx) && (force || !existsSync(dist))) {
    try {
      await buildPluginPage({ pluginDir: dir, pluginId, outDir: path.join(dir, 'page'), esbuild, force });
      built++;
      console.log(`  [build] ${pluginId} page -> page/dist/index.js`);
    } catch (e) {
      console.error(`  [build] ${pluginId} FAILED:`, e.message);
      process.exit(1);
    }
  } else if (existsSync(tsx) && existsSync(dist)) {
    console.log(`  [skip]  ${pluginId} page already built (use --force to rebuild)`);
  }

  if (!existsSync(dist) && !existsSync(path.join(dir, 'page', 'index.html'))) {
    console.warn(`  [warn]  ${pluginId} has no buildable page (no page/index.tsx or page/index.html)`);
  }

  const target = path.join(destDir, pluginId);
  mkdirSync(target, { recursive: true });
  cpSync(dir, target, { recursive: true, force: true });
  copied++;
}

console.log(`[install] done: ${built} page(s) built, ${copied} plugin(s) installed to ${destDir}`);
console.log('[install] restart the backend if it is running, then refresh the console.');