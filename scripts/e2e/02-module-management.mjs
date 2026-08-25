// E2E 02：模块管理 — 枚举（文件名驱动）→ 禁用（.disable 重命名）→ 恢复
import fs from 'node:fs';
import { signJwt } from './lib/e2e-common.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5270';
const MOD_DIR = process.env.E2E_MODULES_DIR || 'D:/Projects/Mix/Libra-Nextgen/src/build-output/modules/x64';
const token = signJwt();
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// 1) 枚举
const listRes = await fetch(`${BASE}/api/builder/modules?platform=x64`, { headers: H });
const list = await listRes.json();
const mods = list.modules ?? [];
check('模块枚举（文件名驱动）', listRes.status === 200 && mods.length > 0, `count=${mods.length} ${mods.map(m => m.name).join(',')}`);

const target = mods.find(m => m.name === 'shell');
if (!target) { console.log('FAIL shell module missing'); process.exit(1); }

// 2) 禁用 → 文件重命名为 .dll.disable
const off = await fetch(`${BASE}/api/builder/modules/toggle`, {
  method: 'POST', headers: H, body: JSON.stringify({ platform: 'x64', name: 'shell', enabled: false }),
});
const filesOff = fs.readdirSync(MOD_DIR).filter(f => f.startsWith('shell'));
check('禁用模块 → .dll.disable 重命名', off.status === 200 && filesOff.includes('shell.dll.disable') && !filesOff.includes('shell.dll'), filesOff.join(','));

// 3) 恢复 → 还原文件名
const on = await fetch(`${BASE}/api/builder/modules/toggle`, {
  method: 'POST', headers: H, body: JSON.stringify({ platform: 'x64', name: 'shell', enabled: true }),
});
const filesOn = fs.readdirSync(MOD_DIR).filter(f => f.startsWith('shell'));
check('恢复模块 → 还原 .dll', on.status === 200 && filesOn.includes('shell.dll') && !filesOn.includes('shell.dll.disable'), filesOn.join(','));

const fails = results.filter(r => !r.ok);
console.log(`\n==== ${results.length - fails.length}/${results.length} PASS ====`);
process.exit(fails.length ? 1 : 0);
