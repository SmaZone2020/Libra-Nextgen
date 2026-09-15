// Dev-only checks for the setup wizard's pure helpers. Run:
//   node smoke-setup.js
// Verifies helper semantics + the LIBRA_STORAGE_PROBE contract end to end
// against a real service binary. No Electron, no GUI.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isMongoConnectionString,
  parseMongoTarget,
  normalizeRemoteUrl,
  normalizeMode,
  hasProbeContract,
  probeStorage,
} = require('./storageProbe');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}\n     got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
}

// --- connection-string prefix validation ---
check('mongo prefix ok', isMongoConnectionString('mongodb://127.0.0.1:27017/libra'), true);
check('srv prefix ok', isMongoConnectionString('mongodb+srv://u:p@c.example.net/db'), true);
check('prefix rejects http', isMongoConnectionString('http://127.0.0.1:27017'), false);
check('prefix rejects empty', isMongoConnectionString('   '), false);
check('prefix trims', isMongoConnectionString('  mongodb://a:1/b  '), true);

// --- host:port extraction ---
check('plain host:port', parseMongoTarget('mongodb://127.0.0.1:27099/x'), { host: '127.0.0.1', port: 27099 });
check('default port', parseMongoTarget('mongodb://db.internal/libra'), { host: 'db.internal', port: 27017 });
check('credentials stripped', parseMongoTarget('mongodb://u:p%40ss@10.0.0.5:27018/libra?authSource=admin'), { host: '10.0.0.5', port: 27018 });
check('replica seed list first', parseMongoTarget('mongodb://a:1,b:2,c:3/db'), { host: 'a', port: 1 });
check('ipv6 literal', parseMongoTarget('mongodb://[::1]:27020/db'), { host: '::1', port: 27020 });
check('srv has no port', parseMongoTarget('mongodb+srv://u:p@cluster.example.net/db'), null);
check('non-mongo', parseMongoTarget('postgres://a:1/b'), null);

// --- remote URL normalisation ---
check('url gets scheme', normalizeRemoteUrl('192.168.1.10:5270'), 'http://192.168.1.10:5270');
check('url path dropped', normalizeRemoteUrl('https://c2.example.com/console/#/agents'), 'https://c2.example.com');
check('url trailing slash', normalizeRemoteUrl('http://127.0.0.1:5270/'), 'http://127.0.0.1:5270');
check('url empty', normalizeRemoteUrl('  '), null);
check('url garbage', normalizeRemoteUrl('http://'), null);

// --- mode normalisation + probe contract sniffing ---
check('unknown mode -> sqlite', normalizeMode('postgres'), 'sqlite');
check('probe line detected', hasProbeContract('{"reachable":false,"requested":"mongo","effective":"mongo","error":"x"}\n'), true);
check('probe banner only', hasProbeContract('Now listening on: http://localhost:5270\n'), false);

// --- end-to-end against a real binary when one is present ---
async function binaryChecks() {
  const binPath = process.env.LIBRA_PROBE_BIN || '';
  if (!binPath || !fs.existsSync(binPath)) {
    console.log('SKIP binary probe checks (set LIBRA_PROBE_BIN to run them)');
    return;
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libra-setup-'));
  const resolveBinary = () => ({ binPath, rootDir: path.dirname(binPath) });

  const bad = await probeStorage({
    mode: 'mongo',
    connectString: 'mongodb://127.0.0.1:27099/x',
    userDataDir,
    resolveBinary,
  });
  console.log('binary probe (unreachable) ->', JSON.stringify(bad));
  check('unreachable mongo reports failure', bad.ok, false);

  const weak = await probeStorage({
    mode: 'mongo',
    connectString: 'mongodb://127.0.0.1:27099/x',
    userDataDir,
    resolveBinary: () => null, // no binary => documented dev fallback
  });
  console.log('dev fallback probe ->', JSON.stringify(weak));
  check('dev fallback is labelled weak', weak.weak, true);
  check('dev fallback fails closed port', weak.ok, false);

  fs.rmSync(userDataDir, { recursive: true, force: true });
}

// The strong path must parse the agreed probe contract, not just any output.
// `spawnImpl` stands in for a service build with LIBRA_STORAGE_PROBE support,
// so the contract is pinned down even before that build is published.
function contractChecks() {
  const calls = [];
  const fakeSpawn = (stdout, stderr, code) => (bin, args, opts) => {
    calls.push({ bin, args, env: opts && opts.env && opts.env.LIBRA_STORAGE_PROBE });
    const handlers = { stdout: [], stderr: [], close: [], error: [] };
    setImmediate(() => {
      if (stdout) handlers.stdout.forEach((h) => h(stdout));
      if (stderr) handlers.stderr.forEach((h) => h(stderr));
      handlers.close.forEach((h) => h(code));
    });
    return {
      stdout: { on: (_e, h) => handlers.stdout.push(h) },
      stderr: { on: (_e, h) => handlers.stderr.push(h) },
      on: (event, h) => (handlers[event] || []).push(h),
      kill: () => {},
    };
  };

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libra-fakeprobe-'));
  const binary = { binPath: 'fake-service.exe', rootDir: userDataDir };
  const connectString = 'mongodb://user:pw@127.0.0.1:27099/libra';

  return probeStorage({
    mode: 'mongo',
    connectString,
    userDataDir,
    resolveBinary: () => binary,
    spawnImpl: fakeSpawn('{"reachable":true,"requested":"mongo","effective":"mongo","error":null}\n', '', 0),
  })
    .then((ok) => {
      console.log('fake probe (reachable) ->', JSON.stringify(ok));
      console.log('  spawn call ->', JSON.stringify(calls[0]));
      check('probe success is strong', [ok.ok, ok.mode], [true, 'probe']);
      check('probe env+args match the contract', calls[0], {
        bin: 'fake-service.exe',
        args: ['--user-data-dir', userDataDir, '--store', 'mongo', '--connect', connectString],
        env: '1',
      });
      return probeStorage({
        mode: 'mongo',
        connectString,
        userDataDir,
        resolveBinary: () => binary,
        spawnImpl: fakeSpawn(
          '{"reachable":false,"requested":"mongo","effective":"mongo","error":"connection refused"}\n',
          'MongoDB connection refused\n',
          4,
        ),
      });
    })
    .then((no) => {
      console.log('fake probe (unreachable) ->', JSON.stringify(no));
      check('probe failure carries the service error', [no.ok, /connection refused/.test(no.detail)], [false, true]);
      // A build without probe support answers nothing: the weak tier must run.
      return probeStorage({
        mode: 'mongo',
        connectString,
        userDataDir,
        resolveBinary: () => binary,
        spawnImpl: fakeSpawn('Now listening on: http://localhost:5270\n', '', 1),
      });
    })
    .then((fallback) => {
      console.log('no-contract build ->', JSON.stringify(fallback));
      check('falls back to the weak check', fallback.weak, true);
      fs.rmSync(userDataDir, { recursive: true, force: true });
    });
}

contractChecks()
  .then(binaryChecks)
  .catch((err) => { failures += 1; console.error('binary checks threw:', err.message); })
  .then(() => {
    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
