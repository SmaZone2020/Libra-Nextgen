// Linux x64 L2 chain smoke: expect a real Linux agent (osVersion contains
// "Debian"/"Linux") to be online against E2E_BASE, then dispatch a core
// "Sleep" task over SSE and wait for the result upload.
//
// Env: E2E_BASE (default http://127.0.0.1:5270); the JWT signing key is
// resolved by e2e-common (scripts/e2e/.jwt-key.pem).
import { signJwt } from './lib/e2e-common.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5270';
const H = () => ({ 'content-type': 'application/json', authorization: `Bearer ${signJwt()}` });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

let agent = null;
for (let i = 0; i < 40 && !agent; i++) {
  await sleep(2000);
  try {
    const res = await fetch(`${BASE}/api/agents`, { headers: H() });
    const list = await res.json();
    const items = Array.isArray(list) ? list : list.agents ?? list.items ?? [];
    agent = items.find((a) => (a.osVersion ?? '').toLowerCase().includes('debian')) ?? null;
    if (agent) {
      check('linux agent 在线', true, `id=${agent.id.slice(0, 8)} os=${agent.osVersion} arch=${agent.arch}`);
    }
  } catch {
    // Server still warming up.
  }
}
if (!agent) {
  check('linux agent 在线', false, 'no matching online agent after 80s');
  console.log(`\n==== ${results.filter((r) => r.ok).length}/${results.length} PASS ====`);
  process.exit(1);
}

const taskRes = await fetch(`${BASE}/api/tasks`, {
  method: 'POST',
  headers: H(),
  body: JSON.stringify({ agentId: agent.id, commandType: 'Sleep', command: '1', arguments: [], timeoutSeconds: 10 }),
});
const task = await taskRes.json();
check('向 linux agent 创建任务', taskRes.status === 201, `id=${(task.id ?? '').slice(0, 8)}`);

const t0 = Date.now();
let done = false;
for (let i = 0; i < 100 && !done; i++) {
  await sleep(300);
  try {
    const cur = await (await fetch(`${BASE}/api/tasks/${task.id}`, { headers: H() })).json();
    if (['Completed', 'Failed', 'Cancelled'].includes(cur.status)) {
      done = true;
      check('linux agent 执行并上报结果', cur.status === 'Completed', `elapsed=${Date.now() - t0}ms`);
    }
  } catch {
    // Ignore transient polling errors.
  }
}
if (!done) check('linux agent 执行并上报结果', false, 'timeout 30s');

const fails = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - fails.length}/${results.length} PASS ====`);
process.exit(fails.length ? 1 : 0);
