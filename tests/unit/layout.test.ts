/**
 * 布局计算单测 —— P0 模块管理与 P1 网格。
 * P1 虽然 UI 未开放，计算层已完整实现并在此锁定行为，
 * 避免后续接入时踩到「重叠 / 越界 / 历史错乱」的坑。
 */
import { describe, expect, it } from 'vitest';
import {
  GRID_COLUMNS,
  canRedo,
  canUndo,
  clampColumn,
  createHistory,
  findFreeSlot,
  initialGrid,
  isOutOfBounds,
  moveModule,
  overlaps,
  pushHistory,
  redoHistory,
  undoHistory,
  validatePlacement,
  visibleModules,
} from '../../src/lib/layout';
import { arrayMove } from '../../src/lib/drag';
import { BUILTIN_MODULES } from '../../src/lib/defaults';
import type { GridPlacement, ModuleConfig } from '../../src/types';

describe('visibleModules', () => {
  it('过滤隐藏模块并按 order 排序', () => {
    const modules: ModuleConfig[] = [
      { id: 'c', type: 'shortcuts', visible: true, order: 2 },
      { id: 'a', type: 'search', visible: false, order: 0 },
      { id: 'b', type: 'engines', visible: true, order: 1 },
    ];
    expect(visibleModules(modules).map((m) => m.id)).toEqual(['b', 'c']);
  });
});

describe('moveModule', () => {
  it('上移交换相邻位置', () => {
    const out = moveModule(BUILTIN_MODULES, 'engines', -1);
    expect(out.map((m) => m.id).slice(0, 2)).toEqual(['engines', 'search']);
  });

  it('第一个再上移保持不动', () => {
    const out = moveModule(BUILTIN_MODULES, 'search', -1);
    expect(out.map((m) => m.id)).toEqual(['search', 'engines', 'shortcuts']);
  });

  it('最后一个再下移保持不动', () => {
    const out = moveModule(BUILTIN_MODULES, 'shortcuts', 1);
    expect(out.map((m) => m.id)).toEqual(['search', 'engines', 'shortcuts']);
  });

  it('id 不存在时原样返回', () => {
    const out = moveModule(BUILTIN_MODULES, 'nope', 1);
    expect(out.map((m) => m.id)).toEqual(['search', 'engines', 'shortcuts']);
  });

  it('移动后 order 连续', () => {
    const out = moveModule(BUILTIN_MODULES, 'shortcuts', -1);
    expect(out.map((m) => m.order)).toEqual([0, 1, 2]);
  });
});

describe('网格几何', () => {
  const rect = (col: number, row: number, span: number) => ({
    col,
    row,
    span,
    height: 1,
  });

  it('同行相邻不重叠', () => {
    expect(overlaps(rect(1, 1, 6), rect(7, 1, 6))).toBe(false);
  });

  it('同行相交重叠', () => {
    expect(overlaps(rect(1, 1, 6), rect(4, 1, 6))).toBe(true);
  });

  it('不同行不重叠', () => {
    expect(overlaps(rect(1, 1, 12), rect(1, 2, 12))).toBe(false);
  });

  it('识别越界', () => {
    expect(isOutOfBounds(rect(1, 1, 12))).toBe(false);
    expect(isOutOfBounds(rect(2, 1, 12))).toBe(true);
    expect(isOutOfBounds(rect(0, 1, 3))).toBe(true);
    expect(isOutOfBounds(rect(1, 0, 3))).toBe(true);
  });

  it('clampColumn 保证不溢出右边界', () => {
    expect(clampColumn(12, 6)).toBe(7);
    expect(clampColumn(-3, 4)).toBe(1);
    expect(clampColumn(3, 4)).toBe(3);
  });
});

describe('validatePlacement', () => {
  const original: GridPlacement = { moduleId: 'a', col: 1, span: 6, row: 1 };
  const others: GridPlacement[] = [
    { moduleId: 'b', col: 7, span: 6, row: 1 },
  ];

  it('合法位置通过', () => {
    const res = validatePlacement(
      { moduleId: 'a', col: 1, span: 6, row: 2 },
      others,
      original,
    );
    expect(res.ok).toBe(true);
  });

  it('重叠时拒绝并回退到原位置', () => {
    const res = validatePlacement(
      { moduleId: 'a', col: 4, span: 6, row: 1 },
      others,
      original,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('overlap');
      expect(res.fallback).toEqual(original);
    }
  });

  it('越界时拒绝', () => {
    const res = validatePlacement(
      { moduleId: 'a', col: 9, span: 6, row: 1 },
      others,
      original,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('out-of-bounds');
  });

  it('不与自身比较', () => {
    const res = validatePlacement(original, [original], original);
    expect(res.ok).toBe(true);
  });
});

describe('findFreeSlot', () => {
  it('空网格放在第一行第一列', () => {
    const slot = findFreeSlot(6, []);
    expect(slot).toMatchObject({ col: 1, row: 1, span: 6 });
  });

  it('跳过被占用的位置', () => {
    const slot = findFreeSlot(6, [
      { moduleId: 'a', col: 1, span: 6, row: 1 },
    ]);
    expect(slot.col).toBe(7);
    expect(slot.row).toBe(1);
  });

  it('当前行放不下时换行', () => {
    const occupied: GridPlacement[] = [
      { moduleId: 'a', col: 1, span: 8, row: 1 },
      { moduleId: 'b', col: 9, span: 4, row: 1 },
    ];
    const slot = findFreeSlot(12, occupied);
    expect(slot.row).toBe(2);
    expect(slot.col).toBe(1);
  });

  it('span 超过 12 列时夹到 12', () => {
    expect(findFreeSlot(99, []).span).toBe(GRID_COLUMNS);
  });
});

describe('initialGrid', () => {
  it('为每个可见模块铺满整行', () => {
    const grid = initialGrid(BUILTIN_MODULES);
    expect(grid).toHaveLength(3);
    expect(grid.every((p) => p.span === GRID_COLUMNS)).toBe(true);
    expect(grid.map((p) => p.row)).toEqual([1, 2, 3]);
  });

  it('隐藏模块不进初始布局', () => {
    const modules: ModuleConfig[] = [
      { id: 'a', type: 'search', visible: false, order: 0 },
      { id: 'b', type: 'engines', visible: true, order: 1 },
    ];
    expect(initialGrid(modules).map((p) => p.moduleId)).toEqual(['b']);
  });
});

describe('撤销 / 重做历史', () => {
  it('初始状态不能撤销或重做', () => {
    const h = createHistory(['a']);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('push 后可撤销', () => {
    let h = createHistory(['a']);
    h = pushHistory(h, ['b']);
    expect(canUndo(h)).toBe(true);
    expect(h.present).toEqual(['b']);
  });

  it('push 相同引用不产生新历史', () => {
    const arr = ['a'];
    const h = createHistory(arr);
    expect(pushHistory(h, arr)).toBe(h);
  });

  it('撤销回到上一状态', () => {
    let h = createHistory(['a']);
    h = pushHistory(h, ['b']);
    h = undoHistory(h);
    expect(h.present).toEqual(['a']);
    expect(canRedo(h)).toBe(true);
  });

  it('重做恢复被撤销的状态', () => {
    let h = createHistory(['a']);
    h = pushHistory(h, ['b']);
    h = undoHistory(h);
    h = redoHistory(h);
    expect(h.present).toEqual(['b']);
  });

  it('撤销后再 push 会清空重做栈', () => {
    let h = createHistory(['a']);
    h = pushHistory(h, ['b']);
    h = undoHistory(h);
    h = pushHistory(h, ['c']);
    expect(canRedo(h)).toBe(false);
  });

  it('空历史撤销是安全的空操作', () => {
    const h = createHistory(['a']);
    expect(undoHistory(h)).toBe(h);
    expect(redoHistory(h)).toBe(h);
  });
});

describe('arrayMove', () => {
  it('向后移动', () => {
    expect(arrayMove([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  });

  it('向前移动', () => {
    expect(arrayMove([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
  });

  it('越界来源原样返回', () => {
    expect(arrayMove([1, 2], 9, 0)).toEqual([1, 2]);
  });
});
