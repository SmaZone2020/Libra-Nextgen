// Shell smoke harness (dev tool, not shipped): stages a real payload layout
// under a temp userData dir and drives serviceProcess.js exactly like main.js
// does, so the shell<->service contract can be verified headlessly:
//   node smoke-service.js --userData <dir> [--port 5399] [--timeout 60]
// Layout expected under <dir>/payload/latest: version.json + backend exe.
// After a successful run the sqlite db should exist at <dir>/data/libra.db
// (libra.conf.json with mode=sqlite is written by this harness).
'use strict';

const fs = require('fs');
const path = require('path');
const { ServiceProcess, BackendOwnership } = require('./serviceProcess');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    const key = eq >= 0 ? body.slice(0, eq) : body;
    let value;
    if (eq >= 0) value = body.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
    else value = true;
    args[key] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const userDataDir = path.resolve(args.userData);
  if (!userDataDir || !fs.existsSync(userDataDir)) {
    console.error('usage: node smoke-service.js --userData <dir> [--port 5399]');
    process.exit(2);
  }

  // The shell never writes libra.conf.json itself except from the settings UI;
  // simulate a sqlite-mode config so we verify the sqlite boot path too.
  const configPath = path.join(userDataDir, 'libra.conf.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      storage: { mode: 'sqlite', fallback: true },
      listener: { port: Number(args.port || 5399), bindLoopback: true },
    }, null, 2));
  }

  const manifestPath = path.join(userDataDir, 'payload', 'latest', 'version.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (args.port) manifest.port = Number(args.port);
  const payload = { ...manifest, rootDir: path.dirname(manifestPath) };

  const service = new ServiceProcess();
  const ownership = await service.start(payload, userDataDir);
  console.log(`ownership=${ownership}`);
  const effectivePort = service.effectivePort ?? payload.port;
  console.log(`effective port=${effectivePort}`);

  const dbPath = path.join(userDataDir, 'data', 'libra.db');
  console.log(`sqlite db exists at ${dbPath}: ${fs.existsSync(dbPath)}`);

  const probeAlive = await ServiceProcess.isAlive(effectivePort);
  console.log(`backend alive on ${effectivePort}: ${probeAlive}`);

  await service.stop();
  console.log('stopped cleanly');
  process.exit(ownership === BackendOwnership.Owned && probeAlive ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke failed:', err.message);
  process.exit(1);
});
