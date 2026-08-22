import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { encryptPassword } from '../web/js/engine/parser.js';

// 用 node:crypto 的 AES-CBC（数学上与 WebCrypto 一致）交叉验证 encryptPassword。
// 两者都是 PKCS7 padding；salt 16 字节 -> AES-128-CBC。
test('encryptPassword 与 node:crypto AES-128-CBC 结果一致', async () => {
  const password = 'mypassword';
  const salt = 'AbCdEfGhIjKlMnOp';       // 16 字符
  const rng = (n) => 'P'.repeat(n);       // 确定性随机源：前缀与 IV 都用 'P'

  const key = Buffer.from(salt, 'utf8');                       // 16 字节
  const iv = Buffer.from(rng(16), 'utf8');                     // 16 字节
  const plaintext = rng(64) + password;                        // 64 前缀 + 密码

  const cipher = createCipheriv('aes-128-cbc', key, iv);       // 默认 PKCS7
  const expected = cipher.update(plaintext, 'utf8', 'base64') + cipher.final('base64');

  const got = await encryptPassword(password, salt, rng);
  assert.equal(got, expected);
});

test('无 salt 时直接返回密码（不加密）', async () => {
  assert.equal(await encryptPassword('abc', ''), 'abc');
});

test('同一密码后 16 位对齐：加密结果长度合理且 base64 可解码', async () => {
  const out = await encryptPassword('password123', '0123456789abcdef', (n) => 'x'.repeat(n));
  const bytes = Buffer.from(out, 'base64');
  assert.ok(bytes.length > 0);
  // AES-128 block=16，PKCS7 使密文长度为 16 的倍数
  assert.equal(bytes.length % 16, 0);
});
