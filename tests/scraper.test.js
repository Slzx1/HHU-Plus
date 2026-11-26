import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScraper } from '../web/js/engine/scraper.js';
import { isAllowedHost, encodeOrigin, decodeOrigin, toProxyUrl } from '../server/proxy.js';

const minimalScraper = createScraper({
  parse: () => null,
  fetchImpl: async () => ({ status: 200, url: '', text: '' }),
});

test('rewriteToWebvpnUrl：内网 host 编码为 WebVPN 代理地址，并保留 query', () => {
  const url = minimalScraper._rewriteToWebvpnUrl('https://jwxt.hhu.edu.cn/jsxsd/kscj/cjcx_list?x=1');
  assert.ok(url.startsWith('https://webvpn.hhu.edu.cn/https/77726476706e69737468656265737421fae0598869386045300d8db9d6562d/jsxsd/kscj/cjcx_list?x=1'));
});

test('rewriteToWebvpnUrl：已能访问的 / 未知 host 保持不变', () => {
  assert.equal(minimalScraper._rewriteToWebvpnUrl('https://webvpn.hhu.edu.cn/'), 'https://webvpn.hhu.edu.cn/');
  assert.equal(minimalScraper._rewriteToWebvpnUrl('https://example.com/foo'), 'https://example.com/foo');
});

test('buildUrl 正确拼接 query 参数', () => {
  assert.equal(minimalScraper._buildUrl('https://a.com/p', { kksj: '2025-2026-1' }), 'https://a.com/p?kksj=2025-2026-1');
  assert.equal(minimalScraper._buildUrl('https://a.com/p?t=1', { a: 'b' }), 'https://a.com/p?t=1&a=b');
  assert.equal(minimalScraper._buildUrl('https://a.com/p', {}), 'https://a.com/p');
});

test('queryPassCode：一次 CAS 会话免登换票、复用 token、424 过期自动静默刷新', async () => {
  let casCalls = 0;
  let tokenCalls = 0;
  let qrCalls = 0;
  let savedToken = null;

  const mockFetch = async (method, url, opts) => {
    if (url.includes('authserver/login')) {
      casCalls++;
      return {
        status: 302,
        url: `https://zhjc.hhu.edu.cn/mobile/?state=CAS_MOBILE_ACCESS-LOGIN/%23/pages/wxCas/index&ticket=ST-ticket-${casCalls}`,
        text: '',
      };
    }
    if (url.includes('/admin/oauth2/token')) {
      tokenCalls++;
      return {
        status: 200,
        url,
        text: JSON.stringify({ access_token: `tok-${tokenCalls}` }),
      };
    }
    if (url.includes('/freshAccessQrCode')) {
      qrCalls++;
      // 第 2 次刷新模拟 zhjc access_token 过期（HTTP 424），应自动走 CAS 重换新 token
      if (qrCalls === 2 && opts.headers.Authorization === 'Bearer tok-1') {
        return { status: 424, url, text: JSON.stringify({ code: 1, msg: '身份认证已过期' }) };
      }
      return {
        status: 200,
        url,
        text: JSON.stringify({
          code: 0,
          data: { qrCodeContent: `QR-${qrCalls}`, qrCodeImage: 'AAAA', expireTime: Date.now() + 60_000 },
        }),
      };
    }
    if (url.includes('/loginUserBaseInfo')) {
      return {
        status: 200,
        url,
        text: JSON.stringify({ code: 0, data: { name: '张河海', shortDeptName: '水文水资源学院', code: '20240010' } }),
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const scraper = createScraper({
    parse: () => null,
    fetchImpl: mockFetch,
    onZhjcToken: (t) => { savedToken = t; },
  });

  // 首次查询：CAS 换票 + 获取 token + 拉 QR + 拉用户信息
  const first = await scraper.queryPassCode();
  assert.equal(first.qr.qrCodeImage, 'data:image/png;base64,AAAA');
  assert.equal(first.user.name, '张河海');
  assert.equal(casCalls, 1);
  assert.equal(tokenCalls, 1);
  assert.equal(savedToken, 'tok-1');

  // 第二次查询遭遇 424 -> 自动通过 CAS 换取 tok-2 并成功返回，全程无需重新登录
  const second = await scraper.queryPassCode();
  assert.equal(second.qr.qrCodeImage, 'data:image/png;base64,AAAA');
  assert.equal(casCalls, 2);
  assert.equal(tokenCalls, 2);
  assert.equal(savedToken, 'tok-2');
});

test('server/proxy 白名单校验：仅允许 *.hhu.edu.cn 防止 SSRF', () => {
  assert.equal(isAllowedHost('webvpn.hhu.edu.cn'), true);
  assert.equal(isAllowedHost('smst.hhu.edu.cn'), true);
  assert.equal(isAllowedHost('zhjc.hhu.edu.cn'), true);
  assert.equal(isAllowedHost('hhu.edu.cn'), true);
  assert.equal(isAllowedHost('evil.com'), false);
  assert.equal(isAllowedHost('hhu.edu.cn.evil.com'), false);

  const enc = encodeOrigin('https://webvpn.hhu.edu.cn');
  assert.equal(decodeOrigin(enc), 'https://webvpn.hhu.edu.cn');
  assert.equal(decodeOrigin(encodeOrigin('https://evil.com')), null);
  assert.ok(toProxyUrl('https://smst.hhu.edu.cn/default.aspx?a=1').startsWith('/proxy/res/'));
  assert.equal(toProxyUrl('https://evil.com/x'), 'https://evil.com/x');
});
