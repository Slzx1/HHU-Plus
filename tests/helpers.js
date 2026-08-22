// 测试辅助：统一「读 fixture + 构造 DOM 解析器」
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHTML } from 'linkedom';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 读取 tests/fixtures 下的样本，返回字符串。 */
export const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

/**
 * 生成与浏览器 DOMParser 对齐的 parse 工厂。
 * 浏览器用 `new DOMParser().parseFromString(html,'text/html')`；这里用 linkedom。
 * 两者都返回支持 querySelector/querySelectorAll/getAttribute/textContent 的 Document。
 */
export const parse = (html) => parseHTML(html).document;
