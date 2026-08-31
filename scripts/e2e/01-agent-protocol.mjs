import { registerAgent, signJwt, aesGcmDecrypt } from './lib/e2e-common.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5270';
const REAL_AGENT = process.env.E2E_AGENT_ID || '';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const token = signJwt();
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

const { agentId, sessionToken, aesKey } = await registerAgent(BASE);
check('注册（/api/v1/session）', !!agentId, agentId.slice(0, 8));

const sseController = new AbortController();
const sseEvents = [];
const sseTask = (async () => {
  try {
    const res = await fetch(`${BASE}/api/v1/models/events?channel=${sessionToken}`, {
      headers: { accept: 'text/event-stream' },
      signal: sseController.signal,
    });
    check('SSE 连接 200 + text/event-stream', res.status === 200 && (res.headers.get('content-type') ?? '').includes('event-stream'));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith('data:') && line.length > 6) {
          try { sseEvents.push(JSON.parse(aesGcmDecrypt(line.slice(5).trim(), aesKey))); } catch { /* keepalive */ }
        }
      }
    }
  } catch { /* aborted */ }
})();
await new Promise(r => setTimeout(r, 1500));
check('SSE 初始事件到达（连接即同步）', sseEvents.length > 0, `events=${sseEvents.length}`);

const taskRes = await fetch(`${BASE}/api/tasks`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ agentId, commandType: 'Sleep', command: '1', arguments: [], timeoutSeconds: 10 }),
});
const task = await taskRes.json();
check('创建任务 201', taskRes.status === 201, `id=${task.id?.slice(0, 8)}`);

const pushArrived = await (async () => {
  for (let i = 0; i < 20; i++) {
    if (sseEvents.some(e => e.op === 'task' && e.data?.id === task.id)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
})();
check('任务经 SSE 即时推送到达', pushArrived, `t=${Date.now()}ms`);

if (REAL_AGENT) {
  const realTaskRes = await fetch(`${BASE}/api/tasks`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ agentId: REAL_AGENT, commandType: 'Sleep', command: '1', arguments: [], timeoutSeconds: 10 }),
  });
  const realTask = await realTaskRes.json();
  check('向真实 agent 创建任务 201', realTaskRes.status === 201, `id=${realTask.id?.slice(0, 8)}`);

  const t0 = Date.now();
  let done = false;
  for (let i = 0; i < 100 && !done; i++) {
    await new Promise(r => setTimeout(r, 300));
    const cur = await (await fetch(`${BASE}/api/tasks/${realTask.id}`, { headers: H })).json();
    if (cur.status === 'Completed' || cur.status === 'Failed' || cur.status === 'Cancelled') {
      done = true;
      check('真实 agent 执行并上报结果', cur.status === 'Completed', `elapsed=${Date.now() - t0}ms`);
    }
  }
  if (!done) check('真实 agent 执行并上报结果', false, 'timeout 30s');
} else {
  console.log('SKIP  真实 agent 执行验证（未提供 E2E_AGENT_ID）');
}

sseController.abort();
await sseTask;

const fails = results.filter(r => !r.ok);
console.log(`\n==== ${results.length - fails.length}/${results.length} PASS ====`);
process.exit(fails.length ? 1 : 0);
