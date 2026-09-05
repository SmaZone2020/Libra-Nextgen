const { app, BrowserWindow, ipcMain, shell: osShell, Menu, Tray, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { ServiceProcess } = require('./serviceProcess');
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
    { label: 'Check for Updates…', click: () => runManualUpdate() },
    { label: 'Open Data Directory', click: () => osShell.openPath(userDataDir) },
    { label: 'Open Remote Entry…', click: () => openRemoteEntry() },
    { type: 'separator' },
    { label: 'Restart Local Service', click: () => restartLocalService() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Libra Desktop');
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
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

async function restartLocalService() {
  if (!installedPayload) return;
  try {
    await service.stop();
    await service.start(installedPayload, userDataDir, startOptionsFor(installedPayload));
    const port = service.effectivePort ?? installedPayload.port;
    if (mainWindow && targetUrl.startsWith('http://127.0.0.1:')) mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  } catch (err) {
    dialog.showErrorBox('Libra Desktop', `Failed to restart the local service: ${err.message}`);
  }
}

async function runManualUpdate() {
  const busy = !mainWindow || !installedPayload;
  try {
    const result = await updateServicePayload({ ...UPDATE_SOURCE, userDataDir, log: console.log });
    if (!result) {
      if (mainWindow) { /* console banner reflects up-to-date state */ }
      return;
    }
    installedPayload = { ...result, rootDir: path.join(userDataDir, 'payload', 'latest') };
    await service.stop();
    await service.start(installedPayload, userDataDir, startOptionsFor(installedPayload));
    const port = service.effectivePort ?? installedPayload.port;
    targetUrl = `http://127.0.0.1:${port}/`;
    if (mainWindow) mainWindow.loadURL(targetUrl);
    // Refresh agent template cache in the background; never fails the update.
    refreshAgentTemplates({ ...UPDATE_SOURCE, userDataDir }).catch(() => {});
  } catch (err) {
    dialog.showErrorBox('Update failed', err.message);
  }
}

function openRemoteEntry() {
  if (!mainWindow) return;
  // The console itself has the backend-origin switcher (its disconnect page);
  // the shell only needs to surface the entry point.
  mainWindow.show();
  mainWindow.focus();
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: 'Remote entry',
    detail: 'Use the backend switcher inside the console (Disconnect page) to connect to a deployed server.',
  });
}

/** Persist the storage config the service reads at startup, then restart it. */
async function setStorageConfig(settings) {
  const configPath = path.join(userDataDir, 'libra.conf.json');
  const payload = {
    schemaVersion: 1,
    storage: {
      mode: settings.mode === 'mongo' ? 'mongo' : 'sqlite',
      connectString: settings.connectString || '',
      dbPath: settings.dbPath || '',
      fallback: settings.fallback !== false,
    },
  };
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, configPath);
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

  loadTarget();
  mainWindow.once('ready-to-show', () => mainWindow.show());
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
ipcMain.handle('shell:run-update', async () => {
  try {
    await runManualUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('shell:open-data-dir', () => osShell.openPath(userDataDir));
ipcMain.handle('shell:set-storage-config', (_event, settings) => setStorageConfig(settings));
ipcMain.handle('shell:restart-service', () => restartLocalService());

app.whenReady().then(async () => {
  applyWindowChrome();

  // Start the bundled backend when a payload is installed; keep the plain
  // dev/demo mode otherwise. userData is passed so the service reads the same
  // libra.conf.json the shell writes (single source of truth).
  // userData can be pinned via LIBRA_USER_DATA_DIR (same name as the server's
  // env override) for tests and portable setups; defaults to Electron's own.
  userDataDir = process.env.LIBRA_USER_DATA_DIR || app.getPath('userData');
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

  try {
    createTray();
  } catch (err) {
    // Tray creation can fail on headless/service sessions; the shell must
    // still run (window + service are the critical path).
    console.log('[shell] tray unavailable:', err.message);
  }

  // Create the window FIRST so a window always appears promptly, then bring
  // the local backend up and navigate to it once it is ready.
  createWindow();

  // Safety net: if the first page load stalls (no paint, no failure event)
  // the window must still become visible instead of staying hidden.
  const ensureVisible = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 4000);
  mainWindow?.once('closed', () => clearTimeout(ensureVisible));

  if (installedPayload) {
    try {
      await service.start(installedPayload, userDataDir, startOptionsFor(installedPayload));
      targetUrl = `http://127.0.0.1:${service.effectivePort ?? installedPayload.port}/`;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(targetUrl);
    } catch (err) {
      console.error('failed to start local backend:', err.message);
      showBootScreen(-1, `Local backend failed to start: ${err.message}`);
    }
  }

  // Headless/GUI smoke hook: exit automatically after N ms (LIBRA_SMOKE_EXIT_MS).
  const smokeExit = Number(process.env.LIBRA_SMOKE_EXIT_MS || 0);
  if (smokeExit > 0) {
    setTimeout(() => {
      console.log('[shell] smoke exit after', smokeExit, 'ms');
      app.quit();
    }, smokeExit);
  }

  // Best-effort silent web refresh; embedded baseline remains the fallback.
  updateWebSilently({ ...UPDATE_SOURCE, userDataDir }).catch(() => {});

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Reap a backend this shell started, on quit.
app.on('will-quit', () => {
  service.stop().catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
