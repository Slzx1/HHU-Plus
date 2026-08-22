import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLoginForm } from '../web/js/engine/parser.js';
import { fixture, parse } from './helpers.js';

test('extractLoginForm 提取隐藏字段，无验证码（captchaDiv 含 hide）', () => {
  const { fields, captchaRequired } = extractLoginForm(fixture('cas-login.html'), parse);
  assert.equal(fields.lt, 'LT-1234567890');
  assert.equal(fields.pwdEncryptSalt, 'AbCdEfGhIjKlMnOp');
  assert.equal(fields.execution, 'e1s2s3s4s5s6s7');
  assert.equal(fields.cllt, 'userNameLogin');
  assert.equal(captchaRequired, false);
});

test('验证码显示（captchaDiv 无 hide class）→ 判定需要验证码', () => {
  const html = fixture('cas-login.html').replace('class="text-center hide"', 'class="text-center"');
  const { captchaRequired } = extractLoginForm(html, parse);
  assert.equal(captchaRequired, true);
});

test('无 hidden salt 时，从内联 JS 兜底提取 pwdEncryptSalt', () => {
  const html = '<form id="pwdFromId"><script>var pwdEncryptSalt="0123456789abcdef";</script></form>';
  const { fields } = extractLoginForm(html, parse);
  assert.equal(fields.pwdEncryptSalt, '0123456789abcdef');
});

test('登录页被干扰：只在用户名密码表单内判断 captchaDiv', () => {
  // 页面含两个表单，captchaDiv 位于手机动态码表单（无 hide），用户名密码表单内 captchaDiv 才有 hide
  const html = `
    <form><div id="captchaDiv" class=""></div></form>
    <form id="pwdFromId"><input type="hidden" id="pwdEncryptSalt" value="abcdefghijklmnop">
      <div id="captchaDiv" class="hide"></div></form>`;
  const { captchaRequired, fields } = extractLoginForm(html, parse);
  assert.equal(captchaRequired, false);        // 不理会其它表单的 captchaDiv
  assert.equal(fields.pwdEncryptSalt, 'abcdefghijklmnop');
});
