/**
 * Zustand 接入 Svelte 5 的桥
 *
 * 为什么不直接用 zustand 的 React 绑定：项目没有 React。
 * 这里用 zustand/vanilla 创建 store，再补一层 Svelte 5 runes 桥，
 * 让组件里可以直接写 `const s = getSettings(); s.settings.theme`。
 */
import type { StoreApi } from 'zustand/vanilla';
import { readable, type Readable } from 'svelte/store';

export type { StoreApi } from 'zustand/vanilla';
export { useSlice, bindStore, zoo } from '../lib/zoo';

/** 把 zustand 状态暴露为 svelte store，便于在组件里用 `$store` */
export function toSvelteStore<T>(api: StoreApi<T>): Readable<T> {
  return readable(api.getState(), (set) => {
    set(api.getState());
    return api.subscribe((state) => set(state));
  });
}

/** 创建一个带选择器的订阅器 */
export function createSelector<T, R>(
  api: StoreApi<T>,
  selector: (state: T) => R,
): { get: () => R; subscribe: (cb: (v: R) => void) => () => void } {
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
