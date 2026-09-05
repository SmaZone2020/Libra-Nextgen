// Service process manager: spawns the bundled Libra-Nextgen backend (.NET
// sidecar), probes readiness and reaps it on quit.
//
// Ported from desktop/LibraDesktop/Core/BackendProcess.cs with the desktop
// architecture contract (docs/desktop-electron-architecture.md §2, §3):
//   - the backend is launched with --user-data-dir <userData> so it reads
//     libra.conf.json from the same directory the shell writes to;
//   - readiness probe mirrors console pingBackend: 200/401/500 mean alive;
//   - if something already serves the port, it is adopted (external) and
//     never killed.
'use strict';

const { spawn } = require('child_process');
const http = require('http');

/** Ownership of the backend process on the target port. */
const BackendOwnership = {
  None: 'none', // nothing started/known
  External: 'external', // already serving; never killed
  Owned: 'owned', // started by this shell; stopped with it
};

class ServiceProcess {
  constructor({ log = console.log } = {}) {
    this.log = log;
    this.ownership = BackendOwnership.None;
    this.child = null;
  }

  /** Probe http://127.0.0.1:{port}/api/auth/status with a short timeout. */
  static isAlive(port, timeoutMs = 2000) {
    return new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/auth/status', timeout: timeoutMs },
        (res) => resolve([200, 401, 500].includes(res.statusCode)),
      );
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    });
  }

  /**
   * Start the payload backend unless something already serves its port.
   * payload = { backend: <exe name>, port, webRoot, rootDir }
   */
  async start(payload, userDataDir) {
    await this.stop();

    if (await ServiceProcess.isAlive(payload.port)) {
      this.ownership = BackendOwnership.External;
      this.log(`backend already active on port ${payload.port} (external, adopted)`);
      return this.ownership;
    }

    const backendPath =
      process.platform === 'win32' && !payload.backend.toLowerCase().endsWith('.exe')
        ? `${payload.backend}.exe`
        : payload.backend;
    const exe = require('path').join(payload.rootDir, backendPath);

    this.log(`starting backend ${exe} on port ${payload.port} ...`);
    this.child = spawn(exe, ['--user-data-dir', userDataDir], {
      cwd: payload.rootDir,
      windowsHide: true,
      stdio: 'ignore',
    });
    this.child.on('exit', (code) => {
      if (this.ownership === BackendOwnership.Owned) {
        this.log(`backend exited early with code ${code}`);
        this.child = null;
        this.ownership = BackendOwnership.None;
      }
    });

    // Self-contained single-file payloads unpack on first run; allow 60s.
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (this.child === null) {
        throw new Error('backend exited before becoming ready');
      }
      if (await ServiceProcess.isAlive(payload.port)) {
        this.ownership = BackendOwnership.Owned;
        this.log(`backend ready on http://127.0.0.1:${payload.port}/`);
        return this.ownership;
      }
    }

    await this.stop();
    throw new Error(`backend did not become ready on port ${payload.port} within 60s`);
  }

  /** Stop only a backend this shell started. */
  async stop() {
    const child = this.child;
    this.child = null;
    this.ownership = BackendOwnership.None;
    if (!child) return;
    try {
      if (!child.killed) child.kill();
      // Wait briefly for a graceful exit, then force-kill the tree on Windows.
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (process.platform === 'win32' && child.exitCode === null) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      }
    } catch (err) {
      // Best effort; process may already be gone.
    }
  }
}

module.exports = { ServiceProcess, BackendOwnership };
