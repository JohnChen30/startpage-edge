/**
 * 拖拽排序 —— 指针拖拽 + FLIP 弹性让位
 *
 * 覆盖需求：
 *   · 按住图标自由拖动排序（Pointer Events，鼠标 / 触摸 / 触控笔统一处理）
 *   · 被拖拽的图标跟随指针实时移动（只改 transform，不触发 layout）
 *   · 经过其他图标时，其他图标弹性让位（transform + 带轻微回弹的缓动）
 *
 * ── 让位算法：「挪到邻居的坑位」模型 ──
 *   1. 拖拽开始时记录**所有同级项的原始矩形** slots[]；
 *   2. 每次移动用「被拖拽项的中心」当探针，取最近的项下标作为落点 to；
 *   3. from → to 之间（不含被拖拽项）的每一项整体挪一格：
 *        to > from 时，(from, to] 区间内 i → i-1
 *        to < from 时，[to, from) 区间内 i → i+1
 *      位移量直接取 slots[新下标] − slots[旧下标]，所以**会换行的网格也天然正确**，
 *      不需要为「一行几个 / 有没有换行」写任何特判；
 *   4. 松手时先关掉 transition 把 transform 一次性清零，再交给上层重排数据。
 *      两者落在同一帧，因此不会出现「先弹回原位再跳到新位」的闪帧。
 *
 * ── 为什么不用 HTML5 原生 dragstart/dragover ──
 *   原生 DnD 的拖影由浏览器绘制，无法做缩放 / 阴影，也拿不到平滑的跟手效果；
 *   且移动端根本不支持。Pointer Events 一条链路解决全部形态。
 *
 * ── 严格单击 ──
 *   只要按下与抬起之间越过阈值，随后补发的 click 一律被拦掉，
 *   所以「拖完松手」永远不会跳转 / 不会搜索；详见下方 CLICK_SLOP 一段注释。
 */

/** 被拖拽项：抬起态（跟手移动 + 放大） */
const DRAGGING_CLASS = 'is-dragging';
/** 容器：排序进行中（用于给容器加光标等整体状态） */
const SORTING_CLASS = 'is-sorting';
/** 参与排序的同级项标记 */
const ITEM_SELECTOR = '[data-sortable-item]';

export interface SortableOptions {
  /** 同级项容器；返回空值时本次拖拽直接放弃 */
  root: () => HTMLElement | null | undefined;
  /** 松手后把第 from 项挪到第 to 项（下标相等时不会被调用） */
  onDrop: (from: number, to: number) => void;
  /** 判定为拖拽所需的最小位移（px），默认 4。设大一点可以避免误触排序 */
  threshold?: number;
  /** 拖拽时的放大倍数，默认 1.04 */
  scale?: number;
  /** 拖拽开始 / 结束回调，便于上层同步高亮等状态 */
  onDraggingChange?: (dragging: boolean) => void;
}

export interface SortableAction {
  destroy(): void;
}

function centerOf(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 距探针最近的一项；距离相同时取靠前的一项（拖动到等距处不会来回跳） */
function nearestIndex(rects: DOMRect[], x: number, y: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rects.length; i++) {
    const c = centerOf(rects[i]);
    const d = (x - c.x) ** 2 + (y - c.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * ── 「严格单击才跳转」──
 *
 * 一次 pointerdown / pointerup 并不等于一次 click：只要指针在按下与抬起之间动过，
 * 浏览器仍会补发一次 click —— 对「快捷方式」就是误跳转，对「搜索引擎」就是误搜索。
 *
 * 旧的实现是「拖拽成功后临时装一个 350ms 的一次性捕获监听」，有三个漏点：
 *   ① 350ms 可能早于 click 的派发时刻，监听已摘掉；
 *   ② 原地拖拽（松手时 to === from，没有发生换位）压根不会安装；
 *   ③ 越过了阈值、却因为同级项不足 2 个而没进入拖拽态时同样漏。
 *
 * 现在改成常驻的捕获监听 + 两个条件，命中任意一个就吃掉这次 click：
 *   · dragTail —— 本次手势被标记为「拖动过」，且仍在抑制窗口内；
 *   · sloppy   —— 按下点与抬起点相距超过 CLICK_SLOP（阈值之上但没进拖拽态的兜底）。
 * 判定只施加于「指针型」click：键盘触发的 click（Enter / 空格）detail 为 0、没有坐标，
 * 一律放行，否则回车激活会被误伤。
 */
/** 按下点到抬起点超过这个距离，就不再算「单击」（px） */
const CLICK_SLOP = 6;
/**
 * 拖拽结束后抑制 click 的时长（ms）。它只是兜底：下一次 pointerdown 会立刻把标记清掉，
 * 所以「拖完停在同一位置、再点一次想打开」不会被误伤。
 */
const CLICK_SUPPRESS_MS = 400;

export function sortable(node: HTMLElement, options: SortableOptions): SortableAction {
  const threshold = options.threshold ?? 4;
  const scale = options.scale ?? 1.04;

  let items: HTMLElement[] = [];
  let slots: DOMRect[] = [];
  let from = -1;
  let to = -1;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let active = false;
  let dragging = false;
  /** 本次手势是否越过阈值 —— 越过即「不是单击」，与最终有没有换位无关 */
  let gestureDragged = false;
  /** click 抑制截止时刻（performance.now() 基准），0 表示不抑制 */
  let suppressUntil = 0;

  /** 把 transform / 临时样式复位（transition 由调用方控制，见 finish） */
  function resetVisuals() {
    for (const el of items) {
      el.classList.remove(DRAGGING_CLASS);
      el.style.transform = '';
      el.style.zIndex = '';
      el.style.willChange = '';
      el.style.touchAction = '';
    }
    options.root()?.classList.remove(SORTING_CLASS);
  }

  /** 重绘：拖拽项跟手 + 其余项让位 */
  function paint(dx: number, dy: number) {
    node.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;

    // 探针 = 被拖拽项的当前中心（比直接用指针位置更符合直觉）
    const base = slots[from];
    const probeX = base.left + base.width / 2 + dx;
    const probeY = base.top + base.height / 2 + dy;
    const next = nearestIndex(slots, probeX, probeY);

    if (next === to) return;
    to = next;

    for (let i = 0; i < items.length; i++) {
      if (i === from) continue;
      let target = i;
      if (to > from && i > from && i <= to) target = i - 1;
      else if (to < from && i >= to && i < from) target = i + 1;

      const shiftX = slots[target].left - slots[i].left;
      const shiftY = slots[target].top - slots[i].top;
      items[i].style.transform =
        shiftX || shiftY ? `translate3d(${shiftX}px, ${shiftY}px, 0)` : '';
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    // 只响应主键（右键留给右键菜单）
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    active = true;
    dragging = false;
    // 新手势开始：上一轮拖拽留下的抑制标记立刻作废
    gestureDragged = false;
    suppressUntil = 0;
    node.setPointerCapture?.(pointerId);
    // 阻止原生拖拽与文本选中；click 仍会正常派发（由 onClickCapture 做严格单击判定）
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!dragging) {
      if (Math.hypot(dx, dy) < threshold) return;

      // 阈值已越过：这一次按下—抬起确定不是「单击」。先立标记，
      // 即便后面因为同级项不足而放弃拖拽，随后补发的 click 也会被拦掉。
      gestureDragged = true;

      const root = options.root();
      if (!root) return;
      items = [...root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
      if (items.length < 2) return;
      slots = items.map((el) => el.getBoundingClientRect());
      from = items.indexOf(node);
      if (from < 0) return;
      to = from;
      dragging = true;

      root.classList.add(SORTING_CLASS);
      node.classList.add(DRAGGING_CLASS);
      // transform 需要一个定位上下文；本来是 static 的才补 relative，
      // 否则会覆盖组件自己设的 absolute / fixed
      if (getComputedStyle(node).position === 'static') {
        node.style.position = 'relative';
      }
      node.style.zIndex = '30';
      node.style.willChange = 'transform';
      node.style.touchAction = 'none';

      // 被拖拽项必须零延迟跟手
      node.style.transition = 'none';
      // 其余项开启弹性让位：cubic-bezier 末段超过 1 会轻微过冲，就是「弹簧感」
      for (const el of items) {
        if (el === node) continue;
        el.style.transition = 'transform 260ms cubic-bezier(0.22, 1.36, 0.36, 1)';
      }

      options.onDraggingChange?.(true);
    }

    paint(dx, dy);
  };

  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!active || event.pointerId !== pointerId) return;
    active = false;
    node.releasePointerCapture?.(pointerId);
    pointerId = -1;

    // 越过阈值就不是单击：无论最终有没有换位，都要把补发的那次 click 拦掉
    if (gestureDragged) suppressUntil = performance.now() + CLICK_SUPPRESS_MS;

    if (!dragging) return;

    const moved = !cancelled && to >= 0 && to !== from;
    const dropFrom = from;
    const dropTo = to;

    // 1) 先关掉过渡，让下面的「清零」瞬时生效（而不是滑回去）
    for (const el of items) el.style.transition = 'none';
    // 2) 复位所有临时样式
    resetVisuals();
    // 3) 强制回流，把「无过渡归零」这一帧钉死
    void node.offsetWidth;
    // 4) 交还过渡控制权
    for (const el of items) el.style.transition = '';

    dragging = false;
    from = -1;
    to = -1;
    options.onDraggingChange?.(false);

    if (moved) options.onDrop(dropFrom, dropTo);
  };

  const onPointerUp = (event: PointerEvent) => finish(event, false);
  const onPointerCancel = (event: PointerEvent) => finish(event, true);
  /** 原生拖拽（图片 / 链接）会打断 Pointer 流，直接禁掉 */
  const onDragStart = (e: Event) => e.preventDefault();

  /**
   * 严格单击判定。挂在 window 的**捕获阶段**：捕获是从 window 自上而下，
   * 一定早于 Svelte 委托在 document / root 上的冒泡监听，
   * 所以这里 stopImmediatePropagation 能真正掐断上层 onclick。
   */
  const onClickCapture = (event: MouseEvent) => {
    // 键盘激活（Enter / 空格）派发的 click：detail 为 0、坐标为 0，直接放行
    if (event.detail === 0) return;
    if (!(event.target instanceof Node)) return;

    const root = options.root();
    // self：点击落在本项（含其后代）上；fallback：换位导致 DOM 重排后 click 被重定向到容器
    const self = node === event.target || node.contains(event.target);
    const retargeted =
      !self &&
      Boolean(root && (root === event.target || root.contains(event.target)));
    if (!self && !retargeted) return;

    // ① 拖拽尾巴：本次手势越过阈值了，且还在抑制窗口内
    const dragTail = gestureDragged && performance.now() <= suppressUntil;
    // ② 位移兜底：只有确实点在本项上才做位移判定，
    //    否则「根容器里的非可排序元素（如收藏夹入口）」会被别人的陈旧 startX 误伤
    const sloppy =
      self &&
      Math.hypot(event.clientX - startX, event.clientY - startY) > CLICK_SLOP;

    if (!dragTail && !sloppy) return;

    // 只吃一次：标记清空后，用户接下来真正的那次单击照常生效
    gestureDragged = false;
    suppressUntil = 0;
    event.stopPropagation();
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerCancel);
  node.addEventListener('dragstart', onDragStart);
  window.addEventListener('click', onClickCapture, true);

  return {
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerCancel);
      node.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('click', onClickCapture, true);
      // 组件卸载时可能在拖拽中途，顺手复位，避免留下脏样式
      if (dragging) {
        for (const el of items) el.style.transition = 'none';
        resetVisuals();
        for (const el of items) el.style.transition = '';
      }
      items = [];
      slots = [];
    },
  };
}

/**
 * 按「取出一项再插入到目标下标」的语义重排 id 列表。
 * 与 stores 里的 moveTo / reorder 约定一致，避免各组件各写一遍 splice。
 */
export function reorderIds(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
