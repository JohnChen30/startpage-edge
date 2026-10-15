/**
 * store 初始化编排
 *
 * 统一入口，保证加载顺序正确：
 *   1. 设置（决定主题 / 配色，必须最先）
 *   2. 模块（依赖设置的 modules 回退）
 *   3. 引擎（依赖设置里默认引擎，且可能反向修正）
 *   4. 快捷方式
 *   5. 布局（依赖模块）
 *   6. 收藏夹（最重，放最后，不阻塞首屏）
 *
 * 每一步都独立 try/catch，任何一步失败都不影响页面打开。
 */
import { settingsStore, modulesStore, watchSettingsAndModules } from './settings';
import { enginesStore, watchEngines } from './engines';
import { shortcutsStore, watchShortcuts } from './shortcuts';
import { sectionsStore, watchSections } from './sections';
import { layoutStore } from './layout';
import { bookmarksStore } from './bookmarks';

let booted = false;
let unwatchers: (() => void)[] = [];

export interface BootResult {
  ok: boolean;
  failed: string[];
  /** 各阶段耗时，用于性能预算核对 */
  timings: Record<string, number>;
}

export async function bootStores(): Promise<BootResult> {
  if (booted) return { ok: true, failed: [], timings: {} };
  booted = true;

  const failed: string[] = [];
  const timings: Record<string, number> = {};

  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = performance.now();
    try {
      await fn();
    } catch (err) {
      console.error(`[boot] ${name} 初始化失败`, err);
      failed.push(name);
    }
    timings[name] = Math.round(performance.now() - t0);
  };

  await step('settings', () => settingsStore.getState().init());
  await step('modules', () => modulesStore.getState().init());
  await step('engines', () => enginesStore.getState().init());
  await step('shortcuts', () => shortcutsStore.getState().init());
  await step('sections', () => sectionsStore.getState().init());
  await step('layout', () => layoutStore.getState().init());

  // 跨窗口同步在设置就绪后立刻挂上，避免用户在其他窗口改设置后本窗口不同步
  unwatchers = [
    watchSettingsAndModules(),
    watchEngines(),
    watchShortcuts(),
    watchSections(),
  ];

  return { ok: failed.length === 0, failed, timings };
}

/** 收藏夹单独延后加载：不阻塞首屏，但弹窗打开前必须就绪 */
export async function warmBookmarks(): Promise<void> {
  try {
    await bookmarksStore.getState().init();
  } catch (err) {
    console.error('[boot] 收藏夹初始化失败', err);
  }
}

export function disposeStores(): void {
  for (const off of unwatchers) off();
  unwatchers = [];
  bookmarksStore.getState().dispose();
  booted = false;
}
