/**
 * 快捷方式 store
 *
 * 约束：
 *   · 数量上限 SHORTCUT_LIMITS.max
 *   · 按 URL 去重（忽略末尾斜杠 / 大小写）
 *   · 排序持久化到 chrome.storage.local
 *   · 自定义图标存 IndexedDB，store 里只留 ref
 */
import { createStore } from 'zustand/vanilla';
import { DEFAULT_SECTION_ID, SHORTCUT_LIMITS, STORAGE_KEYS } from '../lib/defaults';
import { readRaw, subscribeKey, writeRaw } from '../lib/storage';
import {
  assignOrder,
  dedupeBySectionUrl,
  isHttpUrl,
  isShortcutArray,
  migrateShortcuts,
  normalizeUrlKey,
  reindexOrder,
} from '../lib/validate';
import { arrayMove } from '../lib/drag';
import type { BookmarkNode, Result, Shortcut } from '../types';

export type AddShortcutInput = {
  name: string;
  url: string;
  icon?: string;
  /** 所属分区 id；缺省归入默认分区 */
  sectionId?: string;
};

/** 可撤回的快照：只保留「快捷方式数组」这一份状态 */
interface Snapshot {
  label: string;
  shortcuts: Shortcut[];
}

export interface ShortcutsState {
  shortcuts: Shortcut[];
  ready: boolean;
  /**
   * 撤回栈。每次「添加 / 删除 / 导入 / 清空」前压入一份改动前的快照，
   * 全局只保留最近 MAX_HISTORY 步，供「撤回上次操作」回退。
   * 排序（moveTo）不进撤销栈 —— 拖拽本身已经足够直观，且容易连点。
   */
  history: Snapshot[];
  init(): Promise<void>;
  add(input: AddShortcutInput): Promise<Result<Shortcut>>;
  addMany(
    inputs: AddShortcutInput[],
  ): Promise<Result<{ added: number; skipped: number }>>;
  update(
    id: string,
    patch: Partial<Pick<Shortcut, 'name' | 'url' | 'icon' | 'hideName'>>,
  ): Promise<Result<void>>;
  remove(id: string): Promise<void>;
  moveTo(fromIndex: number, toIndex: number): Promise<void>;
  /** 导入一个收藏夹书签 */
  importBookmark(node: BookmarkNode): Promise<Result<Shortcut>>;
  clear(): Promise<void>;
  /** 把某分区的所有快捷方式改挂到另一个分区 */
  reassignSection(fromId: string, toId: string): Promise<void>;
  /** 仅在同一分区内部重排：from / to 为该分区可见列表中的下标 */
  reorderSection(sectionId: string, fromIndex: number, toIndex: number): Promise<void>;
  /** 撤回最近一次添加 / 删除 / 导入 / 清空 */
  undo(): Promise<Result<string>>;
  applyFromStorage(raw: unknown): void;
}

/** 撤销栈深度上限，避免长时间使用后占用过多内存 */
const MAX_HISTORY = 30;

function persist(shortcuts: Shortcut[]): Promise<unknown> {
  // 传入的数组已是期望顺序，直接按下标赋 order 后落盘
  return writeRaw('local', STORAGE_KEYS.shortcuts, assignOrder(shortcuts));
}

function makeId(): string {
  return `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 兜底名字：从 URL 推导一个可读名称 */
function nameFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 旧数据缺 sectionId 时全部归入默认分区 */
function withDefaultSection(list: Shortcut[]): Shortcut[] {
  return list.map((s) =>
    s.sectionId ? s : { ...s, sectionId: DEFAULT_SECTION_ID },
  );
}

export const shortcutsStore = createStore<ShortcutsState>((set, get) => {
  /** 压入一份「改动前」的快照，供 undo 回退 */
  function pushHistory(label: string): void {
    const snapshot: Snapshot = {
      label,
      shortcuts: get().shortcuts.map((s) => ({ ...s })),
    };
    const history = [...get().history, snapshot].slice(-MAX_HISTORY);
    set({ history });
  }

  return {
    shortcuts: [],
    ready: false,
    history: [],

    async init() {
      const raw = await readRaw<unknown>('local', STORAGE_KEYS.shortcuts);
      const loaded = isShortcutArray(raw)
        ? dedupeBySectionUrl(raw)
        : (migrateShortcuts(raw) ?? []);
      // 旧数据（无 sectionId）全部归入默认分区
      const shortcuts = withDefaultSection(loaded);
      // 初始化时清空撤销栈：跨会话回退到旧状态会让用户困惑
      set({ shortcuts: reindexOrder(shortcuts), ready: true, history: [] });
    },

    async add(input) {
      const url = input.url.trim();
      const name = (input.name.trim() || nameFromUrl(url)).slice(
        0,
        SHORTCUT_LIMITS.nameMaxLength,
      );

      if (!isHttpUrl(url)) {
        return { ok: false, error: '网址必须是 http(s) 地址' };
      }
      if (get().shortcuts.length >= SHORTCUT_LIMITS.max) {
        return { ok: false, error: `快捷方式最多 ${SHORTCUT_LIMITS.max} 个` };
      }
      const sectionId = input.sectionId ?? DEFAULT_SECTION_ID;
      const key = normalizeUrlKey(url);
      if (
        get().shortcuts.some(
          (s) => s.sectionId === sectionId && normalizeUrlKey(s.url) === key,
        )
      ) {
        return { ok: false, error: '该网址已在本分区快捷方式中' };
      }

      const shortcut: Shortcut = {
        id: makeId(),
        name,
        url,
        icon: input.icon || 'auto',
        hideName: false,
        order: get().shortcuts.length,
        createdAt: Date.now(),
        sectionId,
      };
      pushHistory(`添加「${name}」`);
      const shortcuts = [...get().shortcuts, shortcut];
      set({ shortcuts });
      await persist(shortcuts);
      return { ok: true, value: shortcut };
    },

    async addMany(inputs) {
      // 以「分区 + URL」为唯一键：同一分区内不重复，但不同分区可重复同一网址
      const existing = new Set(
        get().shortcuts.map(
          (s) => `${s.sectionId}::${normalizeUrlKey(s.url)}`,
        ),
      );
      const added: Shortcut[] = [];
      let skipped = 0;

      for (const input of inputs) {
        if (get().shortcuts.length + added.length >= SHORTCUT_LIMITS.max) {
          skipped++;
          continue;
        }
        const url = input.url.trim();
        if (!isHttpUrl(url)) {
          skipped++;
          continue;
        }
        const sectionId = input.sectionId ?? DEFAULT_SECTION_ID;
        const key = `${sectionId}::${normalizeUrlKey(url)}`;
        if (existing.has(key)) {
          skipped++;
          continue;
        }
        existing.add(key);
        added.push({
          id: makeId(),
          name: (input.name.trim() || nameFromUrl(url)).slice(
            0,
            SHORTCUT_LIMITS.nameMaxLength,
          ),
          url,
          icon: input.icon || 'auto',
          hideName: false,
          order: get().shortcuts.length + added.length,
          createdAt: Date.now(),
          sectionId,
        });
      }

      if (added.length) {
        pushHistory(`导入 ${added.length} 项`);
        const shortcuts = [...get().shortcuts, ...added];
        set({ shortcuts });
        await persist(shortcuts);
      }
      return { ok: true, value: { added: added.length, skipped } };
    },

  async update(id, patch) {
    if (patch.url !== undefined && !isHttpUrl(patch.url)) {
      return { ok: false, error: '网址必须是 http(s) 地址' };
    }
    if (patch.url !== undefined) {
      const key = normalizeUrlKey(patch.url);
      // 仅在「被编辑项所在分区」内判重：不同分区的同名网址互不冲突
      const target = get().shortcuts.find((s) => s.id === id);
      const targetSection = target?.sectionId ?? DEFAULT_SECTION_ID;
      const dup = get().shortcuts.some(
        (s) =>
          s.id !== id &&
          s.sectionId === targetSection &&
          normalizeUrlKey(s.url) === key,
      );
      if (dup) return { ok: false, error: '该网址已在本分区快捷方式中' };
    }
    const clean = { ...patch };
    if (clean.name !== undefined) {
      clean.name = clean.name.trim().slice(0, SHORTCUT_LIMITS.nameMaxLength);
    }
    const shortcuts = get().shortcuts.map((s) =>
      s.id === id ? { ...s, ...clean } : s,
    );
    set({ shortcuts });
    await persist(shortcuts);
    return { ok: true, value: undefined };
  },

    async remove(id) {
      const target = get().shortcuts.find((s) => s.id === id);
      pushHistory(target ? `删除「${target.name}」` : '删除快捷方式');
      // filter 已保持相对顺序，直接按下标重赋 order 即可
      const shortcuts = assignOrder(get().shortcuts.filter((s) => s.id !== id));
      set({ shortcuts });
      await persist(shortcuts);
    },

    async moveTo(fromIndex, toIndex) {
      const moved = arrayMove(get().shortcuts, fromIndex, toIndex);
      // arrayMove 在无需移动时返回原引用，此时不必落盘
      if (moved === get().shortcuts) return;
      // 数组顺序即用户意图，order 跟着数组走（不能用 reindexOrder，它会按旧 order 重排）
      // 排序不进撤销栈：拖拽结果已在屏幕上，再留一步「撤回拖动」意义不大
      const shortcuts = assignOrder(moved);
      set({ shortcuts });
      await persist(shortcuts);
    },

    async reassignSection(fromId, toId) {
      if (fromId === toId) return;
      const updated = get().shortcuts.map((s) =>
        s.sectionId === fromId ? { ...s, sectionId: toId } : s,
      );
      // 只是改挂分区，顺序不变（arrayMove 顺序稳定），无需重排
      set({ shortcuts: updated });
      await persist(updated);
    },

    async reorderSection(sectionId, fromIndex, toIndex) {
      // 仅在该分区可见列表内重排，不影响其它分区
      const items = get()
        .shortcuts.filter((s) => s.sectionId === sectionId)
        .sort((a, b) => a.order - b.order);
      if (fromIndex < 0 || fromIndex >= items.length) return;
      const moved = arrayMove(items, fromIndex, toIndex);
      if (moved === items) return;
      // 把新的相对顺序写回这部分快捷方式的 order，其它分区保持不变。
      // 各分区内部从 0 重新编号即可：显示时按 sectionId 过滤后再按 order 排序，
      // 跨分区的 order 数值交错不影响各自展示，且导出/回读后顺序仍正确。
      const orderById = new Map(moved.map((s, i) => [s.id, i]));
      const shortcuts = get().shortcuts.map((s) =>
        orderById.has(s.id) ? { ...s, order: orderById.get(s.id)! } : s,
      );
      set({ shortcuts });
      await persist(shortcuts);
    },

    async importBookmark(node) {
      if (!node.url) return { ok: false, error: '该节点不是可跳转的书签' };
      return get().add({ name: node.title || node.url, url: node.url });
    },

    async clear() {
      if (!get().shortcuts.length) return;
      pushHistory('清空快捷方式');
      set({ shortcuts: [] });
      await persist([]);
    },

    /** 撤回最近一次添加 / 删除 / 导入 / 清空 */
    async undo() {
      const history = get().history;
      const last = history[history.length - 1];
      if (!last) return { ok: false, error: '没有可撤回的操作' };

      // 恢复快照里的数组；order 按数组下标重赋，保证与快照当时的顺序一致
      const restored = assignOrder(last.shortcuts.map((s) => ({ ...s })));
      set({ shortcuts: restored, history: history.slice(0, -1) });
      await persist(restored);
      return { ok: true, value: last.label };
    },

    applyFromStorage(raw) {
      if (isShortcutArray(raw)) {
        set({ shortcuts: reindexOrder(dedupeBySectionUrl(raw)) });
      }
    },
  };
});

export function watchShortcuts(): () => void {
  return subscribeKey(STORAGE_KEYS.shortcuts, (value) => {
    shortcutsStore.getState().applyFromStorage(value);
  });
}
