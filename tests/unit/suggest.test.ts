/**
 * 搜索推荐引擎单测 —— 匹配优先级与数量上限是核心验收点
 */
import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  buildSuggestions,
  debounce,
  looksLikeUrl,
  splitHighlight,
} from '../../src/lib/suggest';
import { SUGGEST_LIMITS } from '../../src/lib/defaults';
import type { BookmarkNode, SearchEngine, Shortcut } from '../../src/types';

const engines: SearchEngine[] = [
  { id: 'bing', name: '必应', urlTemplate: 'https://www.bing.com/search?q=%s', icon: 'bing', order: 0 },
  { id: 'google', name: '谷歌', urlTemplate: 'https://www.google.com/search?q=%s', icon: 'google', order: 1 },
];

const bookmark = (id: string, title: string, url: string): BookmarkNode => ({
  id,
  title,
  url,
});

function baseInput(overrides: Partial<Parameters<typeof buildSuggestions>[0]> = {}) {
  return {
    query: '',
    bookmarks: [] as BookmarkNode[],
    shortcuts: [] as Shortcut[],
    engines,
    defaultEngineId: 'bing',
    engineUrlTemplate: engines[0].urlTemplate,
    includeSearch: true,
    ...overrides,
  };
}

describe('buildSuggestions', () => {
  it('空查询返回空数组', () => {
    expect(buildSuggestions(baseInput({ query: '   ' }))).toEqual([]);
  });

  it('完全匹配排在开头匹配之前', () => {
    const items = buildSuggestions(
      baseInput({
        query: 'github',
        bookmarks: [
          bookmark('1', 'My GitHub Page', 'https://a.com'),
          bookmark('2', 'GitHub', 'https://github.com'),
        ],
      }),
    );
    expect(items[0].title).toBe('GitHub');
  });

  it('标题匹配排在 URL 匹配之前', () => {
    const items = buildSuggestions(
      baseInput({
        query: 'docs',
        bookmarks: [
          bookmark('1', '某个站点', 'https://x.com/docs'),
          bookmark('2', 'Docs Home', 'https://y.com'),
        ],
      }),
    );
    expect(items[0].title).toBe('Docs Home');
  });

  it('收藏最多 3 项，搜索最多 2 项，总数最多 5 项', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      bookmark(`b${i}`, `test ${i}`, `https://site${i}.com`),
    );
    const items = buildSuggestions(baseInput({ query: 'test', bookmarks: many }));

    const bookmarks = items.filter((i) => i.kind === 'bookmark');
    const searches = items.filter((i) => i.kind === 'search');

    expect(bookmarks.length).toBeLessThanOrEqual(SUGGEST_LIMITS.bookmark);
    expect(searches.length).toBeLessThanOrEqual(SUGGEST_LIMITS.search);
    expect(items.length).toBeLessThanOrEqual(SUGGEST_LIMITS.total);
  });

  it('无匹配且关闭搜索候选时返回空', () => {
    const items = buildSuggestions(
      baseInput({ query: 'zzzzzz', includeSearch: false }),
    );
    expect(items).toEqual([]);
  });

  it('无匹配但允许搜索候选时给出默认 + 备用引擎两条', () => {
    const items = buildSuggestions(baseInput({ query: 'zzzzzz' }));
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe('search');
    expect(items[0].engineId).toBe('bing');
    expect(items[1].engineId).toBe('google');
  });

  it('只有一个引擎时搜索候选只给一条', () => {
    const items = buildSuggestions(
      baseInput({ query: 'zzzzzz', engines: [engines[0]] }),
    );
    expect(items).toHaveLength(1);
  });

  it('第二条搜索候选使用非默认引擎', () => {
    const items = buildSuggestions(baseInput({ query: 'abc' }));
    const searches = items.filter((i) => i.kind === 'search');
    expect(searches).toHaveLength(2);
    expect(searches[1].engineId).toBe('google');
  });

  it('书签与快捷方式重复 URL 只出现一次', () => {
    const items = buildSuggestions(
      baseInput({
        query: 'dup',
        bookmarks: [bookmark('1', 'dup site', 'https://dup.com')],
        shortcuts: [
          {
            id: 's1',
            name: 'dup',
            url: 'https://dup.com/',
            icon: 'auto',
            hideName: false,
            order: 0,
            createdAt: 0,
          },
        ],
      }),
    );
    expect(items.filter((i) => i.kind === 'bookmark')).toHaveLength(1);
  });

  it('命中区间用于高亮', () => {
    const items = buildSuggestions(
      baseInput({
        query: 'hub',
        bookmarks: [bookmark('1', 'GitHub', 'https://github.com')],
      }),
    );
    expect(items[0].matchRange).toEqual([3, 6]);
  });
});

describe('buildSearchUrl', () => {
  it('替换 %s 并做 URL 编码', () => {
    expect(buildSearchUrl('https://a.com/?q=%s', 'a b&c')).toBe(
      'https://a.com/?q=a%20b%26c',
    );
  });

  it('无占位符时原样返回', () => {
    expect(buildSearchUrl('https://a.com/', 'x')).toBe('https://a.com/');
  });
});

describe('looksLikeUrl', () => {
  it('识别完整地址', () => {
    expect(looksLikeUrl('https://a.com/x')).toBe(true);
  });

  it('识别裸域名与端口', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('localhost:3000')).toBe(true);
  });

  it('含空格的短语不算地址', () => {
    expect(looksLikeUrl('hello world')).toBe(false);
  });

  it('单字不算地址', () => {
    expect(looksLikeUrl('react')).toBe(false);
  });
});

describe('splitHighlight', () => {
  it('切成三段', () => {
    expect(splitHighlight('GitHub', [3, 6])).toEqual(['Git', 'Hub', '']);
  });

  it('无区间时整串作为前缀', () => {
    expect(splitHighlight('abc')).toEqual(['abc', '', '']);
  });

  it('区间越界时降级为整串', () => {
    expect(splitHighlight('abc', [0, 99])).toEqual(['abc', '', '']);
  });
});

describe('debounce', () => {
  it('在等待期内只执行最后一次', async () => {
    const calls: string[] = [];
    const fn = debounce((v: string) => calls.push(v), 20);
    fn('a');
    fn('b');
    fn('c');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual(['c']);
  });

  it('cancel 能取消待执行调用', async () => {
    const calls: string[] = [];
    const fn = debounce((v: string) => calls.push(v), 20);
    fn('a');
    fn.cancel();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([]);
  });

  it('flush 立即执行', () => {
    const calls: string[] = [];
    const fn = debounce((v: string) => calls.push(v), 1000);
    fn('now');
    fn.flush();
    expect(calls).toEqual(['now']);
  });
});
