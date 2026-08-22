import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScraper } from '../web/js/engine/scraper.js';

// 构造一个最小引擎（不联网），只测 URL 重写与 query 拼接
const scraper = createScraper({
  parse: () => null,
  fetchImpl: async () => ({ status: 200, url: '', text: '' }),
});

test('rewriteToWebvpnUrl：内网 host 编码为 WebVPN 代理地址，并保留 query', () => {
  const url = scraper._rewriteToWebvpnUrl('https://jwxt.hhu.edu.cn/jsxsd/kscj/cjcx_list?x=1');
  assert.ok(url.startsWith('https://webvpn.hhu.edu.cn/https/77726476706e69737468656265737421fae0598869386045300d8db9d6562d/jsxsd/kscj/cjcx_list?x=1'));
});

test('rewriteToWebvpnUrl：已能访问的 / 未知 host 保持不变', () => {
  assert.equal(
    scraper._rewriteToWebvpnUrl('https://webvpn.hhu.edu.cn/'),
    'https://webvpn.hhu.edu.cn/',
  );
  assert.equal(
    scraper._rewriteToWebvpnUrl('https://example.com/foo'),
    'https://example.com/foo',   // 未知 host，返回原样
  );
});

test('buildUrl 正确拼接 query 参数', () => {
  const built = scraper._buildUrl('https://a.com/p', { kksj: '2025-2026-1' });
  assert.equal(built, 'https://a.com/p?kksj=2025-2026-1');
  const built2 = scraper._buildUrl('https://a.com/p?t=1', { a: 'b' });
  assert.equal(built2, 'https://a.com/p?t=1&a=b');
  assert.equal(scraper._buildUrl('https://a.com/p', {}), 'https://a.com/p');
});
