import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar } from '../server/cookie-jar.js';

test('CookieJar 按域名隔离同名 cookie（避免 webvpn / zhjc / smst 互相覆盖）', () => {
  const jar = new CookieJar();
  jar.setFromHeader('JSESSIONID=vpn123; Path=/', 'https://webvpn.hhu.edu.cn/');
  jar.setFromHeader('JSESSIONID=smst456; Path=/', 'https://smst.hhu.edu.cn/default.aspx');
  jar.setFromHeader('tenantId=1; Path=/', 'https://zhjc.hhu.edu.cn/admin/user');

  assert.equal(jar.getCookieHeader('https://webvpn.hhu.edu.cn/foo'), 'JSESSIONID=vpn123');
  assert.equal(jar.getCookieHeader('https://smst.hhu.edu.cn/index'), 'JSESSIONID=smst456');
  assert.equal(jar.getCookieHeader('https://zhjc.hhu.edu.cn/admin/x'), 'tenantId=1');
});

test('CookieJar 支持路径作用域与优先级排序（如 CASTGC 绑定 /authserver）', () => {
  const jar = new CookieJar();
  jar.setFromHeader('CASTGC=TGT-secret; Path=/authserver; HttpOnly', 'https://authserver.hhu.edu.cn/authserver/login');
  jar.setFromHeader('route=root; Path=/', 'https://authserver.hhu.edu.cn/authserver/login');
  jar.setFromHeader('route=sub; Path=/authserver', 'https://authserver.hhu.edu.cn/authserver/login');

  assert.equal(jar.getCookieHeader('https://authserver.hhu.edu.cn/other'), 'route=root');
  const authHeader = jar.getCookieHeader('https://authserver.hhu.edu.cn/authserver/login');
  assert.ok(authHeader.includes('CASTGC=TGT-secret'));
  assert.ok(authHeader.includes('route=sub'));
  assert.ok(!authHeader.includes('route=root'));
});

test('CookieJar 处理 Domain 属性与 Max-Age=0 删除', () => {
  const jar = new CookieJar();
  jar.setFromHeader('wengine_vpn=abc; Domain=webvpn.hhu.edu.cn; Path=/', 'https://webvpn.hhu.edu.cn/login');
  assert.equal(jar.getCookieHeader('https://webvpn.hhu.edu.cn/'), 'wengine_vpn=abc');

  jar.setFromHeader('wengine_vpn=abc; Domain=webvpn.hhu.edu.cn; Path=/; Max-Age=0', 'https://webvpn.hhu.edu.cn/logout');
  assert.equal(jar.getCookieHeader('https://webvpn.hhu.edu.cn/'), '');
});

test('CookieJar.setSimple 兼容 CLI Cookie 文件加载', () => {
  const jar = new CookieJar();
  jar.setSimple('wengine_vpn_ticketwebvpn_hhu_edu_cn', 'tk123', '.webvpn.hhu.edu.cn', '/');
  assert.equal(
    jar.getCookieHeader('https://webvpn.hhu.edu.cn/https/abc'),
    'wengine_vpn_ticketwebvpn_hhu_edu_cn=tk123',
  );
});
