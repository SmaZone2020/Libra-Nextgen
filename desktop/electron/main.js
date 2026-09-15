const { app, BrowserWindow, ipcMain, shell: osShell, Menu, Tray, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { ServiceProcess } = require('./serviceProcess');
const {
  normalizeMode,
  isMongoConnectionString,
  normalizeRemoteUrl,
  probeStorage,
} = require('./storageProbe');
const {
  updateServicePayload,
  updateWebSilently,
  refreshAgentTemplates,
  readManifest,
  readLocalTag,
  ridFor,
} = require('./updater');

// Default target; override with LIBRA_CONSOLE_URL if needed.
const DEFAULT_URL = process.env.LIBRA_CONSOLE_URL || 'http://localhost:5173/';

// GitHub release source for payload/web/agent-template updates.
const UPDATE_SOURCE = {
  owner: process.env.LIBRA_UPDATE_OWNER || 'SmaZone2020',
  repo: process.env.LIBRA_UPDATE_REPO || 'Libra-Nextgen',
  token: process.env.GITHUB_TOKEN || undefined,
};

// UA token the console detects to render its own transparent top bar.
// Keep in sync with src/console/src/desktop/DesktopTopBar.tsx LIBRA_DESKTOP_UA.
const DESKTOP_TOKEN = 'LibraDesktop/0.1.0';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1500;
const FRAME_BG = '#0b0f14';

let mainWindow = null;
let failures = 0;
let retryTimer = null;
let targetUrl = DEFAULT_URL;
let tray = null;
let userDataDir = '';
let installedPayload = null;
let closeBehavior = 'quit'; // 'quit' | 'tray' — what the window close button does
let isQuitting = false;     // real quit (tray Quit / Cmd+Q) bypasses tray-hide
let remoteEntry = null;     // recorded remote console origin (shell state, not libra.conf.json)
let setupMode = false;      // first-run wizard active: never auto-navigate away from it

// Splash shown while the local backend starts, so the shell never navigates
// to the dev URL first when a payload/baseline is present.
const SPLASH_URL = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{background:#0b0f14;color:#9aa4b2;display:flex;align-items:center;justify-content:center;font:14px/1.6 system-ui}main{text-align:center}main p{margin:6px 0 0;opacity:.65}</style></head><body><main>Starting Libra local service…<p>please wait</p></main></body></html>',
)}`;

// Local .NET sidecar (desktop architecture: payload/latest under userData).
const service = new ServiceProcess();

/** Read the installed payload manifest, if any, under userData/payload/latest. */
function loadPayloadManifest(userDataDir) {
  const manifestPath = path.join(userDataDir, 'payload', 'latest', 'version.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest && manifest.backend && manifest.port) {
      return { ...manifest, rootDir: path.dirname(manifestPath) };
    }
  } catch {
    // No installed payload (dev/demo mode) — ignore.
  }
  return null;
}

/** Listener port from the desktop libra.conf.json, if any (baseline fallback). */
function configListenerPort(userDataDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userDataDir, 'libra.conf.json'), 'utf8'));
    const port = cfg && cfg.listener && cfg.listener.port;
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Embedded baseline payload (electron-builder extraResources):
 * resources/baseline-service (raw self-contained publish dir) + baseline-web
 * (console dist served via LIBRA_WEB_ROOT). Used when no userData payload is
 * installed yet — the shell still runs a real local backend out of the box.
 */
function loadBaselinePayload(userDataDir) {
  const serviceDir = path.join(process.resourcesPath, 'baseline-service');
  const webDir = path.join(process.resourcesPath, 'baseline-web');
  if (!fs.existsSync(serviceDir)) return null;

  const exeName = fs.readdirSync(serviceDir).find((f) => /^LibraNextgen\.Server(\.exe)?$/i.test(f));
  if (!exeName) return null;

  return {
    tag: 'baseline',
    backend: exeName,
    port: configListenerPort(userDataDir) ?? 5270,
    webRoot: 'web',
    rootDir: serviceDir,
    baseline: true,
    baselineWeb: fs.existsSync(webDir) ? webDir : null,
  };
}

/** Read the desktop libra.conf.json (null when missing/unreadable). */
function readUserConfig(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(userDataDir, 'libra.conf.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Atomically persist libra.conf.json (single source of truth for the shell). */
function writeUserConfig(userDataDir, config) {
  const configPath = path.join(userDataDir, 'libra.conf.json');
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configPath);
}

/**
 * Shell-owned state lives outside libra.conf.json: that file is the service
 * contract (§3 of the architecture doc) and the server must never see shell
 * routing preferences in it.
 */
function shellStatePath(userDataDir) {
  return path.join(userDataDir, 'shell-state.json');
}

function readShellState(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(shellStatePath(userDataDir), 'utf8'));
  } catch {
    return null;
  }
}

function writeShellState(userDataDir, state) {
  const statePath = shellStatePath(userDataDir);
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}

/** Record the remote console origin; a recorded entry survives restarts. */
function rememberRemoteEntry(url) {
  remoteEntry = url;
  try {
    writeShellState(userDataDir, { schemaVersion: 1, entry: 'remote', remoteUrl: url });
  } catch (err) {
    console.error('[shell] failed to persist shell state:', err.message);
  }
}

/** Drop the remote entry so the next launch goes back to the local service. */
function forgetRemoteEntry() {
  remoteEntry = null;
  try {
    writeShellState(userDataDir, { schemaVersion: 1, entry: 'local' });
  } catch (err) {
    console.error('[shell] failed to persist shell state:', err.message);
  }
}

/**
 * First-run config written by the setup wizard. The wizard owns creation, so
 * existing listener/desktop sections are preserved when a file does exist;
 * the wizard's own choice decides `storage`.
 */
function buildSetupConfig(choice) {
  const existing = readUserConfig(userDataDir) || {};
  return {
    ...existing,
    schemaVersion: 1,
    storage: { mode: choice.mode, connectString: choice.connectString, dbPath: '' },
    listener: existing.listener || { port: 5270, bindLoopback: true },
    desktop: existing.desktop || { closeBehavior: 'quit' },
  };
}

/**
 * Live settings-UI writes must not create a config out of nowhere: doing so
 * would silently skip the first-run wizard. Report instead of inventing one.
 */
function canWriteConfig() {
  return !!readUserConfig(userDataDir);
}

/**
 * Close-window preference from the config: 'quit' closes the app (and stops
 * the local service with it); 'tray' hides the window and keeps everything
 * running. The server ignores the desktop section (unmapped keys skipped).
 */
function readCloseBehavior(userDataDir) {
  const cfg = readUserConfig(userDataDir);
  const value = cfg && cfg.desktop && cfg.desktop.closeBehavior;
  return value === 'tray' ? 'tray' : 'quit';
}

/** Product logo for window/tray: packaged copy (resources/branding) first,
 * repository asset when running from source. Null when neither exists. */
function productIconPath() {
  const packaged = path.join(process.resourcesPath, 'branding', 'icon.png');
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, '..', '..', 'assets', 'branding', 'icon2-app.png');
  return fs.existsSync(dev) ? dev : null;
}

function getWindowOptions() {
  const icon = productIconPath();
  const common = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: FRAME_BG,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (process.platform === 'win32') {
    // Hidden native title bar (no caption buttons drawn). The console page
    // draws a transparent draggable top bar + window controls instead, while
    // the OS still keeps resize borders, snapping and shadows.
    return { ...common, titleBarStyle: 'hidden' };
  }
  if (process.platform === 'darwin') {
    // Full-bleed content; native traffic lights stay visible on the left.
    return { ...common, titleBarStyle: 'hiddenInset' };
  }
  // Linux: no reliable hidden title bar, fall back to a frameless window.
  return { ...common, frame: false };
}

function applyWindowChrome() {
  // Remove the default menu bar everywhere except macOS, where the app menu
  // is required for native shortcuts (copy/paste, Cmd+Q...).
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }
}

function loadTarget() {
  if (!mainWindow) return;
  // The wizard is the fallback page while no storage backend is chosen.
  if (setupMode) {
    mainWindow.loadFile(path.join(__dirname, 'setup.html'));
    return;
  }
  mainWindow.loadURL(targetUrl);
}

function createTray() {
  // Product logo at 16x16 for the tray; fall back to a transparent pixel only
  // when no icon asset is available (e.g. bare source checkout without assets).
  const iconPath = productIconPath();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    { label: 'Show Libra', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Check for Updates…', click: () => runManualUpdate().catch(() => {}) },
    { label: 'Open Data Directory', click: () => osShell.openPath(userDataDir) },
    { label: 'Open Remote Entry…', click: () => openRemoteEntry() },
    { type: 'separator' },
    // Escape hatch: the only way back from a recorded remote entry, since a
    // remote session never starts the local service on its own.
    ...(remoteEntry ? [{ label: 'Use Local Service', click: () => applyRemoteEntry(null) }] : []),
    ...(installedPayload ? [{ label: 'Restart Local Service', click: () => restartLocalService() }] : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Libra Desktop');
  tray.setContextMenu(menu);
  tray.on('double-click', () => showMainWindow());
}

/** Spawn options for a payload: baseline pins the port and points the server
 * at the embedded console web (LIBRA_WEB_ROOT); payloads use defaults. */
function startOptionsFor(payload) {
  if (!payload || !payload.baseline) return undefined;
  return {
    pinPort: true,
    extraEnv: payload.baselineWeb ? { LIBRA_WEB_ROOT: payload.baselineWeb } : {},
  };
}

/** Fast retry for a just-restarted backend; a cold start needs the long path. */
async function restartLocalService() {
  if (!installedPayload) return;
  try {
    await service.stop();
    await service.start(installedPayload, userDataDir, startOptionsFor(installedPayload));
    const port = service.effectivePort ?? installedPayload.port;
    // Only re-point a window that already shows the local backend: a remote
    // session or the setup wizard must not be yanked to 127.0.0.1.
    if (mainWindow && targetUrl.startsWith('http://127.0.0.1:')) mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  } catch (err) {
    dialog.showErrorBox('Libra Desktop', `Failed to restart the local service: ${err.message}`);
  }
}

/**
 * Cold start of the local backend, shared by the configured launch path, the
 * setup wizard and a tray switch back from a remote entry. `pending` is the
 * payload to adopt (first launch resolves it later, once the config exists).
 */
async function startLocalService(pending) {
  const payload = pending || installedPayload;
  if (!payload) {
    showBootScreen(-1, 'No local service payload or embedded baseline was found');
    return;
  }
  installedPayload = payload;
  try {
    await service.start(payload, userDataDir, startOptionsFor(payload));
    targetUrl = `http://127.0.0.1:${service.effectivePort ?? payload.port}/`;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(targetUrl);
  } catch (err) {
    console.error('failed to start local backend:', err.message);
    showBootScreen(-1, `Local backend failed to start: ${err.message}`);
  }
}

async function runManualUpdate(onProgress) {
  const busy = !mainWindow || !installedPayload;
  try {
    const result = await updateServicePayload({
      ...UPDATE_SOURCE,
      userDataDir,
      log: console.log,
      onProgress: onProgress || null,
    });
    if (!result) {
      if (mainWindow) { /* console banner reflects up-to-date state */ }
      return;
    }
    installedPayload = { ...result, rootDir: path.join(userDataDir, 'payload', 'latest') };
    if (onProgress) onProgress({ phase: 'restart' });
    await service.stop();
    await service.start(installedPayload, userDataDir, startOptionsFor(installedPayload));
    const port = service.effectivePort ?? installedPayload.port;
    targetUrl = `http://127.0.0.1:${port}/`;
    if (mainWindow) mainWindow.loadURL(targetUrl);
    // Refresh agent template cache in the background; never fails the update.
    refreshAgentTemplates({ ...UPDATE_SOURCE, userDataDir }).catch(() => {});
  } catch (err) {
    dialog.showErrorBox('Update failed', err.message);
    throw err;
  }
}

/**
 * Switch the window between the recorded remote console and the local service.
 * `url = null` means "Use Local Service" (tray escape hatch): the recorded
 * entry is dropped and the local backend is started on demand.
 */
async function applyRemoteEntry(url) {
  if (!url) {
    forgetRemoteEntry();
    createTraySafely();
    try {
      await service.stop();
    } catch (err) {
      // Nothing was running; the switch still succeeds.
    }
    targetUrl = DEFAULT_URL;
    if (!installedPayload) {
      installedPayload = loadPayloadManifest(userDataDir);
      if (!installedPayload) installedPayload = loadBaselinePayload(userDataDir);
    }
    await startLocalService(installedPayload);
    return;
  }

  // Remote sessions never run a local backend; stop one we own.
  try {
    await service.stop();
  } catch (err) {
    console.log('[shell] stopping local service for remote entry failed:', err.message);
  }
  clearTimeout(retryTimer);
  failures = 0;
  rememberRemoteEntry(url);
  createTraySafely();
  targetUrl = url;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(url);
}

function openRemoteEntry() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  if (remoteEntry) {
    targetUrl = remoteEntry;
    mainWindow.loadURL(remoteEntry);
    return;
  }
  // The console itself has the backend-origin switcher (its disconnect page);
  // the shell only needs to surface the entry point for the local mode.
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: 'Remote entry',
    detail: 'Use the backend switcher inside the console (Disconnect page) to connect to a deployed server.',
  });
}

/** Rebuild the tray menu so conditional items reflect the current mode. */
function createTraySafely() {
  try {
    if (tray) {
      tray.destroy();
      tray = null;
    }
    createTray();
  } catch (err) {
    // Tray creation can fail on headless/service sessions.
    console.log('[shell] tray unavailable:', err.message);
  }
}

/** Persist the storage config the service reads at startup, then restart it.
 *  Merges into the existing file so shell-owned sections (listener, desktop)
 *  survive storage switches. */
async function setStorageConfig(settings) {
  // Refuse to create a config: the first-run wizard is the only writer that
  // may do that, otherwise a settings click would silently skip the wizard.
  if (!canWriteConfig()) {
    console.log('[shell] ignoring storage change: no libra.conf.json yet (first-run setup pending)');
    return false;
  }
  const existing = readUserConfig(userDataDir) || { schemaVersion: 1 };
  existing.schemaVersion = 1;
  existing.storage = {
    mode: settings.mode === 'mongo' ? 'mongo' : 'sqlite',
    connectString: settings.connectString || '',
    dbPath: settings.dbPath || '',
  };
  writeUserConfig(userDataDir, existing);
  await restartLocalService();
  return true;
}

/** Bring the main window back from the tray / minimized state. */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Listener section the shell controls (port + loopback bind). Read from the
 * shared libra.conf.json so the settings UI and the shell agree; the server
 * applies it at startup (Program.cs desktop-listener override).
 */
function getListenerConfig() {
  const cfg = readUserConfig(userDataDir);
  const listener = cfg && cfg.listener;
  return {
    port: Number.isInteger(listener?.port) && listener.port >= 1 && listener.port <= 65535
      ? listener.port
      : 5270,
    bindLoopback: listener ? listener.bindLoopback !== false : true,
  };
}

/** Persist the listener section (merge) and restart the local service. */
async function setListenerConfig(settings) {
  const existing = readUserConfig(userDataDir) || { schemaVersion: 1 };
  const port = Number(settings?.port);
  existing.listener = {
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 5270,
    bindLoopback: settings?.bindLoopback !== false,
  };
  writeUserConfig(userDataDir, existing);
  await restartLocalService();
  return true;
}

function showBootScreen(code, description) {
  const query = {
    target: encodeURIComponent(DEFAULT_URL),
    detail: encodeURIComponent(`${code}: ${description}`),
  };
  mainWindow.loadFile(path.join(__dirname, 'boot.html'), { query });
}

function createWindow() {
  mainWindow = new BrowserWindow(getWindowOptions());

  // Stamp the UA so the console knows it runs inside the desktop shell.
  const base = mainWindow.webContents.getUserAgent();
  mainWindow.webContents.setUserAgent(
    base.includes('LibraDesktop') ? base : `${base} ${DESKTOP_TOKEN}`,
  );

  // target=_blank / window.open requests open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    osShell.openExternal(url);
    return { action: 'deny' };
  });

  // Auto-retry while the dev server is starting, then fall back to boot.html
  // (which still offers window controls) instead of a dead blank window.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED: navigation cancelled by retry
    if (setupMode) return;        // local file wizard: never navigate elsewhere
    clearTimeout(retryTimer);
    failures += 1;
    if (failures <= MAX_RETRIES) {
      retryTimer = setTimeout(loadTarget, RETRY_DELAY_MS);
    } else {
      showBootScreen(errorCode, errorDescription);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) return;
    const url = mainWindow.webContents.getURL();
    console.log('[shell] loaded', url);
    if (url.startsWith('http')) failures = 0;
  });

  // Keep the console's window-control buttons in sync with the OS state.
  const notifyMaximized = () =>
    mainWindow.webContents.send('shell:maximize-changed', mainWindow.isMaximized());
  mainWindow.on('maximize', notifyMaximized);
  mainWindow.on('unmaximize', notifyMaximized);

  // F12 / Ctrl+Shift+I toggles DevTools (no menu bar anymore).
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const key = (input.key || '').toLowerCase();
    const modifier = process.platform === 'darwin' ? input.meta : input.control;
    if (input.type === 'keyDown' && ((modifier && input.shift && key === 'i') || key === 'f12')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    clearTimeout(retryTimer);
    mainWindow = null;
  });

  // Window close honors the configurable close behavior (console Settings →
  // "Close window action"): 'tray' hides to the tray with the local service
  // alive; 'quit' quits the app (the service is reaped in will-quit).
  // The wizard is exempt: closing it must exit cleanly, never leave a
  // hidden half-initialised shell in the tray.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (closeBehavior === 'tray' && readUserConfig(userDataDir)) mainWindow.hide();
    else app.quit();
  });

  // With a local backend present, show the splash first (never the dev URL);
  // without one (pure dev/demo) load the configured target as before.
  if (installedPayload) mainWindow.loadURL(SPLASH_URL);
  else loadTarget();
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

/**
 * First-run wizard: the ONLY content of the window, and a pure file:// page
 * with no shell capabilities beyond the setup IPC surface. No local service
 * exists yet, so nothing may navigate away from it before the user chooses.
 */
function createSetupWindow() {
  createWindow();
  if (!mainWindow) return;
  clearTimeout(retryTimer); // the wizard never needs the dev-URL retry loop
  mainWindow.loadFile(path.join(__dirname, 'setup.html'));
}

// Safety net: if the first page load stalls (no paint, no failure event) the
// window must still become visible instead of staying hidden.
function ensureWindowVisible() {
  const ensureVisible = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 4000);
  mainWindow?.once('closed', () => clearTimeout(ensureVisible));
}

// Headless/GUI smoke hook (LIBRA_SMOKE_EXIT_MS). Scheduled for every launch
// path — including the wizard — so the existing smoke hook keeps working.
function scheduleSmokeExit() {
  const smokeExit = Number(process.env.LIBRA_SMOKE_EXIT_MS || 0);
  if (smokeExit > 0) {
    setTimeout(() => {
      console.log('[shell] smoke exit after', smokeExit, 'ms');
      app.quit();
    }, smokeExit);
  }
}

/**
 * Binary the storage probe spawns: the installed payload first, the embedded
 * baseline second — same order the shell uses for the real backend. Returns
 * null when neither exists (bare source checkout: dev fallback applies).
 */
function resolveServiceBinary(dir) {
  const payload = loadPayloadManifest(dir) || loadBaselinePayload(dir);
  if (!payload) return null;
  const exeName =
    process.platform === 'win32' && !payload.backend.toLowerCase().endsWith('.exe')
      ? `${payload.backend}.exe`
      : payload.backend;
  const binPath = path.join(payload.rootDir, exeName);
  return fs.existsSync(binPath) ? { binPath, rootDir: payload.rootDir } : null;
}

/** First launch resolves the payload only after the wizard wrote the config. */
async function resolvePayloadForStart() {
  if (installedPayload) return installedPayload;
  return loadPayloadManifest(userDataDir) || loadBaselinePayload(userDataDir);
}

/**
 * Remote server liveness, same convention as the console's pingBackend and
 * serviceProcess.isAlive: 200/401/500 all mean "a Libra backend is alive".
 * Anything else is reported as "reachable but not Libra" so the user can see
 * the ambiguity instead of being told the server is fine.
 */
function testRemoteServer(input, timeoutMs = 8000) {
  const origin = normalizeRemoteUrl(input);
  if (!origin) {
    return Promise.resolve({ ok: false, detail: '服务器地址无效，请填写 http(s):// 开头的主机地址' });
  }
  return new Promise((resolve) => {
    const target = new URL(origin);
    const secure = target.protocol === 'https:';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = (secure ? https : http).get(
      {
        // `hostname` takes a bare host: passing the origin breaks DNS lookup.
        hostname: target.hostname,
        port: target.port || (secure ? 443 : 80),
        path: '/api/auth/status',
        timeout: timeoutMs,
        headers: { accept: 'application/json' },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          if (size > 4096) return; // enough to judge the body, never unbounded
          size += chunk.length;
          chunks.push(chunk);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ([200, 401, 500].includes(res.statusCode)) {
            // 401/500 still prove a Libra backend: its auth middleware answered.
            finish({ ok: true, detail: `已连接 Libra 服务端 ${origin}（HTTP ${res.statusCode}）` });
            return;
          }
          const looksHtml = /<!doctype html|<html/i.test(body);
          finish({
            ok: false,
            detail: `目标响应 HTTP ${res.statusCode}，${looksHtml ? '返回网页而非 Libra 接口，可能不是 Libra 服务端' : '不是 Libra 服务端接口'}`,
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, detail: `连接 ${origin} 超时（${Math.round(timeoutMs / 1000)} 秒）` });
    });
    req.on('error', (err) => finish({ ok: false, detail: `无法连接 ${origin}：${err.message}` }));
  });
}

/**
 * Wizard commit path. Order matters: the config is written before anything
 * starts, so an interrupted choice can never leave a service running against
 * an unwritten config.
 */
async function completeSetup(choice) {
  const mode = choice && choice.mode;
  try {
    if (mode === 'mongo') {
      const connectString = String(choice.connectString || '').trim();
      if (!isMongoConnectionString(connectString)) {
        return { ok: false, error: '连接串必须以 mongodb:// 或 mongodb+srv:// 开头' };
      }
      fs.mkdirSync(userDataDir, { recursive: true });
      writeUserConfig(userDataDir, buildSetupConfig({ mode: 'mongo', connectString }));
      setupMode = false;
      forgetRemoteEntry();
      await startLocalService(await resolvePayloadForStart());
      return { ok: true };
    }

    if (mode === 'remote') {
      const url = normalizeRemoteUrl(choice.url);
      if (!url) return { ok: false, error: '服务器地址无效，请填写 http(s):// 开头的主机地址' };
      // libra.conf.json still needs a usable storage section: a later
      // "Use Local Service" switch starts the backend from this same file.
      fs.mkdirSync(userDataDir, { recursive: true });
      writeUserConfig(userDataDir, buildSetupConfig({ mode: 'sqlite', connectString: '' }));
      setupMode = false;
      await applyRemoteEntry(url);
      return { ok: true };
    }

    fs.mkdirSync(userDataDir, { recursive: true });
    writeUserConfig(userDataDir, buildSetupConfig({ mode: 'sqlite', connectString: '' }));
    setupMode = false;
    forgetRemoteEntry();
    await startLocalService(await resolvePayloadForStart());
    return { ok: true };
  } catch (err) {
    console.error('[shell] setup failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// --- Window controls driven by the console's transparent top bar ---
ipcMain.on('shell:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.on('shell:toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('shell:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
ipcMain.handle('shell:is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});
ipcMain.handle('shell:retry', () => {
  failures = 0;
  loadTarget();
});

// --- Desktop-shell capabilities (console Settings / tray) ---
ipcMain.handle('shell:get-app-info', () => ({
  version: app.getVersion(),
  userDataDir,
  payloadTag: installedPayload ? installedPayload.tag : null,
  rid: ridFor(process.platform, process.arch),
}));
ipcMain.handle('shell:run-update', async (event) => {
  try {
    const send = (payload) => {
      try { event.sender.send('shell:update-progress', payload); } catch { /* window gone */ }
    };
    await runManualUpdate(send);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('shell:open-data-dir', () => osShell.openPath(userDataDir));
ipcMain.handle('shell:set-storage-config', (_event, settings) => setStorageConfig(settings));
ipcMain.handle('shell:restart-service', () => restartLocalService());
ipcMain.handle('shell:get-close-behavior', () => closeBehavior);
ipcMain.handle('shell:set-close-behavior', (_event, value) => {
  const next = value === 'tray' ? 'tray' : 'quit';
  try {
    const existing = readUserConfig(userDataDir) || { schemaVersion: 1 };
    existing.desktop = { ...(existing.desktop || {}), closeBehavior: next };
    writeUserConfig(userDataDir, existing);
    closeBehavior = next;
    return true;
  } catch (err) {
    console.error('[shell] failed to save close behavior:', err.message);
    return false;
  }
});
ipcMain.handle('shell:get-listener-config', () => getListenerConfig());
ipcMain.handle('shell:set-listener-config', (_event, settings) => setListenerConfig(settings));

// --- First-run setup wizard (setup.html only) ---
ipcMain.handle('shell:get-setup-state', () => ({
  // A recorded remote entry is a completed setup too: no wizard on relaunch.
  needsSetup: !readUserConfig(userDataDir) && !remoteEntry,
}));

ipcMain.handle('shell:test-storage-config', async (_event, settings) => {
  try {
    const result = await probeStorage({
      mode: settings && settings.mode,
      connectString: settings && settings.connectString,
      userDataDir,
      resolveBinary: resolveServiceBinary,
    });
    return { ok: result.ok === true, detail: result.detail || '' };
  } catch (err) {
    return { ok: false, detail: `存储探测失败：${err.message}` };
  }
});

ipcMain.handle('shell:test-remote-server', (_event, url) => testRemoteServer(url));

ipcMain.handle('shell:complete-setup', (_event, choice) => completeSetup(choice));

app.whenReady().then(async () => {
  applyWindowChrome();

  // Start the bundled backend when a payload is installed; keep the plain
  // dev/demo mode otherwise. userData is passed so the service reads the same
  // libra.conf.json the shell writes (single source of truth).
  // userData can be pinned via LIBRA_USER_DATA_DIR (same name as the server's
  // env override) for tests and portable setups; defaults to Electron's own.
  userDataDir = process.env.LIBRA_USER_DATA_DIR || app.getPath('userData');
  closeBehavior = readCloseBehavior(userDataDir);
  const userConfig = readUserConfig(userDataDir);
  const shellState = readShellState(userDataDir);
  remoteEntry = shellState && shellState.entry === 'remote' && typeof shellState.remoteUrl === 'string'
    ? shellState.remoteUrl
    : null;

  if (!userConfig && !remoteEntry) {
    // First run: no storage backend has been chosen yet, so the local service
    // must not start (it would stall on the unreachable cloud Mongo default).
    // The wizard is the only content and is the only way forward.
    setupMode = true;
    console.log('[shell] first run: showing storage setup wizard; local service not started');
    createTraySafely();
    createSetupWindow();
    scheduleSmokeExit();
    return;
  }

  if (remoteEntry) {
    // A recorded remote entry wins over the local service on every launch.
    console.log('[shell] remote entry:', remoteEntry);
    targetUrl = remoteEntry;
    createTraySafely();
    createWindow();
    ensureWindowVisible();
    scheduleSmokeExit();
    updateWebSilently({ ...UPDATE_SOURCE, userDataDir }).catch(() => {});
    return;
  }

  installedPayload = loadPayloadManifest(userDataDir);

  // No userData payload yet -> use the embedded baseline service so an
  // installed app still starts a local backend out of the box.
  if (!installedPayload) {
    const baseline = loadBaselinePayload(userDataDir);
    if (baseline) {
      console.log('[shell] backend source: embedded baseline');
      installedPayload = baseline;
    }
  }

  if (installedPayload) {
    console.log('[shell] backend source:', installedPayload.baseline ? 'embedded baseline' : 'payload');
  } else {
    console.log('[shell] backend source: none (dev/demo URL)');
  }

  createTraySafely();

  // Create the window FIRST so a window always appears promptly, then bring
  // the local backend up and navigate to it once it is ready.
  createWindow();
  ensureWindowVisible();

  if (installedPayload) {
    await startLocalService(installedPayload);
  }

  scheduleSmokeExit();

  // Best-effort silent web refresh; embedded baseline remains the fallback.
  updateWebSilently({ ...UPDATE_SOURCE, userDataDir }).catch(() => {});
});

// macOS: re-create whichever window the current state calls for.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length > 0) return;
  if (setupMode) createSetupWindow();
  else createWindow();
});

// Reap a backend this shell started, on quit.
app.on('will-quit', () => {
  service.stop().catch(() => {});
});

// Mark real quits (tray Quit / Cmd+Q / OS shutdown) so the window close
// handler never turns them into tray-hides.
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
