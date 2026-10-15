/**
 * Pointer Events 拖拽 —— 不依赖任何拖拽库
 *
 * 设计要点：
 *   · 统一处理鼠标 / 触摸 / 触控笔（Pointer Events 天然合并）
 *   · 支持指针捕获，指针移出元素也不会丢事件
 *   · 移动阈值避免「点击被误判为拖拽」
 *   · 全程只改 transform，不触发 layout
 */
export interface DragStartEvent {
  /** 起始坐标 */
  startX: number;
  startY: number;
  /** 当前坐标 */
  x: number;
  y: number;
  /** 相对起点的位移 */
  dx: number;
  dy: number;
  /** 原始事件，便于读取 target / modifier */
  event: PointerEvent;
}

export interface DragOptions {
  /** 超过该位移才判定为拖拽（px），默认 4 */
  threshold?: number;
  onStart?: (e: DragStartEvent) => void;
  onMove?: (e: DragStartEvent) => void;
  onEnd?: (e: DragStartEvent & { cancelled: boolean }) => void;
  /** 是否允许纵向移动，默认 true */
  axis?: 'both' | 'x' | 'y';
}

/**
 * 给元素挂上拖拽。返回解绑函数。
 * 用法：`const off = draggable(node, { onMove: ... }); onDestroy(off)`
 */
export function draggable(node: HTMLElement, options: DragOptions): () => void {
  const threshold = options.threshold ?? 4;
  let active = false;
  let moved = false;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;

  const emit = (x: number, y: number, event: PointerEvent): DragStartEvent => {
    let dx = x - startX;
    let dy = y - startY;
    if (options.axis === 'x') dy = 0;
    if (options.axis === 'y') dx = 0;
    return { startX, startY, x, y, dx, dy, event };
  };

  const onPointerDown = (event: PointerEvent) => {
    // 只响应主键（鼠标左键 / 触摸 / 笔）
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    active = true;
    moved = false;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    node.setPointerCapture?.(pointerId);
    // 阻止文本选中与原生拖拽
    event.preventDefault();
    node.style.touchAction = 'none';
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== pointerId) return;
    const payload = emit(event.clientX, event.clientY, event);
    if (!moved) {
      if (Math.hypot(payload.dx, payload.dy) < threshold) return;
      moved = true;
      options.onStart?.(payload);
    }
    options.onMove?.(payload);
  };

  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!active || event.pointerId !== pointerId) return;
    active = false;
    node.releasePointerCapture?.(pointerId);
    node.style.touchAction = '';
    pointerId = -1;
    const payload = { ...emit(event.clientX, event.clientY, event), cancelled };
    options.onEnd?.(payload);
    moved = false;
  };

  const onPointerUp = (event: PointerEvent) => finish(event, false);
  const onPointerCancel = (event: PointerEvent) => finish(event, true);
  const onDragStart = (e: Event) => e.preventDefault();

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerCancel);
  node.addEventListener('dragstart', onDragStart);

  return () => {
    node.removeEventListener('pointerdown', onPointerDown);
    node.removeEventListener('pointermove', onPointerMove);
    node.removeEventListener('pointerup', onPointerUp);
    node.removeEventListener('pointercancel', onPointerCancel);
    node.removeEventListener('dragstart', onDragStart);
  };
}

// ── 列表排序辅助 ────────────────────────────────────────────

/**
 * 计算拖拽后元素应落在哪个索引。
 *
 * 关键点：先把「被拖拽项自己」排除在比较之外，再在剩余项中找第一个
 * 中心点超过指针位置的项 —— 它的位置就是插入点。这样从前往后拖和
 * 从后往前拖的语义一致，不会出现 off-by-one。
 */
export function computeDropIndex(
  itemRects: DOMRect[],
  pointerX: number,
  pointerY: number,
  fromIndex: number,
  axis: 'x' | 'y' = 'x',
): number {
  // 列表只有一项，移动没有意义
  if (itemRects.length <= 1) return fromIndex;

  const pos = axis === 'x' ? pointerX : pointerY;
  const rest: number[] = [];
  for (let i = 0; i < itemRects.length; i++) {
    if (i === fromIndex) continue;
    const r = itemRects[i];
    rest.push(axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2);
  }
  if (!rest.length) return fromIndex;

  // 找到第一个中心点在指针之后的剩余项，插到它前面
  const insertBefore = rest.findIndex((center) => pos < center);
  if (insertBefore < 0) return rest.length; // 落在最后

  // rest 的下标 → 原始下标（跳过自身）
  return insertBefore >= fromIndex ? insertBefore + 1 : insertBefore;
}

/**
 * 把元素从 from 挪到 to。
 *
 * 语义约定：`to` 是元素在 **最终数组** 中的目标下标（绝对位置）。
 *   arrayMove(['a','b','c'], 0, 2) → ['b','c','a']   // 挪到末位
 *   arrayMove(['a','b','c'], 2, 0) → ['c','a','b']   // 挪到首位
 *
 * 注意这里不需要对下标做 ±1 补偿：先把元素摘出来，此时数组长度减一，
 * 再执行 splice(to, 0, item) —— splice 会把 index 钳制到 [0, length]，
 * 于是 `to` 恰好落在最终位置上。曾经尝试过 `to - 1` 的"补偿"，
 * 结果反而把元素插到了倒数第二位（见 tests/unit/drag.test.ts）。
 */
export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length) return list;
  if (to < 0 || to >= list.length) return list;

  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ── 网格吸附 ────────────────────────────────────────────────

/**
 * 把像素坐标吸附到 12 列网格。
 * @param x        相对网格容器左边的像素
 * @param containerWidth 网格容器宽度
 */
export function snapToColumn(x: number, containerWidth: number, columns = 12): number {
  if (containerWidth <= 0) return 1;
  const unit = containerWidth / columns;
  const col = Math.floor(x / unit) + 1;
  return Math.min(columns, Math.max(1, col));
}

export function columnWidth(containerWidth: number, columns = 12): number {
  return containerWidth <= 0 ? 0 : containerWidth / columns;
}

/** 由拖拽横向位移换算跨列数 */
export function snapSpan(
  dx: number,
  containerWidth: number,
  startSpan: number,
  columns = 12,
): number {
  const unit = columnWidth(containerWidth, columns);
  if (unit <= 0) return startSpan;
  const delta = Math.round(dx / unit);
  return Math.min(columns, Math.max(1, startSpan + delta));
}
