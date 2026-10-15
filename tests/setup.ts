/**
 * Vitest 全局准备
 *
 * 显式引入 fake-indexeddb，让 lib/indexeddb.ts 在 Node 下可测。
 * chrome API 不 mock —— storage.ts / bookmarks.ts 都有内存回退路径，
 * 正好顺带验证降级逻辑本身是否正确。
 */
import 'fake-indexeddb/auto';

// jsdom 没有 matchMedia，某些模块初始化会读它
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom 没有 createObjectURL
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
}

// 测试里 performance.now 可能不存在
if (typeof performance === 'undefined') {
  // @ts-expect-error 测试环境补丁
  globalThis.performance = { now: () => Date.now() };
}
