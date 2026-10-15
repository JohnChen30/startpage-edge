/**
 * UI store —— 跨组件的界面临时状态
 *
 * 这里只放「不持久化」的状态：
 *   · 收藏夹弹窗开关
 *   · 设置抽屉开关与当前分类
 *   · 布局编辑模式
 *   · 全局 toast
 *   · 搜索框当前输入（SearchBar ↔ EngineBar 共享，屏幕阅读器与点击引擎都要用）
 *   · 壁纸图片是否正在加载（Wallpaper 写入 → 左下角按钮读它来转圈）
 */
import { createStore } from 'zustand/vanilla';
import { DEFAULT_SECTION_ID } from '../lib/defaults';

export type SettingsTab =
  'appearance' | 'search' | 'shortcuts' | 'bookmarks' | 'modules' | 'data';

export interface Toast {
  id: string;
  message: string;
  kind: 'info' | 'success' | 'error';
  /** 毫秒，0 表示不自动关闭 */
  duration: number;
}

export interface UIState {
  bookmarkDialogOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  editorOpen: boolean;
  toasts: Toast[];

  /**
   * 搜索框当前输入的词。
   *
   * 放在共享 store 而不是 SearchBar 内部，是因为「点击引擎栏用该引擎搜索」
   * 这条交互需要 EngineBar 拿到同一个词 —— 若各存各的，EngineBar 永远
   * 看到空串，就只会切换默认引擎而不会发起搜索。
   */
  searchQuery: string;

  /** 收藏夹弹窗当前选中的书签 id（多选批量导入用） */
  selectedBookmarks: Set<string>;

  /**
   * 当前正在查看的快捷方式分区 id。
   *
   * 放在共享 store 而不是 ShortcutGrid 内部：胶囊指示器、滚轮切换、
   * 添加快捷方式等都要读写同一个值，单独持有会不一致。
   * 缺省为默认分区（DEFAULT_SECTION_ID）。
   */
  currentSectionId: string;

  /**
   * 切换分区时的视觉方向：'next' 表示进入下一页（内容从右滑入）、
   * 'prev' 表示从左侧滑入、null 表示无方向（中性淡入）。
   * 由触发切换的来源（滚轮方向 / 胶囊点击相对位置）显式写入，
   * ShortcutGrid 据此播放「平移 + 淡入」动画。
   */
  slideDir: 'next' | 'prev' | null;

  /**
   * 壁纸图片是否正在加载（从「换了一张」到「新图解码完成」为真）。
   *
   * 由 Wallpaper.svelte 写入、WallpaperActions.svelte 读取：
   * 换壁纸要经历「取列表 → 下载图片 → 解码」三步，中间那段没有任何视觉反馈，
   * 用户会以为点了没反应。左下角按钮靠它转圈，才对得上「正在加载」的真实时长 ——
   * 只用自己的 busy 是不够的：那一步只覆盖取列表，图片下载才是大头。
   */
  wallpaperLoading: boolean;

  setWallpaperLoading(v: boolean): void;
  setCurrentSection(id: string, dir?: 'next' | 'prev'): void;

  openBookmarks(): void;
  closeBookmarks(): void;
  openSettings(tab?: SettingsTab): void;
  closeSettings(): void;
  setSettingsTab(tab: SettingsTab): void;
  setEditorOpen(v: boolean): void;
  setSearchQuery(q: string): void;
  toggleBookmarkSelection(id: string): void;
  setBookmarkSelection(ids: string[]): void;
  clearBookmarkSelection(): void;
  toast(message: string, kind?: Toast['kind'], duration?: number): void;
  dismissToast(id: string): void;
}

export const uiStore = createStore<UIState>((set, get) => ({
  bookmarkDialogOpen: false,
  settingsOpen: false,
  settingsTab: 'appearance',
  editorOpen: false,
  toasts: [],
  searchQuery: '',
  selectedBookmarks: new Set<string>(),
  currentSectionId: DEFAULT_SECTION_ID,
  slideDir: null,
  wallpaperLoading: false,

  setWallpaperLoading(v) {
    if (get().wallpaperLoading === v) return;
    set({ wallpaperLoading: v });
  },

  setCurrentSection(id, dir) {
    if (get().currentSectionId === id) return;
    set({ currentSectionId: id, slideDir: dir ?? null });
  },

  openBookmarks() {
    set({
      bookmarkDialogOpen: true,
      settingsOpen: false,
      // 每次打开都从空选择开始，避免上次的勾选残留
      selectedBookmarks: new Set<string>(),
    });
  },
  closeBookmarks() {
    set({ bookmarkDialogOpen: false, selectedBookmarks: new Set<string>() });
  },
  openSettings(tab) {
    set({
      settingsOpen: true,
      bookmarkDialogOpen: false,
      settingsTab: tab ?? get().settingsTab,
    });
  },
  closeSettings() {
    set({ settingsOpen: false });
  },
  setSettingsTab(tab) {
    set({ settingsTab: tab });
  },
  setEditorOpen(v) {
    set({ editorOpen: v });
  },
  setSearchQuery(q) {
    if (get().searchQuery === q) return;
    set({ searchQuery: q });
  },

  toggleBookmarkSelection(id) {
    const next = new Set(get().selectedBookmarks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedBookmarks: next });
  },

  setBookmarkSelection(ids) {
    set({ selectedBookmarks: new Set(ids) });
  },

  clearBookmarkSelection() {
    set({ selectedBookmarks: new Set<string>() });
  },

  toast(message, kind = 'info', duration = 2600) {
    const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    set({ toasts: [...get().toasts, { id, message, kind, duration }] });
    if (duration > 0) {
      setTimeout(() => get().dismissToast(id), duration);
    }
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
