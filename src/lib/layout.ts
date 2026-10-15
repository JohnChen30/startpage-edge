/**
 * 布局计算 —— P0 模块管理 + 预设布局，P1 网格预留
 *
 * P0：只做模块显隐与排序，通过 data-preset 交给 CSS 决定对齐方式。
 * P1：12 列网格的吸附、碰撞检测、越界回退全部收在这一层，
 *     组件只负责渲染与派发意图，便于单测。
 */
import type { GridPlacement, LayoutState, ModuleConfig, PresetLayout } from '../types';

export const GRID_COLUMNS = 12;

// ── P0：可见模块 ────────────────────────────────────────────

/** 按 order 排序、过滤掉不可见的模块 */
export function visibleModules(modules: ModuleConfig[]): ModuleConfig[] {
  return [...modules].sort((a, b) => a.order - b.order).filter((m) => m.visible);
}

/** 用 type 换取模块配置（同一 type 只应存在一个） */
export function moduleByType(
  modules: ModuleConfig[],
  type: ModuleConfig['type'],
): ModuleConfig | undefined {
  return modules.find((m) => m.type === type);
}

/** 上下移动模块，越界则原样返回 */
export function moveModule(
  modules: ModuleConfig[],
  moduleId: string,
  direction: -1 | 1,
): ModuleConfig[] {
  const sorted = [...modules].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((m) => m.id === moduleId);
  if (index < 0) return modules;
  const target = index + direction;
  if (target < 0 || target >= sorted.length) return modules;

  const next = [...sorted];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((m, i) => ({ ...m, order: i }));
}

// ── P0：预设布局 ────────────────────────────────────────────

export function presetClassName(preset: PresetLayout): string {
  return `preset-${preset}`;
}

/** 两栏布局下，哪些模块进入右栏 */
export const TWO_COLUMN_SECONDARY: ModuleConfig['type'][] = ['shortcuts'];

export function isSecondaryModule(
  type: ModuleConfig['type'],
  preset: PresetLayout,
): boolean {
  if (preset !== 'two-column') return false;
  return TWO_COLUMN_SECONDARY.includes(type);
}

// ── P1：12 列网格 ───────────────────────────────────────────

export interface GridRect {
  col: number;
  row: number;
  span: number;
  /** 目前固定为 1 行，保留字段以便未来支持纵向跨行 */
  height: number;
}

export function toRect(p: GridPlacement): GridRect {
  return { col: p.col, row: p.row, span: p.span, height: 1 };
}

export function overlaps(a: GridRect, b: GridRect): boolean {
  return (
    a.col < b.col + b.span &&
    b.col < a.col + a.span &&
    a.row < b.row + b.height &&
    b.row < a.row + a.height
  );
}

/** 越界是指超出 12 列或第 1 行之前 */
export function isOutOfBounds(rect: GridRect): boolean {
  return rect.col < 1 || rect.col + rect.span - 1 > GRID_COLUMNS || rect.row < 1;
}

/** 把列位置夹到合法范围：保证 col + span - 1 ≤ 12 */
export function clampColumn(col: number, span: number): number {
  const maxCol = Math.max(1, GRID_COLUMNS - span + 1);
  return Math.min(maxCol, Math.max(1, Math.round(col)));
}

export type PlacementCheck =
  | { ok: true; placement: GridPlacement }
  | { ok: false; reason: 'out-of-bounds' | 'overlap'; fallback: GridPlacement };

/**
 * 校验一次拖拽/缩放结果。
 * 非法时给出「回退位置」而不是抛错 —— 非法位置自动回退到原位置。
 */
export function validatePlacement(
  candidate: GridPlacement,
  others: GridPlacement[],
  original: GridPlacement,
): PlacementCheck {
  const rect = toRect(candidate);
  if (isOutOfBounds(rect)) {
    return { ok: false, reason: 'out-of-bounds', fallback: original };
  }
  const hit = others
    .filter((p) => p.moduleId !== candidate.moduleId)
    .some((p) => overlaps(rect, toRect(p)));
  if (hit) {
    return { ok: false, reason: 'overlap', fallback: original };
  }
  return { ok: true, placement: candidate };
}

/** 找一行能放下 span 的空位（从第 1 行开始扫描） */
export function findFreeSlot(span: number, existing: GridPlacement[]): GridPlacement {
  const safeSpan = Math.min(GRID_COLUMNS, Math.max(1, Math.round(span)));
  for (let row = 1; row < 100; row++) {
    for (let col = 1; col + safeSpan - 1 <= GRID_COLUMNS; col++) {
      const candidate = { moduleId: '', col, row, span: safeSpan };
      const clash = existing.some((p) => overlaps(toRect(candidate), toRect(p)));
      if (!clash) return candidate;
    }
  }
  return { moduleId: '', col: 1, row: 1, span: safeSpan };
}

/**
 * 首帧布局：没有历史记录时为每个可见模块按顺序铺满整行。
 */
export function initialGrid(modules: ModuleConfig[]): GridPlacement[] {
  return visibleModules(modules).map((m, i) => ({
    moduleId: m.id,
    col: 1,
    span: GRID_COLUMNS,
    row: i + 1,
  }));
}

// ── 撤销 / 重做历史 ─────────────────────────────────────────

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

const HISTORY_LIMIT = 50;

export function pushHistory<T>(h: HistoryState<T>, next: T): HistoryState<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (!h.past.length) return h;
  const past = [...h.past];
  const previous = past.pop()!;
  return { past, present: previous, future: [h.present, ...h.future] };
}

export function redoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (!h.future.length) return h;
  const [next, ...future] = h.future;
  return { past: [...h.past, h.present], present: next, future };
}

export function canUndo<T>(h: HistoryState<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: HistoryState<T>): boolean {
  return h.future.length > 0;
}

// ── 窄屏判定 ────────────────────────────────────────────────

/** 编辑模式在窄屏下只读的分界点 */
export const EDIT_MODE_MIN_WIDTH = 900;

export function canEditGrid(viewportWidth: number): boolean {
  return viewportWidth >= EDIT_MODE_MIN_WIDTH;
}

export { type LayoutState };
