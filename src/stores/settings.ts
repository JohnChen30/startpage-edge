/**
 * 设置 store —— 主题 / 配色 / 壁纸 / 模块 / 布局 / 默认引擎
 *
 * 数据流：
 *   chrome.storage.onChanged  →  内存 store  →  Svelte 响应式渲染
 * 写入时先乐观更新内存，再落盘；落盘失败回滚并提示。
 */
import { createStore } from 'zustand/vanilla';
import {
  BUILTIN_MODULES,
  DEFAULT_SETTINGS,
  clampModuleOffset,
  clampShortcutSize,
  clampUiGlassBlur,
  clampUiRadiusScale,
  STORAGE_KEYS,
} from '../lib/defaults';
import { readRaw, subscribeKeys, writeRaw, type StorageAreaName } from '../lib/storage';
import { getBingStatus, loadBingImages, pickBingImage, todayStamp } from '../lib/bing';
import {
  assignOrder,
  isModuleArray,
  isSettings,
  migrateSettings,
  reindexOrder,
} from '../lib/validate';
import { moveModule } from '../lib/layout';
import { resolveColors } from '../lib/defaults';
import {
  applyGlassBlurToRoot,
  applyModuleOffsetsToRoot,
  applyRadiusToRoot,
} from '../lib/theme';
import type {
  ColorConfig,
  ModuleConfig,
  ModuleOffsetKey,
  ResolvedTheme,
  Settings,
  ThemeMode,
  WallpaperConfig,
} from '../types';

export interface SettingsState {
  settings: Settings;
  /** 系统是否偏好深色 */
  prefersDark: boolean;
  /** system 解析后的实际主题 */
  resolvedTheme: ResolvedTheme;
  /** 当前生效配色（默认值 + 用户覆盖） */
  colors: ColorConfig;
  /** 是否已完成首次加载（用于避免闪白） */
  ready: boolean;

  init(): Promise<void>;
  setPrefersDark(v: boolean): void;
  setTheme(theme: ThemeMode): Promise<void>;
  patchColors(patch: Partial<ColorConfig>): Promise<void>;
  resetColors(): Promise<void>;
  patchWallpaper(patch: Partial<WallpaperConfig>): Promise<void>;
  /**
   * 必应壁纸的首次落地 / 跨天换新。
   * 幂等：今天已经定过这张就什么都不做，因此可以在每次挂载时无脑调用 ——
   * 这正是「当天新建的标签页保持同一张壁纸」的实现方式。
   */
  ensureBingWallpaper(): Promise<void>;
  /** 随机换一张（离开当前这张），并把定妆日期写成今天，供左下角按钮调用 */
  shuffleBingWallpaper(): Promise<boolean>;
  setDefaultEngine(id: string): Promise<void>;
  /** 快捷方式图标边长（px，滑块无极调节） */
  setShortcutSize(size: number): Promise<void>;
  /** 全局统一开关：是否显示快捷方式名字 */
  setShortcutShowNames(v: boolean): Promise<void>;
  /** 全局圆角缩放系数（0.5–2.0，1 为基准） */
  setUiRadiusScale(scale: number): Promise<void>;
  /** 全局毛玻璃模糊度（px，0–40，默认 18）；搜索卡片按倍率同步放大 */
  setUiGlassBlur(px: number): Promise<void>;
  /** 单个模块的纵向偏移（px，±240，默认 0）；只挪视觉，不动其它模块 */
  setModuleOffset(key: ModuleOffsetKey, px: number): Promise<void>;
  setSuggestEnabled(v: boolean): Promise<void>;
  setSuggestDebounce(ms: number): Promise<void>;
  patchSettings(patch: Partial<Settings>): Promise<void>;
}

function derive(
  settings: Settings,
  prefersDark: boolean,
): Pick<SettingsState, 'resolvedTheme' | 'colors'> {
  const resolvedTheme: ResolvedTheme =
    settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme;
  return { resolvedTheme, colors: resolveColors(resolvedTheme, settings.colors) };
}

/**
 * 一次性迁移：修补历史遗留的壁纸配置。两条规则按顺序判断，命中即返回。
 *
 * ① 出厂纯色配置 → 升级为「必应每日壁纸」
 *    判定条件刻意收得很紧 —— 只有**原封不动的出厂纯色配置**才升级：
 *    类型为 solid、颜色还是默认的 #0d0f14、没有图片引用、没有必应地址、
 *    模糊/亮度/遮罩三个滑块也全是默认值。
 *    只要用户动过其中任何一项（挑过色、导过图、拖过滑块），就完全尊重原设置。
 *    为什么不能只改 DEFAULT_WALLPAPER：老用户的设置在 storage 里是合法的，
 *    读取时会被原样采用，改常量对他们等于没改 —— 这是本项目反复踩过的坑。
 *
 * ② 必应图缺「定妆日期」→ 补记为今天
 *    老版本只存 bingUrl、不存日期。补记之后，升级后第一次开新标签页
 *    不会因为「图片列表换了来源」而把用户当前这张顶掉（见 bingPickedOn 注释）。
 *    注意这里只补日期、不动 bingUrl —— 升级不该让用户眼前这张图跳一下。
 */
function migrateWallpaper(wp: WallpaperConfig): {
  wallpaper: WallpaperConfig;
  changed: boolean;
} {
  const pristine =
    wp.type === 'solid' &&
    wp.color === '#0d0f14' &&
    !wp.imageRef &&
    !wp.bingUrl &&
    wp.blur === 0 &&
    wp.brightness === 100 &&
    wp.maskOpacity === 0;
  if (pristine) {
    return { wallpaper: { ...wp, type: 'bing' }, changed: true };
  }

  if (wp.type === 'bing' && wp.bingUrl && !wp.bingPickedOn) {
    return { wallpaper: { ...wp, bingPickedOn: todayStamp() }, changed: true };
  }

  return { wallpaper: wp, changed: false };
}

/**
 * 等设置真正从 storage 加载完成。
 *
 * 为什么必须有这一步 —— 它修的是一个真实 Bug：
 *   新标签页是「先同步 mount(App)、后异步 bootStores()」（见
 *   entrypoints/newtab/main.ts）。组件挂载的瞬间，store 里还是
 *   DEFAULT_SETTINGS，读出来的是「类型是 bing、但没有 bingUrl」的**假象**。
 *   任何「读当前配置 → 判断 → 写回」的逻辑如果不等这一步，就会拿着默认值
 *   把用户真实的配置冲掉 —— 必应壁纸「换过之后又变回去」就是这么来的。
 *
 * 超时返回 false（调用方应放弃写入，宁可不动也不能写坏数据）：
 *   init() 万一整体失败，ready 永远不会置真，不能把调用方永久挂住。
 */
function whenReady(timeoutMs = 3000): Promise<boolean> {
  if (settingsStore.getState().ready) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let off = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      off();
      resolve(ok);
    };

    off = settingsStore.subscribe((s) => {
      if (s.ready) finish(true);
    });
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

export const settingsStore = createStore<SettingsState>((set, get) => ({
  settings: structuredClone(DEFAULT_SETTINGS),
  prefersDark: false,
  resolvedTheme: 'light',
  colors: resolveColors('light'),
  ready: false,

  async init() {
    const raw = await readRaw<unknown>('sync', STORAGE_KEYS.settings);
    const settings = isSettings(raw)
      ? raw
      : (migrateSettings(raw) ?? structuredClone(DEFAULT_SETTINGS));
    // 模块配置单独存了一份，以模块键为准（设置面板改的是它）
    const rawModules = await readRaw<unknown>('sync', STORAGE_KEYS.modules);
    if (isModuleArray(rawModules) && rawModules.length) {
      settings.modules = reindexOrder(rawModules);
    }
    const prefersDark =
      get().prefersDark ||
      (typeof window !== 'undefined'
        ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        : false);

    // 壁纸配置迁移（出厂纯色 → 必应每日；必应图补记定妆日期）
    const upgraded = migrateWallpaper(settings.wallpaper);
    if (upgraded.changed) settings.wallpaper = upgraded.wallpaper;

    set({ settings, prefersDark, ...derive(settings, prefersDark), ready: true });

    if (upgraded.changed) {
      await writeRaw('sync', STORAGE_KEYS.settings, settings);
    }
  },

  setPrefersDark(v) {
    const { settings } = get();
    set({ prefersDark: v, ...derive(settings, v) });
  },

  async setTheme(theme) {
    const next = { ...get().settings, theme };
    set({ settings: next, ...derive(next, get().prefersDark) });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async patchColors(patch) {
    const prev = get().settings;
    const theme = get().resolvedTheme;
    const next: Settings = {
      ...prev,
      colors: {
        ...prev.colors,
        [theme]: { ...prev.colors?.[theme], ...patch },
      },
    };
    set({ settings: next, ...derive(next, get().prefersDark) });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async resetColors() {
    const next: Settings = { ...get().settings, colors: {} };
    set({ settings: next, ...derive(next, get().prefersDark) });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async patchWallpaper(patch) {
    const next: Settings = {
      ...get().settings,
      wallpaper: { ...get().settings.wallpaper, ...patch },
    };
    set({ settings: next });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  /**
   * 壁纸的「首次落地 / 跨天换新」。每次打开新标签页都会调用，但绝大多数时候
   * 第二步就 return 了 —— 它只在【今天还没定过这张】时才动手。
   *
   * 两条关键约束，缺一不可：
   *   ① 必须先等设置加载完成（whenReady）—— 见 whenReady 的注释；
   *   ② 每个 await 之后都要**重新取**当前配置，不能沿用 await 之前捕获的快照 ——
   *      等待期间用户完全可能刚点完「换一张」。
   * 判断依据也从「当前 URL 还在不在列表里」换成了「今天是否已经定过」：
   * 旧写法会误伤用户的选择（列表有缓存 / 实时 / 离线快照三个来源，
   * 换了来源就可能不含用户选的那张），新写法保证
   * **当天新建多少个标签页都保持同一张，跨天才自动换新**。
   */
  async ensureBingWallpaper() {
    // ① 设置没就绪就什么都别做 —— 否则会把用户的数据冲掉
    if (!(await whenReady())) return;

    // ② 今天已经定过这张（自动选的或用户点选的都算）→ 收工，
    //    连网络请求都不发。这是打开新标签页时的绝大多数情况。
    const before = get().settings.wallpaper;
    if (before.type !== 'bing') return;
    const today = todayStamp();
    if (before.bingUrl && before.bingPickedOn === today) return;

    // ③ 只有真的需要换新时才去取列表
    const images = await loadBingImages();
    if (!images.length) return; // 取不到就沿用现有 bingUrl / 纯色底，不打扰用户

    // ④ 上面这个 await 期间状态可能已经变了 → 重新取一份再判断
    const wp = get().settings.wallpaper;
    if (wp.type !== 'bing') return;
    if (wp.bingUrl && wp.bingPickedOn === today) return;

    // 列表来自构建期的离线快照时，手上已经有一张能显示的图就别换 ——
    // 快照永远是那固定的 8 张旧的，用它替换等于「每天都换回同一天」。
    // 只有连一张图都没有（首次进入、且当时离线）才接受快照里的第一张。
    if (wp.bingUrl && getBingStatus().source === 'builtin') return;

    // 首次进入 / 跨天 → 用列表里最新的一张，并把定妆日期写成今天
    const first = images[0];
    if (!first) return;
    await get().patchWallpaper({ bingUrl: first.url, bingPickedOn: today });
  },

  async shuffleBingWallpaper() {
    // 同理：没就绪就放弃，不能拿默认配置去写 sync
    if (!(await whenReady())) return false;

    const wp = get().settings.wallpaper;
    if (wp.type !== 'bing') return false;

    // 走缓存优先：列表 6 小时内直接复用，点「换一张」是瞬时的；
    // 缓存过期会自动重新拉一次最近 8 天的窗口。
    const images = await loadBingImages();
    const next = pickBingImage(images, wp.bingUrl);
    if (!next) return false;

    // 记上定妆日期：这是「更换过壁纸之后，当天新建的标签页保持更换后的壁纸」
    // 能成立的关键 —— 用户主动选过一次，当天就不允许再被自动逻辑覆盖。
    await get().patchWallpaper({
      bingUrl: next.url,
      bingPickedOn: todayStamp(),
    });
    return true;
  },

  async setDefaultEngine(id) {
    const next = { ...get().settings, defaultEngineId: id };
    set({ settings: next });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async setShortcutSize(shortcutSize) {
    // 滑块可能给出越界值，统一在这里夹正，避免脏数据落盘
    const next = { ...get().settings, shortcutSize: clampShortcutSize(shortcutSize) };
    set({ settings: next });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async setShortcutShowNames(shortcutShowNames) {
    const next = { ...get().settings, shortcutShowNames };
    set({ settings: next });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async setUiRadiusScale(uiRadiusScale) {
    // 滑块越界值统一夹正，避免脏数据落盘
    const scale = clampUiRadiusScale(uiRadiusScale);
    const next = { ...get().settings, uiRadiusScale: scale };
    set({ settings: next });
    // 这里直接写 DOM 变量，而不是只依赖 main.ts 的订阅回调：
    // 保证任何调用方（设置面板 / 布局编辑器 / 未来新入口）都能立即生效。
    applyRadiusToRoot(scale);
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async setUiGlassBlur(uiGlassBlur) {
    // 滑块越界值统一夹正，避免脏数据落盘
    const px = clampUiGlassBlur(uiGlassBlur);
    const next = { ...get().settings, uiGlassBlur: px };
    set({ settings: next });
    // 同 setUiRadiusScale：直接写 DOM 变量，任何调用方都能立即生效，
    // 不必等 main.ts 的订阅回调绕一圈。
    applyGlassBlurToRoot(px);
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async setModuleOffset(key, px) {
    // 滑块越界值统一夹正，避免脏数据落盘
    const value = clampModuleOffset(px);
    const prev = get().settings;
    // 显式分支而不是计算属性名：key 收窄成字面量联合后，
    // 这样写才能让 TS 推断出 {...prev, searchOffset} 仍然是完整的 Settings
    const next: Settings =
      key === 'searchOffset'
        ? { ...prev, searchOffset: value }
        : { ...prev, shortcutsOffset: value };
    set({ settings: next });
    // 两个偏移一起下发：保持 :root 上的变量与设置永远一致
    applyModuleOffsetsToRoot(next.searchOffset, next.shortcutsOffset);
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async setSuggestEnabled(suggestEnabled) {
    const next = { ...get().settings, suggestEnabled };
    set({ settings: next });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async setSuggestDebounce(ms) {
    const clamped = Math.min(250, Math.max(150, Math.round(ms)));
    const next = { ...get().settings, suggestDebounce: clamped };
    set({ settings: next });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },

  async patchSettings(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next, ...derive(next, get().prefersDark) });
    await writeRaw('sync', STORAGE_KEYS.settings, next);
  },
}));

// ── 模块单独一份，便于设置面板与布局编辑复用 ────────────────

export interface ModulesState {
  modules: ModuleConfig[];
  ready: boolean;
  init(): Promise<void>;
  setVisible(id: string, visible: boolean): Promise<void>;
  toggle(id: string): Promise<void>;
  move(id: string, direction: -1 | 1): Promise<void>;
  reorder(orderedIds: string[]): Promise<void>;
  reset(): Promise<void>;
  applyFromStorage(raw: unknown): void;
}

function persist(modules: ModuleConfig[]): Promise<unknown> {
  // 传入数组已是期望顺序（moveModule / reorder 都已按下标赋好 order）
  const normalized = assignOrder(modules);
  return Promise.all([
    writeRaw('sync', STORAGE_KEYS.modules, normalized),
    writeRaw('sync', STORAGE_KEYS.settings, {
      ...settingsStore.getState().settings,
      modules: normalized,
    }),
  ]);
}

export const modulesStore = createStore<ModulesState>((set, get) => ({
  modules: structuredClone(BUILTIN_MODULES),
  ready: false,

  async init() {
    const raw = await readRaw<unknown>('sync', STORAGE_KEYS.modules);
    if (isModuleArray(raw) && raw.length) {
      set({ modules: reindexOrder(raw), ready: true });
      return;
    }
    // 回退到 settings.modules
    const fromSettings = settingsStore.getState().settings.modules;
    set({ modules: reindexOrder(fromSettings ?? BUILTIN_MODULES), ready: true });
  },

  async setVisible(id, visible) {
    const modules = get().modules.map((m) => (m.id === id ? { ...m, visible } : m));
    set({ modules });
    await persist(modules);
  },

  async toggle(id) {
    const target = get().modules.find((m) => m.id === id);
    if (!target) return;
    // 至少保留一个可见模块，否则页面会全空
    if (target.visible && get().modules.filter((m) => m.visible).length <= 1) {
      return;
    }
    await get().setVisible(id, !target.visible);
  },

  async move(id, direction) {
    const modules = moveModule(get().modules, id, direction);
    set({ modules });
    await persist(modules);
  },

  async reorder(orderedIds) {
    const map = new Map(get().modules.map((m) => [m.id, m]));
    const modules = orderedIds
      .map((id, i) => {
        const m = map.get(id);
        return m ? { ...m, order: i } : null;
      })
      .filter((m): m is ModuleConfig => m !== null);
    // 补回未在列表中的模块
    for (const m of get().modules) {
      if (!orderedIds.includes(m.id)) modules.push({ ...m, order: modules.length });
    }
    set({ modules });
    await persist(modules);
  },

  async reset() {
    const modules = structuredClone(BUILTIN_MODULES);
    set({ modules });
    await persist(modules);
  },

  applyFromStorage(raw) {
    if (isModuleArray(raw) && raw.length) {
      set({ modules: reindexOrder(raw) });
    }
  },
}));

// ── 跨窗口同步 ──────────────────────────────────────────────

export function watchSettingsAndModules(): () => void {
  return subscribeKeys(
    [STORAGE_KEYS.settings, STORAGE_KEYS.modules],
    async (_area: StorageAreaName, keys: string[]) => {
      if (keys.includes(STORAGE_KEYS.settings)) {
        const raw = await readRaw<unknown>('sync', STORAGE_KEYS.settings);
        if (isSettings(raw)) {
          const state = settingsStore.getState();
          settingsStore.setState({
            settings: raw,
            ...derive(raw, state.prefersDark),
          });
        }
      }
      if (keys.includes(STORAGE_KEYS.modules)) {
        const raw = await readRaw<unknown>('sync', STORAGE_KEYS.modules);
        modulesStore.getState().applyFromStorage(raw);
      }
    },
  );
}

export { SHORTCUT_SIZE_RANGE } from '../lib/defaults';
