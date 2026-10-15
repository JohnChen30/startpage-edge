/**
 * 主题与 CSS 变量
 *
 * 所有配色通过 CSS 变量下发，避免组件各写各的颜色。
 * 需求约定的变量：--bg --text --text-secondary --accent --line
 *                 --line-highlight --shadow --glass-bg --glass-border
 */
import {
  DEFAULT_PALETTE,
  clampModuleOffset,
  clampUiGlassBlur,
  glassMilk,
  resolveColors,
} from './defaults';
import type { ColorConfig, ResolvedTheme, ThemeMode } from '../types';

export const CSS_VARS: Record<keyof ColorConfig, string> = {
  bg: '--bg',
  text: '--text',
  textSecondary: '--text-secondary',
  accent: '--accent',
  line: '--line',
  lineHighlight: '--line-highlight',
  shadow: '--shadow',
  glassBg: '--glass-bg',
  glassBorder: '--glass-border',
};

/** 其它非配色的全局变量 */
export const RUNTIME_VARS = {
  wallpaperBlur: '--wallpaper-blur',
  wallpaperBrightness: '--wallpaper-brightness',
  wallpaperMask: '--wallpaper-mask',
  radiusScale: '--radius-scale',
  glassBlur: '--glass-blur',
  glassMilk: '--glass-milk',
  searchOffset: '--search-offset',
  shortcutsOffset: '--shortcuts-offset',
} as const;

export function toCssVarName(key: keyof ColorConfig): string {
  return CSS_VARS[key];
}

/** 把一份配色转成 CSS 变量声明对象 */
export function colorsToStyle(colors: ColorConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    out[CSS_VARS[key as keyof ColorConfig]] = value;
  }
  return out;
}

/** 把配色对象序列化成 inline style 字符串，用于 SSR / 首屏内联 */
export function colorsToCssText(colors: ColorConfig): string {
  return Object.entries(colors)
    .map(([key, value]) => `${CSS_VARS[key as keyof ColorConfig]}:${value}`)
    .join(';');
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/** 跟随系统主题并返回取消订阅函数 */
export function watchSystemTheme(cb: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent | MediaQueryList) => cb(e.matches);
  handler(mql);
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}

/**
 * 把变量写到 :root。
 * 只更新变化的字段，减少样式重算。
 *
 * 同时派生四个「材质色」：
 *   · --flex-edge        玻璃材质的高光边色（搜索框立体线条的受光面）
 *   · --glass-frost      毛玻璃过渡层的底色
 *   · --glass-bg-strong  比主体玻璃更实一档，供压住下层内容的浮层使用
 *   · --glass-surface    玻璃面板底色（深色半透明黑 / 浅色半透明白）
 * 它们不是用户可配项，而是从当前主题推导出来的，
 * 这样用户自定义配色后，玻璃质感依然跟得上，不会串成深色主题的亮边。
 */
export function applyColorsToRoot(
  colors: ColorConfig,
  root: HTMLElement = document.documentElement,
): void {
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(CSS_VARS[key as keyof ColorConfig], value);
  }
  const isDark = isDarkColor(colors.bg);
  root.style.setProperty(
    '--flex-edge',
    isDark ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.98)',
  );
  root.style.setProperty(
    '--glass-frost',
    isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.16)',
  );
  root.style.setProperty(
    '--glass-bg-strong',
    isDark ? 'rgba(22, 26, 34, 0.9)' : 'rgba(255, 255, 255, 0.92)',
  );
  /**
   * 玻璃面板的底色 —— 深浅模式用不同方向的半透明：
   *   · 深色模式：半透明黑打底，玻璃像「暗色磨砂」
   *   · 浅色模式：半透明白打底，玻璃像「亮色磨砂」
   * 关键是要让面板的明暗方向与背景一致，否则深色主题会出现一块发灰的白玻璃。
   */
  root.style.setProperty(
    '--glass-surface',
    isDark ? 'rgba(14, 16, 21, 0.55)' : 'rgba(255, 255, 255, 0.62)',
  );
}

/**
 * 粗略判断一个 CSS 颜色是否为深色。
 * 只用于决定玻璃高光的明暗方向，不需要精确的色域换算。
 */
function isDarkColor(input: string): boolean {
  const hex = input.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    // rgba() 形式：取前三个数字
    const nums = hex.match(/[\d.]+/g);
    if (nums && nums.length >= 3) {
      const [r, g, b] = nums.map(Number);
      return (r * 299 + g * 587 + b * 114) / 1000 < 128;
    }
    return false;
  }
  let body = m[1];
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  // 亮度加权：人眼对绿最敏感
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export function applyThemeClass(
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/**
 * 下发全局圆角缩放系数。
 * global.css 里每个 --radius-* 都是 `calc(基准值 * var(--radius-scale))`，
 * 所以只写这一个变量，搜索卡片、快捷方式、毛玻璃浮层等圆角会一起变化。
 */
export function applyRadiusToRoot(
  scale: number,
  root: HTMLElement = document.documentElement,
): void {
  const safe = Number.isFinite(scale) ? scale : 1;
  root.style.setProperty(RUNTIME_VARS.radiusScale, String(safe));
}

/**
 * 下发全局毛玻璃模糊度。
 *
 * 只写 **一个** 变量 --glass-blur：快捷方式小方块（.glass-tile）、搜索卡片、
 * 弹窗、抽屉、搜索下拉全部从它取值，所以这一个滑块就是「全部毛玻璃」的总开关 ——
 * 材质口径完全一致，不存在某一处比别处厚一档的差。
 *
 * 同时写 --glass-milk：底色上额外叠的白色百分比，同样由这一个滑块派生
 * （倍率见 defaults.glassMilk）。它只解决「看不出来」的问题 ——
 * 背景本身很平时，blur 再大画面也不变，靠这层奶感才有可感知的变化。
 *
 * 写成具体的 px 而不是 `calc()` 表达式：blur() 里的 <length> 虽然允许 calc，
 * 但直接给算好的值更稳妥，也便于在开发者工具里一眼看出当前生效数值。
 * 没有自己覆盖值的模块会照常从 :root 继承，因此不用逐个改。
 */
export function applyGlassBlurToRoot(
  base: number,
  root: HTMLElement = document.documentElement,
): void {
  const safe = clampUiGlassBlur(base);
  root.style.setProperty(RUNTIME_VARS.glassBlur, `${safe}px`);
  root.style.setProperty(RUNTIME_VARS.glassMilk, `${glassMilk(safe)}%`);
}

/**
 * 下发各模块的纵向偏移量。
 *
 * 写成 :root 上的 px 值（可为负），App.svelte 里的
 * `.search-area / .slot--shortcuts { position: relative; top: var(...) }` 读取它。
 * 搜索那一路挂在 .search-area 上，因此搜索卡片与它下方的引擎栏会一起移动。
 * 一次性下发两个而不是各写一个函数：它们同属「模块位置」这一组设置，
 * 任何一处变化都要保持一致，分开写迟早会漏掉一个。
 * 没有对应覆盖值的其它模块不受影响。
 */
export function applyModuleOffsetsToRoot(
  searchOffset: number,
  shortcutsOffset: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty(
    RUNTIME_VARS.searchOffset,
    `${clampModuleOffset(searchOffset)}px`,
  );
  root.style.setProperty(
    RUNTIME_VARS.shortcutsOffset,
    `${clampModuleOffset(shortcutsOffset)}px`,
  );
}

export { DEFAULT_PALETTE, resolveColors };
