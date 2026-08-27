#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  pack.mjs — Libra-Nextgen 插件打包脚本（零依赖，仅 Node 内置 fs/zlib）
// ═══════════════════════════════════════════════════════════════════════
//  用法：
//    node pack.mjs            → 生成 dist/<pluginId>-<version>.zip
//    node pack.mjs --list     → 只列出将打包的内容，不生成 zip
//    node pack.mjs --out x.zip → 指定输出路径
//
//  打包内容：meta.json + 顶层业务目录（module/ service/ page/ assets/ data/ …），
//  忽略 .git / node_modules / dist / 打包脚本 / package.json / README（可配置）。
//  zip 内路径统一用 '/'；meta.json 位于 zip 根目录；空目录不打包。
//
//  环境变量：
//    PLUGIN_META  — meta.json 路径（默认仓库根 meta.json）
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync, statSync, readdirSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = dirname(fileURLToPath(import.meta.url));

// 需要排除的条目（文件名 / 目录名；目录名命中则整个跳过）
const IGNORE = new Set(['.git', 'node_modules', 'dist', '.github', '.idea', '.vscode']);
const IGNORE_FILES = new Set(['pack.mjs', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '.DS_Store']);

// 可选：README / LICENSE 是否打进 zip（默认不打，市场不需要）
const INCLUDE_EXTRA = process.env.PLUGIN_INCLUDE_EXTRA === '1';

// ── 收集要打包的文件（递归，跳过忽略项与空目录）────────────────────────

function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, out);
    } else if (!IGNORE_FILES.has(name)) {
      if (INCLUDE_EXTRA || !['README.md', 'LICENSE'].includes(name)) {
        out.push(full);
      }
    }
  }
  return out;
}

// ── 极简 ZIP 写入器（stored + deflate，兼容所有解压器）──────────────────

class ZipWriter {
  constructor(outPath) {
    this.fd = createWriteStream(outPath);
    this.entries = [];
    this.offset = 0;
    this.central = [];
  }

  async add(name, data) {
    const isText = typeof data === 'string';
    const raw = isText ? Buffer.from(data, 'utf8') : data;
    // 压缩：deflate（zip 需要 raw deflate 流，用 deflateRawSync 而非 deflateSync）；
    // 若压缩后反而更大则退回 stored（原样存储）
    const compressed = raw.length > 0 ? deflateRawSync(raw, { level: 9 }) : raw;
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const payloadLen = payload.length;

    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);        // local file header signature
    local.writeUInt16LE(20, 4);                // version needed
    local.writeUInt16LE(0x0800, 6);            // flags: UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); // compression method
    local.writeUInt16LE(0, 10);                // mod time
    local.writeUInt16LE(0x21, 12);             // mod date (1980-01-01)
    local.writeUInt32LE(0, 14);                // crc32 (patched below)
    local.writeUInt32LE(payloadLen, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);                // extra length

    const crc = crc32(raw);
    local.writeUInt32LE(crc, 14);

    await writeChunk(this.fd, local);
    await writeChunk(this.fd, nameBuf);
    await writeChunk(this.fd, payload);

    this.central.push({ name: nameBuf, crc, compLen: payloadLen, rawLen: raw.length, offset: this.offset, method: useDeflate ? 8 : 0 });
    this.offset += 30 + nameBuf.length + payloadLen;
  }

  async finish() {
    const centralStart = this.offset;
    for (const e of this.central) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);          // central header signature
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(0, 12);
      c.writeUInt16LE(0x21, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compLen, 20);
      c.writeUInt32LE(e.rawLen, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt16LE(0, 30);                  // extra
      c.writeUInt16LE(0, 32);                  // comment
      c.writeUInt16LE(0, 34);                  // disk
      c.writeUInt16LE(0, 36);                  // internal attrs
      c.writeUInt32LE(0, 38);                  // external attrs
      c.writeUInt32LE(e.offset, 42);
      await writeChunk(this.fd, c);
      await writeChunk(this.fd, e.name);
    }
    const centralSize = this.offset - centralStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);         // EOCD signature
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.central.length, 8);
    eocd.writeUInt16LE(this.central.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);
    await writeChunk(this.fd, eocd);

    await new Promise((res, rej) => this.fd.end((err) => (err ? rej(err) : res())));
  }
}

function writeChunk(fd, buf) {
  return new Promise((res, rej) => fd.write(buf, (err) => (err ? rej(err) : res())));
}

// ── CRC32（无依赖）──────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── 主流程 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const outFlag = args.indexOf('--out');
const outPath = outFlag >= 0 ? args[outFlag + 1] : null;

const metaPath = join(ROOT, process.env.PLUGIN_META || 'meta.json');
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const pluginId = meta.pluginId;
const version = meta.version;
if (!pluginId || !version) {
  console.error('[pack] meta.json 缺少 pluginId 或 version');
  process.exit(1);
}

const files = collectFiles(ROOT)
  .filter((f) => f !== metaPath || true) // meta.json 始终包含（在根，collectFiles 已含）
  .sort();

if (listOnly) {
  console.log(`[pack] ${files.length} file(s) to pack for ${pluginId}@${version}:`);
  for (const f of files) console.log('  ' + relative(ROOT, f).split(sep).join('/'));
  process.exit(0);
}

const distDir = join(ROOT, 'dist');
mkdirSync(distDir, { recursive: true });
const zipFile = outPath || join(distDir, `${pluginId}-${version}.zip`);

const zip = new ZipWriter(zipFile);
for (const f of files) {
  const rel = relative(ROOT, f).split(sep).join('/');
  const data = readFileSync(f);
  await zip.add(rel, data);
}
await zip.finish();

const st = statSync(zipFile);
console.log(`[pack] wrote ${zipFile} (${st.size} bytes, ${files.length} files)`);
