// Storage reachability probes for the first-run setup wizard.
//
// Two tiers, deliberately kept apart:
//   1. the real check spawns the service binary in probe mode
//      (LIBRA_STORAGE_PROBE=1, no port bound, one JSON line on stdout);
//   2. a development fallback (bare TCP connect) used when no service binary
//      exists. The fallback is strictly weaker, so the result carries
//      `weak: true` and the UI must say so instead of claiming a real check.
'use strict';

const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const MONGO_PREFIXES = ['mongodb://', 'mongodb+srv://'];
const PROBE_TIMEOUT_MS = 20000;

/** Normalize the wizard's storage mode; anything unknown degrades to sqlite. */
function normalizeMode(mode) {
  return mode === 'mongo' ? 'mongo' : 'sqlite';
}

/** Client-side guard only: the service does the authoritative parse. */
function isMongoConnectionString(value) {
  const text = String(value == null ? '' : value).trim();
  return MONGO_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/**
 * Parse a mongodb:// or mongodb+srv:// URI into the endpoint a plain TCP
 * connect can reach. Returns null when there is no usable host:port — an SRV
 * record cannot be resolved without the driver, so say "unknown" rather than
 * guess a wrong host.
 */
function parseMongoTarget(connectString) {
  const text = String(connectString == null ? '' : connectString).trim();
  const scheme = text.match(/^(mongodb(?:\+srv)?):\/\//i);
  if (!scheme) return null;

  // Credentials, path, query and the comma-separated replica seed list are all
  // irrelevant for a reachability check.
  const afterScheme = text.slice(scheme[0].length);
  const authority = afterScheme.split(/[/?#]/)[0];
  const at = authority.lastIndexOf('@');
  const hostList = (at >= 0 ? authority.slice(at + 1) : authority).split(',')[0];
  if (!hostList) return null;

  let host = hostList;
  let port = null;
  if (hostList.startsWith('[')) {
    // IPv6 literal: [::1]:27017
    const end = hostList.indexOf(']');
    if (end < 0) return null;
    host = hostList.slice(1, end);
    const rest = hostList.slice(end + 1);
    if (rest.startsWith(':')) port = Number(rest.slice(1));
  } else {
    const colon = hostList.lastIndexOf(':');
    if (colon > 0) {
      host = hostList.slice(0, colon);
      port = Number(hostList.slice(colon + 1));
    }
  }
  if (!host) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // SRV URIs carry no port at all; a plain URI defaults to the standard one.
    if (scheme[1].toLowerCase() === 'mongodb+srv') return null;
    port = 27017;
  }
  return { host, port };
}

/**
 * Normalize the wizard's remote server input to an origin usable as a window
 * URL: scheme required, everything after the origin dropped (the console is a
 * single-page app whose router owns the path).
 */
function normalizeRemoteUrl(input) {
  const text = String(input == null ? '' : input).trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Bare TCP connect; resolves true when anything accepts on host:port. */
function tcpReachable(host, port, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(value);
    };
    const sock = net.connect({ host, port }, () => finish(true));
    sock.on('error', () => finish(false));
    sock.setTimeout(timeoutMs, () => finish(false));
  });
}

/** Boolean probe answering LIBRA_STORAGE_PROBE (see LibraServiceHost). */
function hasProbeContract(raw) {
  if (!raw) return false;
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.reachable === 'boolean') return true;
    } catch {
      // Partial/truncated line: keep looking for the real probe output.
    }
  }
  return false;
}

/** Spawn the service in probe mode; resolves null when the binary is unusable. */
function probeViaBinary({ binPath, rootDir, userDataDir, connectString, timeoutMs, spawnImpl }) {
  return new Promise((resolve) => {
    const args = [
      '--user-data-dir', userDataDir,
      '--store', 'mongo',
      '--connect', connectString,
    ];
    const env = { ...process.env, LIBRA_STORAGE_PROBE: '1' };
    let child;
    try {
      child = (spawnImpl || spawn)(binPath, args, { cwd: possibleCwd(rootDir), windowsHide: true, env });
    } catch (err) {
      resolve({ ok: false, detail: `无法启动探测进程：${err.message}` });
      return;
    }

    let out = '';
    let err = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      // The service binds no port in probe mode, so a hang is a real hang.
      try { child.kill(); } catch { /* already gone */ }
      finish({ ok: false, detail: `存储探测超时（${Math.round(timeoutMs / 1000)} 秒无响应）` });
    }, timeoutMs);

    if (child.stdout) child.stdout.on('data', (d) => { out += String(d); });
    if (child.stderr) child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => finish({ ok: false, detail: `无法启动探测进程：${e.message}` }));
    child.on('close', (code) => {
      if (!hasProbeContract(out)) {
        // Old service builds answer with nothing; the caller must fall back.
        finish(null);
        return;
      }
      const line = String(out).split(/\r?\n/).find((l) => l.trim().startsWith('{')) || '{}';
      let parsed = {};
      try { parsed = JSON.parse(line); } catch { /* handled below */ }
      if (parsed.reachable === true) {
        finish({ ok: true, detail: 'MongoDB 连接成功，存储可用', mode: 'probe' });
        return;
      }
      const reason = parsed.error || firstLine(err) || `探测进程退出码 ${code}`;
      finish({ ok: false, detail: `MongoDB 不可达：${reason}` });
    });
  });
}

/** cwd must exist or spawn fails outright; rootDir is always there. */
function possibleCwd(rootDir) {
  return rootDir && rootDir.length > 0 ? rootDir : process.cwd();
}

/** First non-empty stderr line, useful as a concrete failure reason. */
function firstLine(text) {
  const line = String(text || '').split(/\r?\n/).find((l) => l.trim());
  return line ? line.trim().slice(0, 400) : '';
}

/**
 * MongoDB reachability for the wizard. `resolveBinary` is injected by main.js
 * (payload manifest first, embedded baseline second) so this module stays
 * testable without Electron or a packaged app.
 */
async function probeStorage({ mode, connectString, userDataDir, resolveBinary, spawnImpl }) {
  const normalized = normalizeMode(mode);
  const value = String(connectString == null ? '' : connectString).trim();

  if (normalized === 'sqlite') {
    return { ok: true, detail: '本地 SQLite 无需连接测试', mode: 'local' };
  }
  if (!isMongoConnectionString(value)) {
    return { ok: false, detail: '连接串必须以 mongodb:// 或 mongodb+srv:// 开头' };
  }

  const target = parseMongoTarget(value);
  let binary = null;
  if (typeof resolveBinary === 'function') {
    try { binary = resolveBinary(userDataDir); } catch { binary = null; }
  }
  if (binary && binary.binPath) {
    const strong = await probeViaBinary({
      binPath: binary.binPath,
      rootDir: binary.rootDir,
      userDataDir,
      connectString: value,
      timeoutMs: PROBE_TIMEOUT_MS,
      spawnImpl,
    });
    if (strong) return strong;
  }

  if (!target) {
    return {
      ok: false,
      weak: true,
      detail: '未找到本地服务二进制（开发模式），无法解析 SRV 记录；请使用 mongodb:// 直连地址重试',
    };
  }
  const reachable = await tcpReachable(target.host, target.port);
  return reachable
    ? { ok: true, weak: true, mode: 'tcp', detail: `仅检测到端口可达（开发模式）：${target.host}:${target.port}` }
    : { ok: false, weak: true, detail: `无法连接 ${target.host}:${target.port}（开发模式：仅做了 TCP 端口探测）` };
}

/**
 * Standalone entry point: node storageProbe.js <connectString> — lets the
 * agreed probe contract be exercised without launching the GUI.
 */
if (require.main === module) {
  const connectString = process.argv[2] || '';
  const userDataDir = process.env.LIBRA_USER_DATA_DIR || process.cwd();
  const binPath = process.env.LIBRA_PROBE_BIN || '';
  const resolveBinary = binPath ? () => ({ binPath, rootDir: path.dirname(binPath) }) : null;
  probeStorage({ mode: 'mongo', connectString, userDataDir, resolveBinary }).then((result) => {
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });
}

module.exports = {
  MONGO_PREFIXES,
  PROBE_TIMEOUT_MS,
  normalizeMode,
  isMongoConnectionString,
  parseMongoTarget,
  normalizeRemoteUrl,
  tcpReachable,
  hasProbeContract,
  probeStorage,
};
