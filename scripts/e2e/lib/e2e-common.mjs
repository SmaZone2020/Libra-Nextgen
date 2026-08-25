// E2E 公共库：JWT 签发 + agent 注册 + AES-GCM 加解密
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PEM = path.join(__dirname, '..', '.jwt-key.pem');

export function b64url(b) { return Buffer.from(b).toString('base64url'); }

export function signJwt(username = 'SmaZone', role = 'Admin') {
  const pem = fs.readFileSync(KEY_PEM, 'utf8');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    nameid: 'initial-admin', name: username, role,
    jti: crypto.randomUUID(), iss: 'Libra-Nextgen', aud: 'Libra-Console',
    exp: now + 3600, nbf: now,
  }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), pem).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

export function aesGcmEncrypt(plain, key) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ct]).toString('base64');
}

export function aesGcmDecrypt(b64, key) {
  const buf = Buffer.from(b64, 'base64');
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/**
 * 注册一个测试 agent（明文注册分支），返回 { agentId, sessionToken, aesKey }。
 * session_key 为服务端用 agent RSA 公钥加密的 AES key，此处生成临时 RSA 对解密。
 */
export async function registerAgent(base) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const body = {
    hostname: 'e2e-host', userName: 'e2e-user', osVersion: 'Windows 11 Pro 10.0.26100',
    arch: 'x64', processName: 'agent', pid: 4242, isElevated: false,
    publicKey: pubB64, beaconSecret: '', hardware: { hwid: `E2E-${Date.now()}` }, hasSessionKey: false,
  };
  const r = await fetch(`${base}/api/v1/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status !== 200) throw new Error(`register failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  if (!j.agent_id || !j.session_token || !j.session_key) throw new Error('register response incomplete');
  const aesKey = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(j.session_key, 'base64'));
  return { agentId: j.agent_id, sessionToken: j.session_token, aesKey };
}
