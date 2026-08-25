// E2E 03：流量伪装持久化列表 — 读取 → 增加 → 切换 → 删除
import { signJwt } from './lib/e2e-common.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5270';
const token = signJwt();
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// 1) 读取（首次种子默认值）
const getRes = await fetch(`${BASE}/api/builder/lists`, { headers: H });
const lists = await getRes.json();
check('流量伪装列表读取（默认种子）', getRes.status === 200 && (lists.userAgents?.length ?? 0) > 0, `ua=${lists.userAgents?.length}`);

// 2) 增加一项（pathSuffixes）
const marker = `e2e-${Date.now()}`;
const addRes = await fetch(`${BASE}/api/builder/lists/item`, {
  method: 'POST', headers: H, body: JSON.stringify({ list: 'pathSuffixes', value: marker }),
});
const afterAdd = await addRes.json();
const added = (afterAdd.pathSuffixes ?? []).find(i => i.value === marker);
check('增加项持久化', addRes.status === 200 && !!added, marker);

// 3) 切换禁用
const toggleRes = await fetch(`${BASE}/api/builder/lists/toggle`, {
  method: 'POST', headers: H, body: JSON.stringify({ list: 'pathSuffixes', id: added.id, enabled: false }),
});
const afterToggle = await toggleRes.json();
const toggled = (afterToggle.pathSuffixes ?? []).find(i => i.id === added.id);
check('切换项启用状态', toggleRes.status === 200 && toggled?.enabled === false);

// 4) 删除
const delRes = await fetch(`${BASE}/api/builder/lists/delete`, {
  method: 'POST', headers: H, body: JSON.stringify({ list: 'pathSuffixes', id: added.id }),
});
const afterDel = await delRes.json();
check('删除项', delRes.status === 200 && !(afterDel.pathSuffixes ?? []).some(i => i.id === added.id));

const fails = results.filter(r => !r.ok);
console.log(`\n==== ${results.length - fails.length}/${results.length} PASS ====`);
process.exit(fails.length ? 1 : 0);
