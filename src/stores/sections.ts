/**
 * 快捷方式分区 store
 *
 * 约束：
 *   · 分区列表独立存 chrome.storage.local（sp:sections），便于单独管理。
 *   · 默认分区（DEFAULT_SECTION_ID）永远存在，且不可删除、不可重命名其 id。
 *   · 删除非默认分区时，其下快捷方式移入默认分区（见 shortcutsStore.reassignSection）。
 *   · 排序持久化到 storage。
 */
import { createStore } from 'zustand/vanilla';
import { DEFAULT_SECTION_ID, DEFAULT_SECTION_NAME, STORAGE_KEYS } from '../lib/defaults';
import { readRaw, subscribeKey, writeRaw } from '../lib/storage';
import { assignOrder, isSectionArray, reindexOrder } from '../lib/validate';
import { arrayMove } from '../lib/drag';
import { shortcutsStore } from './shortcuts';
import type { Result, Section } from '../types';

export type AddSectionInput = {
  name?: string;
};

export interface SectionsState {
  sections: Section[];
  ready: boolean;
  init(): Promise<void>;
  add(input?: AddSectionInput): Promise<Result<Section>>;
  rename(id: string, name: string): Promise<Result<void>>;
  /** 删除分区；默认分区不可删，返回错误 */
  remove(id: string): Promise<Result<void>>;
  reorder(fromIndex: number, toIndex: number): Promise<void>;
  /** 把某个分区的快捷方式全部移入默认分区（删除前调用） */
  applyFromStorage(raw: unknown): void;
}

/** 保证默认分区在列表里，返回（可能修正过的）列表 */
function ensureDefault(list: Section[]): Section[] {
  if (list.some((s) => s.id === DEFAULT_SECTION_ID)) return list;
  return [...list, makeDefault()];
}

function makeDefault(): Section {
  return { id: DEFAULT_SECTION_ID, name: DEFAULT_SECTION_NAME, order: 0 };
}

function makeId(): string {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function persist(sections: Section[]): Promise<unknown> {
  return writeRaw('local', STORAGE_KEYS.sections, assignOrder(sections));
}

export const sectionsStore = createStore<SectionsState>((set, get) => ({
  sections: [makeDefault()],
  ready: false,

  async init() {
    const raw = await readRaw<unknown>('local', STORAGE_KEYS.sections);
    let sections = isSectionArray(raw) ? reindexOrder(raw) : [];
    // 首次加载：没有任何分区数据时，创建默认分区
    if (sections.length === 0) {
      sections = [makeDefault()];
      await persist(sections);
      set({ sections, ready: true });
      return;
    }
    // 任何情况下都保证默认分区存在（老数据 / 导入缺失时补上）
    const fixed = ensureDefault(sections);
    if (fixed.length !== sections.length) {
      await persist(fixed);
    }
    set({ sections: fixed, ready: true });
  },

  async add(input) {
    const name = (input?.name?.trim() || DEFAULT_SECTION_NAME).slice(0, 32);
    const section: Section = {
      id: makeId(),
      name,
      order: get().sections.length,
    };
    const sections = [...get().sections, section];
    set({ sections });
    await persist(sections);
    return { ok: true, value: section };
  },

  async rename(id, name) {
    if (id === DEFAULT_SECTION_ID) {
      return { ok: false, error: '默认分区不可重命名' };
    }
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: '分区名称不能为空' };
    const sections = get().sections.map((s) =>
      s.id === id ? { ...s, name: trimmed.slice(0, 32) } : s,
    );
    set({ sections });
    await persist(sections);
    return { ok: true, value: undefined };
  },

  async remove(id) {
    if (id === DEFAULT_SECTION_ID) {
      return { ok: false, error: '默认分区不可删除' };
    }
    if (!get().sections.some((s) => s.id === id)) {
      return { ok: false, error: '分区不存在' };
    }
    // 先把该分区下的快捷方式移入默认分区
    await shortcutsStore.getState().reassignSection(id, DEFAULT_SECTION_ID);
    const sections = assignOrder(get().sections.filter((s) => s.id !== id));
    set({ sections });
    await persist(sections);
    return { ok: true, value: undefined };
  },

  async reorder(fromIndex, toIndex) {
    const moved = arrayMove(get().sections, fromIndex, toIndex);
    if (moved === get().sections) return;
    const sections = assignOrder(moved);
    set({ sections });
    await persist(sections);
  },

  applyFromStorage(raw) {
    if (isSectionArray(raw)) {
      const fixed = ensureDefault(reindexOrder(raw));
      set({ sections: fixed });
    }
  },
}));

export function watchSections(): () => void {
  return subscribeKey(STORAGE_KEYS.sections, (value) => {
    sectionsStore.getState().applyFromStorage(value);
  });
}
