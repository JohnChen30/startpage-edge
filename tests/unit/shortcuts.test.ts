/**
 * 快捷方式 store 单测
 *
 * 重点覆盖约束：数量上限、URL 去重、字段校验、排序持久化。
 * 环境无 chrome API，走 indexdb/storage 的内存与 fake-indexeddb 路径。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { shortcutsStore } from '../../src/stores/shortcuts';
import { __resetStorageForTests } from '../../src/lib/storage';
import { SHORTCUT_LIMITS } from '../../src/lib/defaults';
import { normalizeUrlKey } from '../../src/lib/validate';

beforeEach(async () => {
  __resetStorageForTests();
  shortcutsStore.setState({ shortcuts: [], ready: false });
  await shortcutsStore.getState().init();
});

describe('add', () => {
  it('添加合法快捷方式', async () => {
    const res = await shortcutsStore
      .getState()
      .add({ name: 'GitHub', url: 'https://github.com' });
    expect(res.ok).toBe(true);
    expect(shortcutsStore.getState().shortcuts).toHaveLength(1);
  });

  it('拒绝非 http(s) 地址', async () => {
    const res = await shortcutsStore
      .getState()
      .add({ name: 'X', url: 'javascript:alert(1)' });
    expect(res.ok).toBe(false);
  });

  it('拒绝重复 URL（忽略末尾斜杠）', async () => {
    await shortcutsStore.getState().add({ name: 'A', url: 'https://a.com' });
    const res = await shortcutsStore
      .getState()
      .add({ name: 'A2', url: 'https://a.com/' });
    expect(res.ok).toBe(false);
    expect(shortcutsStore.getState().shortcuts).toHaveLength(1);
  });

  it('名字留空时自动取域名', async () => {
    await shortcutsStore
      .getState()
      .add({ name: '', url: 'https://www.example.com/path' });
    expect(shortcutsStore.getState().shortcuts[0].name).toBe('example.com');
  });

  it('名字超长时截断', async () => {
    const long = 'x'.repeat(100);
    await shortcutsStore.getState().add({ name: long, url: 'https://long.com' });
    expect(shortcutsStore.getState().shortcuts[0].name).toHaveLength(
      SHORTCUT_LIMITS.nameMaxLength,
    );
  });

  it('达到上限后拒绝新增', async () => {
    for (let i = 0; i < SHORTCUT_LIMITS.max; i++) {
      await shortcutsStore
        .getState()
        .add({ name: `s${i}`, url: `https://s${i}.com` });
    }
    const res = await shortcutsStore
      .getState()
      .add({ name: 'overflow', url: 'https://overflow.com' });
    expect(res.ok).toBe(false);
    expect(shortcutsStore.getState().shortcuts).toHaveLength(SHORTCUT_LIMITS.max);
  });

  it('order 递增', async () => {
    await shortcutsStore.getState().add({ name: 'a', url: 'https://a.com' });
    await shortcutsStore.getState().add({ name: 'b', url: 'https://b.com' });
    expect(shortcutsStore.getState().shortcuts.map((s) => s.order)).toEqual([0, 1]);
  });
});

describe('addMany', () => {
  it('批量添加并统计跳过数', async () => {
    const res = await shortcutsStore.getState().addMany([
      { name: 'a', url: 'https://a.com' },
      { name: 'b', url: 'https://b.com' },
      { name: 'dup', url: 'https://a.com' },
      { name: 'bad', url: 'not-a-url' },
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.added).toBe(2);
      expect(res.value.skipped).toBe(2);
    }
  });

  it('全部重复时不写入', async () => {
    await shortcutsStore.getState().add({ name: 'a', url: 'https://a.com' });
    const res = await shortcutsStore
      .getState()
      .addMany([{ name: 'a', url: 'https://a.com' }]);
    if (res.ok) expect(res.value.added).toBe(0);
    expect(shortcutsStore.getState().shortcuts).toHaveLength(1);
  });
});

describe('update', () => {
  it('修改名字', async () => {
    const res = await shortcutsStore
      .getState()
      .add({ name: 'old', url: 'https://a.com' });
    const id = res.ok ? res.value.id : '';
    const upd = await shortcutsStore.getState().update(id, { name: 'new' });
    expect(upd.ok).toBe(true);
    expect(shortcutsStore.getState().shortcuts[0].name).toBe('new');
  });

  it('改成非法 URL 会被拒绝', async () => {
    const res = await shortcutsStore
      .getState()
      .add({ name: 'a', url: 'https://a.com' });
    const id = res.ok ? res.value.id : '';
    const upd = await shortcutsStore.getState().update(id, { url: 'nope' });
    expect(upd.ok).toBe(false);
  });

  it('改成与其它项重复的 URL 会被拒绝', async () => {
    const r1 = await shortcutsStore
      .getState()
      .add({ name: 'a', url: 'https://a.com' });
    await shortcutsStore.getState().add({ name: 'b', url: 'https://b.com' });
    const id = r1.ok ? r1.value.id : '';
    const upd = await shortcutsStore
      .getState()
      .update(id, { url: 'https://b.com' });
    expect(upd.ok).toBe(false);
  });

  it('切换 hideName', async () => {
    const res = await shortcutsStore
      .getState()
      .add({ name: 'a', url: 'https://a.com' });
    const id = res.ok ? res.value.id : '';
    await shortcutsStore.getState().update(id, { hideName: true });
    expect(shortcutsStore.getState().shortcuts[0].hideName).toBe(true);
  });
});

describe('remove / moveTo', () => {
  it('删除后 order 重排连续', async () => {
    await shortcutsStore.getState().add({ name: 'a', url: 'https://a.com' });
    await shortcutsStore.getState().add({ name: 'b', url: 'https://b.com' });
    const c = await shortcutsStore
      .getState()
      .add({ name: 'c', url: 'https://c.com' });
    const id = c.ok ? c.value.id : '';

    await shortcutsStore.getState().remove(id);
    expect(shortcutsStore.getState().shortcuts.map((s) => s.name)).toEqual([
      'a',
      'b',
    ]);
    expect(shortcutsStore.getState().shortcuts.map((s) => s.order)).toEqual([0, 1]);
  });

  it('向后移动把首项挪到末尾', async () => {
    // 用 addMany 一次性建好，再显式断言顺序，避免依赖 add 的累积行为
    await shortcutsStore.getState().addMany([
      { name: 'a', url: 'https://a.com' },
      { name: 'b', url: 'https://b.com' },
      { name: 'c', url: 'https://c.com' },
    ]);
    expect(shortcutsStore.getState().shortcuts.map((s) => s.name)).toEqual([
      'a',
      'b',
      'c',
    ]);

    await shortcutsStore.getState().moveTo(0, 2);
    expect(shortcutsStore.getState().shortcuts.map((s) => s.name)).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(shortcutsStore.getState().shortcuts.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it('向前移动把末项挪到开头', async () => {
    await shortcutsStore.getState().addMany([
      { name: 'a', url: 'https://a.com' },
      { name: 'b', url: 'https://b.com' },
      { name: 'c', url: 'https://c.com' },
    ]);

    await shortcutsStore.getState().moveTo(2, 0);
    expect(shortcutsStore.getState().shortcuts.map((s) => s.name)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('移动越界时是空操作', async () => {
    await shortcutsStore.getState().add({ name: 'a', url: 'https://a.com' });
    await shortcutsStore.getState().moveTo(5, 0);
    expect(shortcutsStore.getState().shortcuts).toHaveLength(1);  });
});

describe('importBookmark', () => {
  it('把书签转成快捷方式', async () => {
    const res = await shortcutsStore.getState().importBookmark({
      id: 'b1',
      title: 'Example',
      url: 'https://example.com',
    });
    expect(res.ok).toBe(true);
    expect(shortcutsStore.getState().shortcuts[0].name).toBe('Example');
  });

  it('无 URL 的节点被拒绝', async () => {
    const res = await shortcutsStore
      .getState()
      .importBookmark({ id: 'f1', title: 'Folder' });
    expect(res.ok).toBe(false);
  });
});

describe('applyFromStorage', () => {
  it('接受合法数组', async () => {
    shortcutsStore.getState().applyFromStorage([
      {
        id: 'x',
        name: 'X',
        url: 'https://x.com',
        icon: 'auto',
        hideName: false,
        order: 0,
        createdAt: 0,
      },
    ]);
    expect(shortcutsStore.getState().shortcuts).toHaveLength(1);
  });

  it('非法数据被忽略，保持原状态不变', async () => {
    shortcutsStore.setState({ shortcuts: [] });
    shortcutsStore.getState().applyFromStorage([{ bad: true }]);
    expect(shortcutsStore.getState().shortcuts).toHaveLength(0);
  });
});

describe('normalizeUrlKey 行为一致性', () => {
  it('与去重逻辑保持一致', () => {
    expect(normalizeUrlKey('https://A.com/')).toBe(normalizeUrlKey('https://a.com'));
  });
});
