/**
 * 收藏夹 store —— 只读视图 + 变化订阅
 *
 * 书签数据永不落 chrome.storage，只活在内存里。
 */
import { createStore } from 'zustand/vanilla';
import {
  bookmarkToShortcutInput,
  demoSnapshot,
  hasBookmarksApi,
  loadBookmarks,
  searchInTree,
  watchBookmarks,
} from '../lib/bookmarks';
import { shortcutsStore } from './shortcuts';
import type { BookmarkNode, BookmarksSnapshot, Result } from '../types';

export interface BookmarksState {
  snapshot: BookmarksSnapshot;
  ready: boolean;
  /** 是否使用演示数据（用于 UI 明确提示） */
  usingDemo: boolean;
  /** 弹窗内搜索关键词 */
  query: string;
  /** 展开的文件夹 id 集合 */
  expanded: Set<string>;
  loading: boolean;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setQuery(q: string): void;
  toggleFolder(id: string): void;
  expandAll(): void;
  collapseAll(): void;
  /** 弹窗内搜索后的结果（无关键词时返回全部） */
  filtered(): BookmarkNode[];
  importOne(node: BookmarkNode): Promise<Result<void>>;
  dispose(): void;
}

let unwatch: (() => void) | null = null;

export const bookmarksStore = createStore<BookmarksState>((set, get) => ({
  snapshot: { state: 'prompt', tree: [], flat: [], count: 0 },
  ready: false,
  usingDemo: false,
  query: '',
  expanded: new Set<string>(),
  loading: false,

  async init() {
    set({ loading: true });
    const snapshot = await loadBookmarks(true);
    set({
      snapshot,
      ready: true,
      loading: false,
      usingDemo: !hasBookmarksApi() || snapshot.state === 'denied',
    });

    unwatch?.();
    unwatch = watchBookmarks((next) => {
      set({ snapshot: next, usingDemo: !hasBookmarksApi() });
    });
  },

  async refresh() {
    set({ loading: true });
    const snapshot = await loadBookmarks(true);
    set({ snapshot, ready: true, loading: false });
  },

  setQuery(query) {
    set({ query });
  },

  toggleFolder(id) {
    const expanded = new Set(get().expanded);
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    set({ expanded });
  },

  expandAll() {
    const ids = new Set<string>();
    const walk = (nodes: BookmarkNode[]) => {
      for (const n of nodes) {
        if (n.children?.length) {
          ids.add(n.id);
          walk(n.children);
        }
      }
    };
    walk(get().snapshot.tree);
    set({ expanded: ids });
  },

  collapseAll() {
    set({ expanded: new Set<string>() });
  },

  filtered() {
    const { snapshot, query } = get();
    if (!query.trim()) return snapshot.flat;
    return searchInTree(snapshot.flat, query);
  },

  async importOne(node) {
    const input = bookmarkToShortcutInput(node);
    if (!input) return { ok: false, error: '该节点不是可跳转的书签' };
    const res = await shortcutsStore
      .getState()
      .add({ name: input.title, url: input.url });
    return res.ok ? { ok: true, value: undefined } : res;
  },

  dispose() {
    unwatch?.();
    unwatch = null;
  },
}));

/** 触发一次演示数据加载，供无扩展环境预览 */
export function loadDemo(): void {
  bookmarksStore.setState({
    snapshot: demoSnapshot(),
    ready: true,
    usingDemo: true,
  });
}
