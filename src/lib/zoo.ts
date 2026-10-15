/**
 * Svelte 5 与 Zustand 的连接层
 *
 * Svelte 5 用 runes（$state / $derived / $effect）做响应式。
 * Zustand 是外部可变对象，需要显式订阅 + $state 赋值才能被追踪。
 * 这里把「订阅 → 写入 $state」的样板收敛成一个函数。
 *
 * 用法（组件内）：
 *   const s = zoo(settingsStore);          // s() 返回快照，响应式
 *   const theme = $derived($state.snapshot ?? ...)
 */
import { type StoreApi } from 'zustand/vanilla';

/**
 * 订阅一个 zustand store，返回一个「读取器」。
 *
 * 关键点：每次 store 变化都会通知，读取器内部持有最新快照。
 * 组件应在 $derived 中调用读取器，从而建立依赖。
 *
 * 返回的对象同时实现了 subscribe 协议，可直接给 $state 用。
 */
export function zoo<T>(api: StoreApi<T>): {
  /** 取当前快照 */
  (): T;
  /** 供 $effect / onMount 里手动订阅，返回解绑函数 */
  subscribe(cb: (value: T) => void): () => void;
  /** 底层 API，用于调用 action */
  readonly actions: () => T;
} {
  const reader = (() => api.getState()) as ReturnType<typeof zoo<T>>;
  (reader as { subscribe: unknown }).subscribe = (cb: (v: T) => void) => {
    cb(api.getState());
    return api.subscribe((state) => cb(state));
  };
  (reader as { actions: unknown }).actions = () => api.getState();
  return reader;
}

/**
 * 选择一个切片并订阅变化。
 * 相比 zoo() 全量订阅，这里只在该切片「引用变化」时触发回调。
 */
export function useSlice<T, R>(
  api: StoreApi<T>,
  selector: (state: T) => R,
): { subscribe: (cb: (v: R) => void) => () => void; get: () => R } {
  let last = selector(api.getState());
  return {
    get: () => selector(api.getState()),
    subscribe(cb) {
      cb(last);
      return api.subscribe((state) => {
        const next = selector(state);
        if (Object.is(next, last)) return;
        last = next;
        cb(next);
      });
    },
  };
}

/**
 * `$state` 版：把 store 快照同步进组件本地状态。
 * 必须在组件初始化作用域内调用（内部会 onMount/onDestroy）。
 */
export function bindStore<T>(api: StoreApi<T>, set: (value: T) => void): () => void {
  set(api.getState());
  return api.subscribe((state) => set(state));
}

export type { StoreApi };
