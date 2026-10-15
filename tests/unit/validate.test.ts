/**
 * 校验器单测 —— 覆盖导入文件校验的核心路径
 */
import { describe, expect, it } from 'vitest';
import {
  dedupeByUrl,
  isHttpUrl,
  isSettings,
  isValidUrlTemplate,
  normalizeInputToUrl,
  normalizeUrlKey,
  reindexOrder,
  validateImageFile,
  validateImportBundle,
} from '../../src/lib/validate';
import { DEFAULT_SETTINGS } from '../../src/lib/defaults';

describe('isHttpUrl', () => {
  it('接受 http / https', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/a')).toBe(true);
  });

  it('拒绝其它协议与非法串', () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl(42)).toBe(false);
  });
});

describe('isValidUrlTemplate', () => {
  it('要求包含 %s', () => {
    expect(isValidUrlTemplate('https://www.bing.com/search?q=%s')).toBe(true);
    expect(isValidUrlTemplate('https://www.bing.com/search?q=')).toBe(false);
  });

  it('要求替换后仍是合法地址', () => {
    expect(isValidUrlTemplate('not-a-url-%s')).toBe(false);
  });
});

describe('normalizeInputToUrl', () => {
  it('完整 URL 原样返回', () => {
    expect(normalizeInputToUrl('https://a.com/b')).toBe('https://a.com/b');
  });

  it('裸域名补 https', () => {
    expect(normalizeInputToUrl('example.com')).toBe('https://example.com');
    expect(normalizeInputToUrl('localhost:3000')).toBe('https://localhost:3000');
  });

  it('含空格的搜索词不当作地址', () => {
    expect(normalizeInputToUrl('hello world')).toBeNull();
  });
});

describe('dedupeByUrl', () => {
  it('忽略末尾斜杠与大小写差异', () => {
    const out = dedupeByUrl([
      { url: 'https://Example.com/' },
      { url: 'https://example.com' },
      { url: 'https://other.com' },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('normalizeUrlKey', () => {
  it('统一 host 大小写并去掉末尾斜杠', () => {
    expect(normalizeUrlKey('https://EXAMPLE.com/path/')).toBe(
      'https://example.com/path',
    );
  });

  it('保留 query', () => {
    expect(normalizeUrlKey('https://a.com/x?a=1')).toBe('https://a.com/x?a=1');
  });
});

describe('reindexOrder', () => {
  it('按 order 排序并重排为连续序号', () => {
    const out = reindexOrder([
      { order: 5, id: 'c' },
      { order: 1, id: 'a' },
      { order: 3, id: 'b' },
    ]);
    expect(out.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(out.map((o) => o.order)).toEqual([0, 1, 2]);
  });
});

describe('isSettings', () => {
  it('默认设置应通过校验', () => {
    expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  it('主题非法则失败', () => {
    expect(isSettings({ ...DEFAULT_SETTINGS, theme: 'neon' })).toBe(false);
  });

  it('缺少必需字段则失败', () => {
    const { wallpaper: _drop, ...rest } = DEFAULT_SETTINGS;
    expect(isSettings(rest)).toBe(false);
  });
});

describe('validateImportBundle', () => {
  it('非对象直接报错', () => {
    const issues = validateImportBundle('nope');
    expect(issues[0].path).toBe('$');
  });

  it('缺少 schemaVersion 会提示', () => {
    const issues = validateImportBundle({});
    expect(issues.some((i) => i.path === 'schemaVersion')).toBe(true);
  });

  it('版本过高时明确拒绝', () => {
    const issues = validateImportBundle({ schemaVersion: 99 });
    expect(issues[0].message).toContain('高于当前支持');
  });

  it('引擎 urlTemplate 非法时给出字段级提示', () => {
    const issues = validateImportBundle({
      schemaVersion: 1,
      engines: [{ id: 'x', name: 'X', urlTemplate: 'https://a.com/?q=', icon: 'globe', order: 0 }],
    });
    expect(issues.some((i) => i.path === 'engines[0]')).toBe(true);
  });

  it('快捷方式 url 非法时给出字段级提示', () => {
    const issues = validateImportBundle({
      schemaVersion: 1,
      shortcuts: [{ id: 's', name: 'S', url: 'nope', icon: 'auto', hideName: false, order: 0 }],
    });
    expect(issues.some((i) => i.path === 'shortcuts[0]')).toBe(true);
  });

  it('合法文件返回空问题列表', () => {
    const issues = validateImportBundle({
      schemaVersion: 1,
      settings: DEFAULT_SETTINGS,
      engines: [],
      shortcuts: [],
      modules: [],
    });
    expect(issues).toEqual([]);
  });
});

describe('validateImageFile', () => {
  const file = (type: string, size: number) =>
    ({ type, size }) as File;

  it('接受 jpg / png / webp', () => {
    expect(validateImageFile(file('image/jpeg', 1024))).toEqual([]);
    expect(validateImageFile(file('image/png', 1024))).toEqual([]);
    expect(validateImageFile(file('image/webp', 1024))).toEqual([]);
  });

  it('拒绝不支持的格式', () => {
    expect(validateImageFile(file('image/gif', 100))).toHaveLength(1);
  });

  it('拒绝超过 5MB', () => {
    const issues = validateImageFile(file('image/png', 5 * 1024 * 1024 + 1));
    expect(issues[0].message).toContain('超过 5MB');
  });
});
