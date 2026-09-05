// Update manager for the desktop shell (docs/desktop-electron-architecture.md §7):
//   - manual service update: check GitHub Releases for a newer tag, download the
//     per-platform libra-desktop-{rid}-{tag}.zip payload (service + web +
//     version.json), verify SHA-256, atomically swap payload/latest <-> .prev;
//   - silent web update: refresh userData/web from libra-webapp-{tag}.zip when a
//     payload update is not needed; failures fall back to the embedded baseline.
// Agent template zips (libra-agent-tpl-{platform}) are refreshed to templates/.
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const extract = require('extract-zip');

/** Map process.platform+arch to the release asset RID segment. */
function ridFor(platform, arch) {
  if (platform === 'win32') return arch === 'arm64' ? 'win-arm64' : 'win-x64';
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  throw new Error(`unsupported platform ${platform}/${arch}`);
}

/** Agent template platform key (matches templates.yml asset names). */
function templateKeyFor(platform, arch) {
  if (platform === 'win32') return arch === 'arm64' ? 'win-arm64' : 'x64';
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  if (platform === 'darwin') return 'mac-arm64';
  throw new Error(`unsupported platform ${platform}/${arch}`);
}

function httpsGetJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: token ? { Authorization: `token ${token}` } : {} }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsGetJson(res.headers.location, token));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url} -> ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        file.close(() => fs.unlinkSync(dest));
        resolve(downloadTo(res.headers.location, dest));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        file.close(() => fs.unlinkSync(dest));
        reject(new Error(`download ${url} -> ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (e) => { file.close(() => fs.unlinkSync(dest)); reject(e); });
  });
}

/** Strongest guarantee the shell offers: refuse anything without a hash. */
async function verifySha256(filePath, expected) {
  const actual = await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
  if (actual !== expected.trim().toLowerCase()) {
    throw new Error(`sha256 mismatch for ${path.basename(filePath)}`);
  }
}

async function readSha256(url) {
  const text = await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`sha256 -> ${res.statusCode}`)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  return text.split(/\s+/)[0];
}

function assetUrl(release, name) {
  const asset = (release.assets || []).find((a) => a.name === name);
  return asset ? asset.browser_download_url : null;
}

/** Latest tag from GitHub; owner/repo defaults mirror the WPF updater source. */
async function latestReleaseTag(owner, repo, token) {
  const release = await httpsGetJson(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`, token);
  return release.tag_name;
}

/**
 * Full manual update path for the service payload. Returns the new manifest
 * (parsed version.json) or null when already up to date.
 */
async function updateServicePayload({
  owner, repo, token, userDataDir, log = console.log,
  force = false, platform = process.platform, arch = process.arch,
}) {
  const payloadRoot = path.join(userDataDir, 'payload');
  const latestDir = path.join(payloadRoot, 'latest');
  const prevDir = path.join(payloadRoot, 'latest.prev');
  const downloads = path.join(userDataDir, 'downloads');
  const currentTag = readLocalTag(latestDir);
  const latestTag = await latestReleaseTag(owner, repo, token);
  if (!force && currentTag === latestTag) return null;

  const rid = ridFor(platform, arch);
  const zipName = `libra-desktop-${rid}-${latestTag}.zip`;
  const zipUrl = assetUrlFromRelease(owner, repo, token, latestTag, zipName);
  const shaUrl = `${zipUrl}.sha256`;

  const zipPath = path.join(downloads, zipName);
  log(`downloading ${zipName} (${latestTag}) ...`);
  await downloadTo(zipUrl, zipPath);
  const expected = await readSha256(shaUrl);
  await verifySha256(zipPath, expected);
  log('sha256 verified');

  // Atomic swap: latest -> .prev, then extract into a fresh latest.
  fs.rmSync(prevDir, { recursive: true, force: true });
  if (fs.existsSync(latestDir)) fs.renameSync(latestDir, prevDir);
  fs.mkdirSync(latestDir, { recursive: true });
  try {
    await extract(zipPath, { dir: latestDir });
    // Support one nested directory level (contract allows it).
    const nested = fs.readdirSync(latestDir).filter((n) => fs.statSync(path.join(latestDir, n)).isDirectory());
    if (nested.length === 1 && !fs.existsSync(path.join(latestDir, 'version.json'))) {
      const inner = path.join(latestDir, nested[0]);
      for (const entry of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, entry), path.join(latestDir, entry));
      }
      fs.rmdirSync(inner);
    }
    if (!fs.existsSync(path.join(latestDir, 'version.json'))) {
      throw new Error('downloaded payload is missing version.json');
    }
    return readManifest(latestDir);
  } catch (err) {
    // Roll back: restore the previous payload.
    fs.rmSync(latestDir, { recursive: true, force: true });
    if (fs.existsSync(prevDir)) fs.renameSync(prevDir, latestDir);
    throw err;
  }
}

/** Silent web refresh: swap userData/web from libra-webapp-{tag}.zip. */
async function updateWebSilently({ owner, repo, token, userDataDir, log = console.log }) {
  try {
    const latestTag = await latestReleaseTag(owner, repo, token);
    const zipName = `libra-webapp-${latestTag}.zip`;
    const zipUrl = assetUrlFromRelease(owner, repo, token, latestTag, zipName);
    if (!zipUrl) return false;
    const zipPath = path.join(userDataDir, 'downloads', zipName);
    await downloadTo(zipUrl, zipPath);
    const expected = await readSha256(`${zipUrl}.sha256`);
    await verifySha256(zipPath, expected);
    const webDir = path.join(userDataDir, 'web');
    const tmp = path.join(userDataDir, 'web.tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    await extract(zipPath, { dir: tmp });
    fs.rmSync(webDir, { recursive: true, force: true });
    fs.renameSync(tmp, webDir);
    log(`web refreshed to ${latestTag}`);
    return true;
  } catch (err) {
    log(`silent web update skipped: ${err.message}`);
    return false;
  }
}

/** Seed/refresh agent template zips for the Builder (template mode). */
async function refreshAgentTemplates({ owner, repo, token, userDataDir, log = console.log }) {
  try {
    const latestTag = await latestReleaseTag(owner, repo, token);
    const key = templateKeyFor(process.platform, process.arch);
    const zipName = `libra-agent-tpl-${key}-${latestTag}.zip`;
    const zipUrl = assetUrlFromRelease(owner, repo, token, latestTag, zipName);
    if (!zipUrl) return false;
    const templatesDir = path.join(userDataDir, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const zipPath = path.join(templatesDir, zipName);
    await downloadTo(zipUrl, zipPath);
    const expected = await readSha256(`${zipUrl}.sha256`);
    await verifySha256(zipPath, expected);
    log(`agent template cached: ${zipName}`);
    return true;
  } catch (err) {
    log(`agent template refresh skipped: ${err.message}`);
    return false;
  }
}

async function assetUrlFromRelease(owner, repo, token, tag, assetName) {
  // Prefer the assets list of the tag's release; fall back to a direct URL.
  try {
    const release = await httpsGetJson(
      `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, token);
    const url = assetUrl(release, assetName);
    if (url) return url;
  } catch {
    // fall through
  }
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/${assetName}`;
}

function readManifest(latestDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(latestDir, 'version.json'), 'utf8'));
  } catch {
    return null;
  }
}

function readLocalTag(latestDir) {
  const manifest = readManifest(latestDir);
  return manifest ? manifest.tag : null;
}

module.exports = {
  updateServicePayload,
  updateWebSilently,
  refreshAgentTemplates,
  latestReleaseTag,
  readLocalTag,
  readManifest,
  ridFor,
  templateKeyFor,
};
