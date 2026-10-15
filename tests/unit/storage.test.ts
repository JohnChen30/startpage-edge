/**
 * 存储层单测 —— 重点验证「降级不崩」与「跨窗口同步」
 *
 * 测试环境没有 chrome API，storage.ts 会走内存回退，
 * 正好覆盖「扩展 API 不可用」这条最关键的异常路径。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStorageForTests,
  estimateBytes,
  readRaw,
  readValidated,
  removeRaw,
  subscribeKey,
  subscribeKeys,
  writeChecked,
  writeRaw,
} from '../../src/lib/storage';
import { isShortcutArray, isSettings } from '../../src/lib/validate';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../src/lib/defaults';

beforeEach(() => {
  __resetStorageForTests();
});

describe('基础读写', () => {
  it('写入后可读回', async () => {
    await writeRaw('local', 'k', { a: 1 });
    expect(await readRaw('local', 'k')).toEqual({ a: 1 });
  });

  it('读取不存在的键返回 undefined', async () => {
    expect(await readRaw('sync', 'missing')).toBeUndefined();
  });

  it('sync 与 local 相互隔离', async () => {
    await writeRaw('sync', 'k', 'in-sync');
    await writeRaw('local', 'k', 'in-local');
    expect(await readRaw('sync', 'k')).toBe('in-sync');
    expect(await readRaw('local', 'k')).toBe('in-local');
  });

  it('删除后读不到', async () => {
    await writeRaw('local', 'k', 1);
    await removeRaw('local', 'k');
    expect(await readRaw('local', 'k')).toBeUndefined();
  });
});

describe('readValidated', () => {
  it('数据合法时原样返回', async () => {
    await writeRaw('sync', STORAGE_KEYS.settings, DEFAULT_SETTINGS);
    const got = await readValidated(
      'sync',
      STORAGE_KEYS.settings,
      DEFAULT_SETTINGS,
      isSettings,
    );
    expect(got.theme).toBe('system');
  });

  it('数据损坏时回退默认值', async () => {
    await writeRaw('sync', STORAGE_KEYS.settings, { theme: 'broken' });
    const got = await readValidated(
      'sync',
      STORAGE_KEYS.settings,
      DEFAULT_SETTINGS,
      isSettings,
    );
    expect(got.theme).toBe('system');
  });

  it('键不存在时返回默认值副本，而非引用', async () => {
    const a = await readValidated('local', 'none', { n: 1 }, (_v): _v is { n: number } => true);
    a.n = 99;
    const b = await readValidated('local', 'none', { n: 1 }, (_v): _v is { n: number } => true);
    expect(b.n).toBe(1);
  });

  it('校验器抛异常时也不向外抛', async () => {
    await writeRaw('local', 'boom', 'x');
    const got = await readValidated(
      'local',
      'boom',
      'fallback',
      () => {
        throw new Error('校验器炸了');
      },
    );
    expect(got).toBe('fallback');
  });

  it('提供 migrate 时优先用迁移结果', async () => {
    await writeRaw('local', 'legacy', { old: true });
    const got = await readValidated<string[]>(
      'local',
      'legacy',
      [],
      isShortcutArray,
      () => [{ id: 'migrated' } as never],
    );
    expect(got).toHaveLength(1);
  });
});

describe('writeChecked', () => {
  it('正常写入返回 ok', async () => {
    const res = await writeChecked('local', 'k', 'v');
    expect(res.ok).toBe(true);
  });
});

describe('订阅', () => {
  it('订阅单个键能收到变化', async () => {
    const seen: unknown[] = [];
    const off = subscribeKey('x', (next) => seen.push(next));
    await writeRaw('sync', 'x', 'v1');
    await writeRaw('sync', 'x', 'v2');
    off();
    await writeRaw('sync', 'x', 'v3');
    expect(seen).toEqual(['v1', 'v2']);
  });

  it('订阅其它键不会误触发', async () => {
    const seen: unknown[] = [];
    const off = subscribeKey('watched', (next) => seen.push(next));
    await writeRaw('sync', 'other', 'nope');
    off();
    expect(seen).toEqual([]);
  });

  it('subscribeKeys 返回实际变化的键名', async () => {
    const hits: string[][] = [];
    const off = subscribeKeys(['a', 'b', 'c'], (_area, keys) => hits.push(keys));
    await writeRaw('sync', 'b', 1);
    await writeRaw('sync', 'a', 2);
    off();
    expect(hits).toEqual([['b'], ['a']]);
  });

  it('解绑后不再收到通知', async () => {
    let count = 0;
    const off = subscribeKey('k', () => count++);
    await writeRaw('sync', 'k', 1);
    off();
    await writeRaw('sync', 'k', 2);
    expect(count).toBe(1);
  });
});

describe('estimateBytes', () => {
  it('对象越大估算越大', () => {
    expect(estimateBytes({ a: 'x'.repeat(100) })).toBeGreaterThan(
      estimateBytes({ a: 'x' }),
    );
  });

  it('不可序列化时返回 0 而不是抛错', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(estimateBytes(cyclic)).toBe(0);
  });
});
