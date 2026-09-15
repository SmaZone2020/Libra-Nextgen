#!/usr/bin/env node
// Packs the React console (src/console/dist) into the single raw asset the
// mobile app ships and unpacks on first run: Resources/Raw/web-bundle.zip.
//
// The bundle carries a bundle-version.txt computed from the dist file list, so
// the app re-extracts only when the content actually changed (see
// WebBundleProvisioner). Run it before building the app; the csproj does that
// automatically unless -p:SkipWebBundle=true.
//
// Usage: node maui/scripts/build-web-bundle.mjs [--force]

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const distDir = join(repoRoot, 'src', 'console', 'dist');
const outFile = join(repoRoot, 'maui', 'LibraNextgen.Mobile', 'Resources', 'Raw', 'web-bundle.zip');
const force = process.argv.includes('--force');

if (!existsSync(distDir)) {
  console.error(`[web-bundle] console build output not found: ${distDir}`);
  console.error('[web-bundle] build it first:  cd src/console && npm ci && npm run build');
  process.exit(1);
}

/** Sorted relative paths of every file below `dir`. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

const files = walk(distDir);
if (files.length === 0) {
  console.error(`[web-bundle] ${distDir} is empty`);
  process.exit(1);
}

// Content stamp: file name + size + mtime for every dist file, plus the console
// package version. Any rebuild of the console changes it.
const consolePkg = JSON.parse(readFileSync(join(repoRoot, 'src', 'console', 'package.json'), 'utf8'));
const hash = createHash('sha256');
hash.update(`console=${consolePkg.version}\n`);
for (const file of files) {
  const st = statSync(file);
  hash.update(`${relative(distDir, file).split(sep).join('/')}|${st.size}|${st.mtimeMs}\n`);
}
const stamp = hash.digest('hex').slice(0, 16);

const stampFile = join(repoRoot, 'maui', '.web-bundle.stamp');
if (!force && existsSync(outFile) && existsSync(stampFile) && readFileSync(stampFile, 'utf8').trim() === stamp) {
  console.log(`[web-bundle] up to date (${stamp}), ${files.length} files`);
  process.exit(0);
}

mkdirSync(dirname(outFile), { recursive: true });
rmSync(outFile, { force: true });
writeFileSync(stampFile, stamp);

// Zip with the platform tools: tar (bsdtar) on Windows 10+, `zip` elsewhere.
// Both store forward-slash entry names, which is what ZipFile expects.
const versionFile = join(distDir, 'bundle-version.txt');
writeFileSync(versionFile, `${stamp}\n`);
try {
  if (process.platform === 'win32') {
    execFileSync('tar', ['-a', '-c', '-f', outFile, '-C', distDir, '.'], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-q', '-r', '-X', outFile, '.'], { cwd: distDir, stdio: 'inherit' });
  }
} finally {
  rmSync(versionFile, { force: true });
}

const size = statSync(outFile).size;
console.log(`[web-bundle] wrote ${relative(repoRoot, outFile)} (${(size / 1048576).toFixed(1)} MB, ${files.length} files, stamp ${stamp})`);
