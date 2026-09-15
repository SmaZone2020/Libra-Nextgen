const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Bridge consumed by the console's transparent top bar (and boot.html), plus
// desktop-shell capabilities surfaced in the console Settings (desktop only).
contextBridge.exposeInMainWorld('libraDesktop', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
  isMaximized: () => ipcRenderer.invoke('shell:is-maximized'),
  retry: () => ipcRenderer.invoke('shell:retry'),
  onMaximizeChange: (cb) => subscribe('shell:maximize-changed', cb),

  // Desktop-shell capabilities (invoked only when present).
  getAppInfo: () => ipcRenderer.invoke('shell:get-app-info'),
  runUpdate: () => ipcRenderer.invoke('shell:run-update'),
  openDataDir: () => ipcRenderer.invoke('shell:open-data-dir'),
  setStorageConfig: (settings) => ipcRenderer.invoke('shell:set-storage-config', settings),
  restartService: () => ipcRenderer.invoke('shell:restart-service'),
  getCloseBehavior: () => ipcRenderer.invoke('shell:get-close-behavior'),
  setCloseBehavior: (value) => ipcRenderer.invoke('shell:set-close-behavior', value),
  getListenerConfig: () => ipcRenderer.invoke('shell:get-listener-config'),
  setListenerConfig: (settings) => ipcRenderer.invoke('shell:set-listener-config', settings),
  onUpdateProgress: (cb) => subscribe('shell:update-progress', cb),

  // First-run setup wizard (setup.html only; the console never sees these).
  getSetupState: () => ipcRenderer.invoke('shell:get-setup-state'),
  testStorageConfig: (settings) => ipcRenderer.invoke('shell:test-storage-config', settings),
  testRemoteServer: (url) => ipcRenderer.invoke('shell:test-remote-server', url),
  completeSetup: (choice) => ipcRenderer.invoke('shell:complete-setup', choice),
});
