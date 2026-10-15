/**
 * 拖拽计算单测
 *
 * 这里锁定两个容易差一位的地方：
 *   1. arrayMove 的 to 语义（最终下标，非插入点）
 *   2. computeDropIndex 的指针 → 目标下标换算
 */
import { describe, expect, it } from 'vitest';
import { arrayMove, computeDropIndex, snapSpan, snapToColumn } from '../../src/lib/drag';

/** 造一组等宽 40px、间距 0 的矩形，中心点分别为 20 / 60 / 100 / 140 */
function rects(count: number, width = 40, height = 40): DOMRect[] {
  return Array.from({ length: count }, (_, i) => ({
    left: i * width,
    top: 0,
    width,
    height,
    right: (i + 1) * width,
    bottom: height,
    x: i * width,
    y: 0,
    toJSON: () => ({}),
  })) as DOMRect[];
}

describe('arrayMove', () => {
  it('向后移动，to 是最终下标', () => {
    expect(arrayMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(arrayMove(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('向前移动，to 是最终下标', () => {
    expect(arrayMove(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(arrayMove(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('移到相邻位置等价于交换', () => {
    expect(arrayMove(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(arrayMove(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
  });

  it('from === to 时返回原引用，避免无谓重渲染', () => {
    const list = ['a', 'b'];
    expect(arrayMove(list, 1, 1)).toBe(list);
  });

  it('越界时返回原引用', () => {
    const list = ['a', 'b'];
    expect(arrayMove(list, 5, 0)).toBe(list);
    expect(arrayMove(list, 0, 5)).toBe(list);
    expect(arrayMove(list, -1, 0)).toBe(list);
  });

  it('不修改原数组', () => {
    const list = ['a', 'b', 'c'];
    arrayMove(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});

describe('computeDropIndex', () => {
  it('指针在第一个中心点之前 → 插入到 0', () => {
    expect(computeDropIndex(rects(3), 5, 20, 2)).toBe(0);
  });

  it('指针在最后中心点之后 → 落到末位', () => {
    const items = rects(3); // 中心 20 / 60 / 100
    expect(computeDropIndex(items, 200, 20, 0)).toBe(2);
  });

  it('把首项拖到第三项中心之后 → 目标下标 2', () => {
    const items = rects(3);
    expect(computeDropIndex(items, 105, 20, 0)).toBe(2);
  });

  it('把末项拖到第一项中心之前 → 目标下标 0', () => {
    const items = rects(3);
    expect(computeDropIndex(items, 5, 20, 2)).toBe(0);
  });

  it('指针在第二项中心的左侧 → 目标下标 1', () => {
    const items = rects(3);
    expect(computeDropIndex(items, 45, 20, 0)).toBe(1);
  });

  it('单项列表没有可移动空间', () => {
    expect(computeDropIndex(rects(1), 999, 20, 0)).toBe(0);
  });

  it('空列表返回原下标', () => {
    expect(computeDropIndex([], 0, 0, 0)).toBe(0);
  });

  it('纵向模式按 top 计算', () => {
    const items = rects(3);
    expect(computeDropIndex(items, 0, 105, 0, 'y')).toBe(2);
  });
});

describe('网格吸附', () => {
  it('snapToColumn 把像素换算成列号', () => {
    expect(snapToColumn(0, 1200)).toBe(1);
    expect(snapToColumn(100, 1200)).toBe(2);
    expect(snapToColumn(1199, 1200)).toBe(12);
  });

  it('snapToColumn 夹在 1..12', () => {
    expect(snapToColumn(-50, 1200)).toBe(1);
    expect(snapToColumn(99999, 1200)).toBe(12);
  });

  it('容器宽度为 0 时安全返回 1', () => {
    expect(snapToColumn(50, 0)).toBe(1);
  });

  it('snapSpan 按位移换算跨列数', () => {
    // 容器 1200，单列 100px；起点跨 2 列，向右拖 300px → 跨 5 列
    expect(snapSpan(300, 1200, 2)).toBe(5);
    // 向左拖 100px → 跨 1 列
    expect(snapSpan(-100, 1200, 2)).toBe(1);
  });

  it('snapSpan 结果夹在 1..12', () => {
    expect(snapSpan(99999, 1200, 2)).toBe(12);
    expect(snapSpan(-99999, 1200, 2)).toBe(1);
  });
});
