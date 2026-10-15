/**
 * 新标签页入口
 *
 * 加载策略（对应性能预算：首屏 < 300ms）：
 *   1. 同步挂载 App —— 骨架立刻可见，不等任何异步数据
 *   2. 异步 bootStores() 填充真实数据并应用主题
 *   3. 收藏夹延后到空闲时段预热，不参与首屏
 */
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import '../../assets/styles/global.css';
import { bootStores, warmBookmarks } from '../../stores';
import { settingsStore } from '../../stores/settings';
import {
  applyColorsToRoot,
  applyGlassBlurToRoot,
  applyModuleOffsetsToRoot,
  applyRadiusToRoot,
  applyThemeClass,
  watchSystemTheme,
} from '../../lib/theme';
import { STORAGE_PREFIX } from '../../lib/defaults';

const mark = (name: string) => {
  performance.mark(`sp:${name}`);
};

mark('script-start');

const target = document.getElementById('app');
if (!target) throw new Error('未找到 #app 挂载点');

const app = mount(App, { target });
mark('mounted');

// ── 主题：先跟随系统，数据就绪后按用户偏好接管 ──

const stopSystemWatch = watchSystemTheme((prefersDark) => {
  const state = settingsStore.getState();
  state.setPrefersDark(prefersDark);
  const { resolvedTheme, colors } = settingsStore.getState();
  applyThemeClass(resolvedTheme);
  applyColorsToRoot(colors);
  applyRadiusToRoot(state.settings.uiRadiusScale);
  applyGlassBlurToRoot(state.settings.uiGlassBlur);
  applyModuleOffsetsToRoot(
    state.settings.searchOffset,
    state.settings.shortcutsOffset,
  );
  cacheTheme(state.settings.theme, resolvedTheme);
});

function cacheTheme(mode: string, resolved: 'light' | 'dark'): void {
  // 供 index.html 内联脚本读取，消除下次打开的闪白
  try {
    localStorage.setItem(`${STORAGE_PREFIX}theme-cache`, mode);
    localStorage.setItem(`${STORAGE_PREFIX}theme-resolved`, resolved);
  } catch {
    /* 忽略 */
  }
}

// 主题变化时同步 DOM
settingsStore.subscribe((state) => {
  if (!state.ready) return;
  applyThemeClass(state.resolvedTheme);
  applyColorsToRoot(state.colors);
  applyRadiusToRoot(state.settings.uiRadiusScale);
  applyGlassBlurToRoot(state.settings.uiGlassBlur);
  applyModuleOffsetsToRoot(
    state.settings.searchOffset,
    state.settings.shortcutsOffset,
  );
  cacheTheme(state.settings.theme, state.resolvedTheme);
});

// ── 启动 ──

void (async () => {
  const result = await bootStores();
  mark('booted');

  if (import.meta.env.DEV) {
    console.info('[起始页] 启动完成', result.timings, {
      失败阶段: result.failed,
    });
  }

  // 首屏指标：mounted → booted 的耗时
  try {
    performance.measure('sp:first-paint', 'sp:script-start', 'sp:booted');
  } catch {
    /* 忽略 */
  }

  // 收藏夹不阻塞首屏，等浏览器空闲再预热
  const idle =
    (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 400));
  idle(() => void warmBookmarks());
})();

// 开发热更新时清理
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopSystemWatch();
    void unmount(app);
  });
}
