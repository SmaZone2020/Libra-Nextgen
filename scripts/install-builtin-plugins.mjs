#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  install-builtin-plugins.mjs — 从本地插件源码安装内置插件
//
//  用法:
//    node scripts/install-builtin-plugins.mjs
//      --src <dir>   插件源码根(默认 <repo>/Libra-Plugins/plugins,即市场 checkout)
//      --dest <dir>  安装目标(默认 <repo>/src/plugins —— 服务器运行时目录)
//      --list        只列出将安装的插件,不复制
//
//  插件页面全部是纯 HTML+JS+CSS(无 TSX、无编译步骤):
//    page/index.html + page/index.js + page/index.css,原样复制即可。
//  安装目录是运行时状态,永远不入 git。服务端(5270)启动后即可在
//  控制台加载这些插件页面 —— dev / preview 都无需重建前端。
// ═══════════════════════════════════════════════════════════════════════

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 读取 JSON,容忍 UTF-8 BOM(部分 meta.json 由 Windows 编辑器生成)。 */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

const srcDir = path.resolve(flag('--src') ?? path.join(REPO_ROOT, 'Libra-Plugins', 'plugins'));
const destDir = path.resolve(flag('--dest') ?? path.join(REPO_ROOT, 'src', 'plugins'));
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
    const hasHtml = existsSync(path.join(dir, 'page', 'index.html'));
    console.log(`  - ${meta.pluginId}@${meta.version}  page: ${hasHtml ? 'html' : 'missing index.html'}`);
  }
  process.exit(0);
}

let copied = 0;
let warnings = 0;
for (const dir of pluginDirs) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const pluginId = meta.pluginId;

  if (!existsSync(path.join(dir, 'page', 'index.html'))) {
    console.warn(`  [warn]  ${pluginId} has no page/index.html — console will not render it`);
    warnings++;
  }

  const target = path.join(destDir, pluginId);
  // 先清空旧安装(旧 page/dist 等残留),再整树复制。
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(dir, target, { recursive: true, force: true });
  copied++;
}

console.log(`[install] done: ${copied} plugin(s) installed to ${destDir}${warnings ? ` (${warnings} missing page)` : ''}`);
console.log('[install] restart the backend if it is running, then refresh the console.');
