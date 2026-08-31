import { signJwt } from './lib/e2e-common.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5270';
const token = signJwt();
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const listRes = await fetch(`${BASE}/api/builder/list`, { headers: H });
const list = await listRes.json();
const record = (list ?? []).find(r => r.status === 'completed' && !r.fileName.startsWith('modules-'));
check('存在已完成构建记录', !!record, record?.fileName ?? 'none');
if (!record) {
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== ${results.length - fails.length}/${results.length} PASS ====`);
  process.exit(1);
}

const buildId = record.id;

const art = await fetch(`${BASE}/api/beacon/artifact/${buildId}`);
const artBuf = Buffer.from(await art.arrayBuffer());
check('匿名 artifact 下载（无鉴权）', art.status === 200 && artBuf.length === record.fileSize,
  `${art.status}, ${artBuf.length}B vs ${record.fileSize}B`);

const bad = await fetch(`${BASE}/api/beacon/artifact/..%2F..%2Fetc`);
check('artifact 非法 id 拒绝', bad.status === 400);

const fmtChecks = {
  iso: b => b.length > artBuf.length && b.slice(16 * 2048 + 1, 16 * 2048 + 6).toString() === 'CD001',
  img: b => b[510] === 0x55 && b[511] === 0xAA,
  vhd: b => b.slice(b.length - 512, b.length - 504).toString() === 'conectix',
  lnk: b => b.length > 100 && b.slice(4, 20).equals(Buffer.from('0114020000000000c000000000000046', 'hex')),
};
for (const [fmt, verify] of Object.entries(fmtChecks)) {
  const r = await fetch(`${BASE}/api/builder/download/${buildId}?format=${fmt}`, { headers: H });
  const buf = Buffer.from(await r.arrayBuffer());
  const cd = r.headers.get('content-disposition') || '';
  check(`download format=${fmt}`, r.status === 200 && cd.includes(`.${fmt}`) && verify(buf),
    `${cd.split('filename=')[1]?.split(';')[0] ?? ''}, ${buf.length}B`);
}

const anon = await fetch(`${BASE}/api/builder/download/${buildId}?format=iso`);
check('打包下载需鉴权', anon.status === 401);

const fails = results.filter(r => !r.ok);
console.log(`\n==== ${results.length - fails.length}/${results.length} PASS ====`);
process.exit(fails.length ? 1 : 0);
