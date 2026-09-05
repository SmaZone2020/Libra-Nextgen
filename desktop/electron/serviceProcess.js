// Service process manager: spawns the bundled Libra-Nextgen backend (.NET
// sidecar), probes readiness and reaps it on quit.
//
// Ported from desktop/LibraDesktop/Core/BackendProcess.cs with the desktop
// architecture contract (docs/desktop-electron-architecture.md §2, §3):
//   - the backend is launched with --user-data-dir <userData> so it reads
//     libra.conf.json from the same directory the shell writes to;
//   - readiness probe mirrors console pingBackend: 200/401/500 mean alive;
//   - if a Libra backend already serves the manifest port it is adopted
//     (external) and never killed;
//   - if the manifest port is occupied by a NON-Libra listener, the shell
//     picks the next free port and starts the backend there via the
//     LIBRA_LISTEN_PORT env override (the effective port is exposed on
//     `service.effectivePort` so the window targets the right URL).
'use strict';

const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const path = require('path');

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
    this.effectivePort = null; // actual port the backend serves (set after start)
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

  /** Raw TCP probe: true when any listener accepts on 127.0.0.1:{port}. */
  static portInUse(port, timeoutMs = 600) {
    return new Promise((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.setTimeout(timeoutMs, () => {
        sock.destroy();
        resolve(false);
      });
    });
  }

  /** Scan upward from `start` for the first free port (bounded). */
  static async firstFreePort(start, maxTries = 50) {
    const end = Math.min(start + maxTries, 65535);
    for (let p = start; p <= end; p += 1) {
      if (!(await ServiceProcess.portInUse(p))) return p;
    }
    return null;
  }

  /**
   * Start the payload backend unless a Libra backend already serves the
   * manifest port. Handles an externally-occupied port by falling back to a
   * free port and restarting there once via the LIBRA_LISTEN_PORT env.
   * payload = { backend: <exe name>, port, webRoot, rootDir }
   * opts = { extraEnv, pinPort } — extraEnv is merged into the child env;
   *   pinPort always sends LIBRA_LISTEN_PORT (used for the embedded baseline,
   *   whose config-derived port must match what we probe).
   */
  async start(payload, userDataDir, opts = {}) {
    await this.stop();
    this.effectivePort = payload.port;

    // Already a Libra backend? Adopt it and never spawn a second one.
    if (await ServiceProcess.isAlive(payload.port)) {
      this.ownership = BackendOwnership.External;
      this.log(`backend already active on port ${payload.port} (external, adopted)`);
      return this.ownership;
    }

    // Occupied by a non-Libra listener? Pick a free port for this run.
    let spawnPort = payload.port;
    if (await ServiceProcess.portInUse(payload.port)) {
      const free = await ServiceProcess.firstFreePort(payload.port + 1);
      if (free === null) {
        throw new Error(`port ${payload.port} is occupied and no free port was found`);
      }
      this.log(`port ${payload.port} occupied by another service; falling back to ${free}`);
      spawnPort = free;
    }

    const backendPath =
      process.platform === 'win32' && !payload.backend.toLowerCase().endsWith('.exe')
        ? `${payload.backend}.exe`
        : payload.backend;
    const exe = path.join(payload.rootDir, backendPath);

    // Attempt 1 on the resolved port; if the child dies before becoming ready
    // (e.g. a racy bind conflict), retry once on the next free port.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const additions = { ...(opts.extraEnv || {}) };
      if (spawnPort !== payload.port || opts.pinPort) {
        additions.LIBRA_LISTEN_PORT = String(spawnPort);
      }
      const env = { ...process.env, ...additions };

      this.log(`starting backend ${exe} on port ${spawnPort} ...`);
      this.child = spawn(exe, ['--user-data-dir', userDataDir], {
        cwd: payload.rootDir,
        windowsHide: true,
        stdio: 'ignore',
        env,
      });
      this.child.on('exit', (code) => {
        if (this.child !== null && this.ownership !== BackendOwnership.Owned) {
          this.log(`backend exited with code ${code} before becoming ready`);
        }
        this.child = null;
        this.ownership = BackendOwnership.None;
      });

      const ready = await this.waitReady(spawnPort);
      if (ready) {
        this.ownership = BackendOwnership.Owned;
        this.effectivePort = spawnPort;
        this.log(`backend ready on http://127.0.0.1:${spawnPort}/`);
        return this.ownership;
      }

      const exited = this.child === null;
      this.child = null;
      this.ownership = BackendOwnership.None;

      if (exited && spawnPort === payload.port) {
        const free = await ServiceProcess.firstFreePort(payload.port + 1);
        if (free === null) {
          throw new Error('backend exited before ready and no free port was found');
        }
        this.log(`backend exited on ${spawnPort}; retrying on free port ${free}`);
        spawnPort = free;
        continue;
      }

      throw new Error(`backend did not become ready on port ${spawnPort} within 60s`);
    }
    throw new Error('unreachable');
  }

  /** Poll the backend until it answers or the child exits / 60s elapses. */
  async waitReady(port) {
    for (let i = 0; i < 120; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (this.child === null) return false; // exited early
      if (await ServiceProcess.isAlive(port)) return true;
    }
    return false;
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
