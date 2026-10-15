/**
 * 布局 store —— P0 预设布局 + P1 网格编辑骨架
 *
 * P1 的撤销/重做、吸附、冲突回退都在 `lib/layout.ts`，
 * 这一层只负责「编辑会话」的生命周期：
 *   begin() → 一系列 commit → save() / cancel()
 */
import { createStore } from 'zustand/vanilla';
import { DEFAULT_LAYOUT, STORAGE_KEYS } from '../lib/defaults';
import { readRaw, writeRaw } from '../lib/storage';
import { isLayoutState } from '../lib/validate';
import {
  createHistory,
  initialGrid,
  pushHistory,
  redoHistory,
  undoHistory,
  canRedo,
  canUndo,
  validatePlacement,
  findFreeSlot,
  visibleModules,
  type HistoryState,
} from '../lib/layout';
import type { GridPlacement, LayoutState, PresetLayout } from '../types';
import { modulesStore } from './settings';

export interface LayoutState_Store {
  layout: LayoutState;
  ready: boolean;
  /** 是否处于布局编辑模式（P1） */
  editing: boolean;
  /** 编辑会话内的工作副本 */
  draft: HistoryState<GridPlacement[]>;
  /** 上一次非法操作的原因，用于 UI 抖动提示 */
  lastReject: 'overlap' | 'out-of-bounds' | null;

  init(): Promise<void>;
  setPreset(preset: PresetLayout): Promise<void>;
  reset(): Promise<void>;

  beginEdit(): void;
  cancelEdit(): void;
  saveEdit(): Promise<void>;
  commitGrid(next: GridPlacement[]): void;
  tryMove(moduleId: string, col: number, span: number): boolean;
  tryResize(moduleId: string, span: number): boolean;
  addModuleToGrid(moduleId: string): void;
  removeModuleFromGrid(moduleId: string): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  clearReject(): void;
}

function persist(layout: LayoutState): Promise<unknown> {
  return writeRaw('sync', STORAGE_KEYS.layout, layout);
}

export const layoutStore = createStore<LayoutState_Store>((set, get) => ({
  layout: structuredClone(DEFAULT_LAYOUT),
  ready: false,
  editing: false,
  draft: createHistory<GridPlacement[]>([]),
  lastReject: null,

  async init() {
    const raw = await readRaw<unknown>('sync', STORAGE_KEYS.layout);
    const layout = isLayoutState(raw) ? raw : structuredClone(DEFAULT_LAYOUT);
    set({ layout, ready: true });
  },

  async setPreset(preset) {
    const layout: LayoutState = { ...get().layout, preset };
    set({ layout });
    await persist(layout);
  },

  async reset() {
    const layout = structuredClone(DEFAULT_LAYOUT);
    set({ layout: { ...layout, grid: initialGrid(modulesStore.getState().modules) } });
    await persist(get().layout);
  },

  // ── 编辑会话 ──────────────────────────────────────────────

  beginEdit() {
    const modules = modulesStore.getState().modules;
    const existing = get().layout.grid;
    // 已有网格直接用；没有则为可见模块铺初始布局
    const grid = existing.length ? existing : initialGrid(modules);
    set({
      editing: true,
      draft: createHistory(grid),
      lastReject: null,
    });
  },

  cancelEdit() {
    set({ editing: false, lastReject: null });
  },

  async saveEdit() {
    const layout: LayoutState = {
      ...get().layout,
      grid: get().draft.present,
    };
    set({ layout, editing: false, lastReject: null });
    await persist(layout);
  },

  commitGrid(next) {
    set({ draft: pushHistory(get().draft, next) });
  },

  tryMove(moduleId, col, span) {
    const { draft } = get();
    const others = draft.present.filter((p) => p.moduleId !== moduleId);
    const original = draft.present.find((p) => p.moduleId === moduleId) ?? {
      moduleId,
      col,
      span,
      row: 1,
    };
    const check = validatePlacement({ ...original, col, span }, others, original);
    if (!check.ok) {
      set({ lastReject: check.reason });
      return false;
    }
    const next = draft.present.map((p) =>
      p.moduleId === moduleId ? check.placement : p,
    );
    set({ draft: pushHistory(draft, next), lastReject: null });
    return true;
  },

  tryResize(moduleId, span) {
    const current = get().draft.present.find((p) => p.moduleId === moduleId);
    if (!current) return false;
    return get().tryMove(moduleId, current.col, span);
  },

  addModuleToGrid(moduleId) {
    const { draft } = get();
    if (draft.present.some((p) => p.moduleId === moduleId)) return;
    const slot = findFreeSlot(12, draft.present);
    const next = [...draft.present, { ...slot, moduleId }];
    set({ draft: pushHistory(draft, next) });
  },

  removeModuleFromGrid(moduleId) {
    const { draft } = get();
    const next = draft.present.filter((p) => p.moduleId !== moduleId);
    if (next.length === draft.present.length) return;
    set({ draft: pushHistory(draft, next) });
  },

  undo() {
    set({ draft: undoHistory(get().draft), lastReject: null });
  },

  redo() {
    set({ draft: redoHistory(get().draft), lastReject: null });
  },

  canUndo() {
    return canUndo(get().draft);
  },

  canRedo() {
    return canRedo(get().draft);
  },

  clearReject() {
    if (get().lastReject) set({ lastReject: null });
  },
}));

/** 编辑模式下用于渲染的网格：编辑时用 draft，否则用已保存布局 */
export function activeGrid(store = layoutStore): GridPlacement[] {
  const s = store.getState();
  if (s.editing && s.draft.present.length) return s.draft.present;
  if (s.layout.grid.length) return s.layout.grid;
  return initialGrid(modulesStore.getState().modules);
}

export { visibleModules };
