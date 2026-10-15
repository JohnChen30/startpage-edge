/**
 * 内置默认值 —— 配色、壁纸、模块、引擎、预设布局
 */
import type {
  ColorConfig,
  LayoutState,
  ModuleConfig,
  ModuleOffsetKey,
  ResolvedTheme,
  SearchEngine,
  Settings,
  ThemePalette,
  WallpaperConfig,
} from '../types';

// ── 配色 ────────────────────────────────────────────────────

export const LIGHT_COLORS: ColorConfig = {
  bg: '#f6f7f9',
  text: '#16181d',
  textSecondary: 'rgba(22, 24, 29, 0.52)',
  accent: '#2f6bff',
  line: 'rgba(22, 24, 29, 0.26)',
  lineHighlight: 'rgba(255, 255, 255, 0.95)',
  shadow: 'rgba(22, 24, 29, 0.16)',
  glassBg: 'rgba(255, 255, 255, 0.66)',
  glassBorder: 'rgba(255, 255, 255, 0.85)',
};

export const DARK_COLORS: ColorConfig = {
  bg: '#0d0f14',
  text: '#f2f4f8',
  textSecondary: 'rgba(242, 244, 248, 0.54)',
  accent: '#6f9dff',
  line: 'rgba(242, 244, 248, 0.28)',
  lineHighlight: 'rgba(255, 255, 255, 0.72)',
  shadow: 'rgba(0, 0, 0, 0.55)',
  glassBg: 'rgba(22, 26, 34, 0.68)',
  glassBorder: 'rgba(255, 255, 255, 0.12)',
};

export const DEFAULT_PALETTE: ThemePalette = {
  light: LIGHT_COLORS,
  dark: DARK_COLORS,
};

/** 按主题解析出最终配色，允许用户部分覆盖 */
export function resolveColors(
  theme: ResolvedTheme,
  overrides?: Partial<Record<ResolvedTheme, Partial<ColorConfig>>>,
): ColorConfig {
  return { ...DEFAULT_PALETTE[theme], ...(overrides?.[theme] ?? {}) };
}

// ── 壁纸 ────────────────────────────────────────────────────

export const DEFAULT_WALLPAPER: WallpaperConfig = {
  // 默认用必应每日壁纸：新标签页第一眼就有内容，而不是一块纯色
  type: 'bing',
  color: '#0d0f14',
  blur: 0,
  brightness: 100,
  maskOpacity: 0,
};

// ── 搜索引擎 ────────────────────────────────────────────────

/**
 * 远程 Logo 地址。
 *
 * ⚠️ 这里**不用** Google 的 `s2/favicons`：该域名在大陆直连会超时，
 * 正是「Logo 一直显示不出来、只剩首字母」的真正原因。
 * 改用 favicon.im —— Cloudflare 边缘节点，大陆可直连，
 * 且 `larger=true` 会返回网站原图（最高 256px），满足高分辨率需求。
 *
 * 取不到时由 EngineBar 逐级回退：同名内置品牌图形 → 名称首字母，
 * 因此断网或接口异常都不会出现破图。
 */
export const faviconApiUrl = (domain: string): string =>
  `https://a.favicon.im/${domain}?larger=true`;

/** 内置引擎。icon 为内置 SVG key、IndexedDB ref 或 http(s) 远程地址。 */
export const BUILTIN_ENGINES: SearchEngine[] = [
  {
    id: 'bing',
    name: '必应',
    urlTemplate: 'https://www.bing.com/search?q=%s',
    icon: 'bing',
    builtin: true,
    order: 0,
  },
  {
    id: 'google',
    name: '谷歌',
    urlTemplate: 'https://www.google.com/search?q=%s',
    icon: 'google',
    builtin: true,
    order: 1,
  },
  {
    id: 'baidu',
    name: '百度',
    urlTemplate: 'https://www.baidu.com/s?wd=%s',
    icon: 'baidu',
    builtin: true,
    order: 2,
  },
  // ── AI 对话引擎 ──
  // 带参直达：autosend=1 立即发送 / search=1 联网 / thinking=1 深度思考。
  // Logo 走 favicon.im（大陆可直连），取不到时回退到 icons.ts 里的内置品牌图形。
  {
    id: 'deepseek',
    name: 'DeepSeek',
    urlTemplate: 'https://chat.deepseek.com/?q=%s&autosend=1&search=1&thinking=1',
    icon: faviconApiUrl('deepseek.com'),
    builtin: true,
    order: 3,
  },
  {
    id: 'qwen',
    name: '千问',
    urlTemplate: 'https://www.qianwen.com/?q=%s',
    icon: faviconApiUrl('qianwen.com'),
    builtin: true,
    order: 4,
  },
  // ── 视频类站点 ──
  {
    id: 'bilibili',
    name: 'B站',
    urlTemplate: 'https://search.bilibili.com/all?keyword=%s',
    icon: faviconApiUrl('bilibili.com'),
    builtin: true,
    order: 5,
  },
  {
    id: 'youtube',
    name: '油管',
    urlTemplate: 'https://www.youtube.com/results?search_query=%s',
    icon: faviconApiUrl('youtube.com'),
    builtin: true,
    order: 6,
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    urlTemplate: 'https://www.xiaohongshu.com/search_result?keyword=%s',
    icon: faviconApiUrl('xiaohongshu.com'),
    builtin: true,
    order: 7,
  },
];

export const DEFAULT_ENGINE_ID = 'bing';

/**
 * 内置引擎表的版本号。
 *
 * 老用户的引擎列表存在 chrome.storage 里，读取时只要格式合法就会原样采用，
 * 因此**改动 BUILTIN_ENGINES 不会自动生效** —— 无论是新增引擎、
 * 改已有引擎的 URL / Logo，还是**下线某个内置引擎**。
 *
 * 每次动 BUILTIN_ENGINES 就把这个数字 +1，
 * stores/engines.ts 的 init() 会据此把新定义同步过去：
 *   · 已存在的内置引擎 → 刷新 urlTemplate 与 icon（保留用户改过的名称与排序）；
 *   · 列表中缺失的内置引擎 → 追加；
 *   · 代码里已下线的内置引擎 → 从用户列表里移除；
 *   · 用户自建的引擎 → 完全不动。
 *
 * v2：新增 DeepSeek / 豆包 / 千问。
 * v3：修正三家 AI 引擎的 URL 模板，Logo 改为远程 Favicon。
 * v4：下线豆包与千问；DeepSeek 的 Logo 图源换成大陆可直连的 favicon.im。
 * v5：下线 Yandex 与神马，恢复千问（Logo 同样走 favicon.im）。
 * v6：新增 B站 / 油管两个视频搜索引擎（普通搜索引擎，不提供以图搜图能力）。
 * v7：新增小红书搜索（普通搜索引擎）。
 *
 * ⚠️ 与 types 里的 SCHEMA_VERSION 是两回事：那个管导入导出文件格式，别混用。
 */
export const BUILTIN_ENGINE_SYNC_VERSION = 7;

/** UI 允许的引擎数量区间 */
export const ENGINE_LIMITS = { min: 1, max: 12 } as const;

// ── 模块 ────────────────────────────────────────────────────

export const BUILTIN_MODULES: ModuleConfig[] = [
  { id: 'search', type: 'search', visible: true, order: 0 },
  { id: 'engines', type: 'engines', visible: true, order: 1 },
  { id: 'shortcuts', type: 'shortcuts', visible: true, order: 2 },
];

export const MODULE_META: Record<
  ModuleConfig['type'],
  { label: string; description: string }
> = {
  search: { label: '搜索框', description: '与引擎栏同处一块毛玻璃面板' },
  engines: { label: '搜索引擎栏', description: '嵌在搜索面板内的引擎切换' },
  shortcuts: { label: '快捷方式区', description: '快捷方式网格与收藏夹入口' },
};

// ── 布局 ────────────────────────────────────────────────────

export const PRESET_LAYOUTS: Record<
  LayoutState['preset'],
  { label: string; description: string }
> = {
  center: { label: '居中', description: '所有模块水平居中，经典起始页' },
  left: { label: '左对齐', description: '模块靠左，留出右侧留白' },
  'two-column': { label: '两栏', description: '搜索区单栏，快捷方式独立成栏' },
};

export const DEFAULT_LAYOUT: LayoutState = {
  preset: 'center',
  grid: [],
};

// ── 快捷方式 ────────────────────────────────────────────────

export const SHORTCUT_LIMITS = {
  /** 网格最多展示的快捷方式数量 */
  max: 24,
  /** 名字长度上限 */
  nameMaxLength: 32,
} as const;

/**
 * 快捷方式尺寸区间。
 * 早先是 sm/md/lg 三档下拉，现在改为滑块无极调节，
 * 因此这里给出的是「可调范围 + 默认值 + 步长」，由设置面板直接消费。
 */
export const SHORTCUT_SIZE_RANGE = {
  min: 36,
  max: 96,
  step: 2,
  default: 56,
} as const;

/** 把任意输入夹到合法尺寸 */
export function clampShortcutSize(v: number): number {
  if (!Number.isFinite(v)) return SHORTCUT_SIZE_RANGE.default;
  const { min, max } = SHORTCUT_SIZE_RANGE;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * 全局圆角缩放区间。
 * 以 1 为基准（对应 global.css 里的 --radius-* 默认值），
 * 滑块把系数写进 --radius-scale，各半径变量都用 calc(基准 * var(--radius-scale))
 * 计算，因此调一处即可统一搜索卡片 / 快捷方式 / 毛玻璃浮层的圆角。
 */
export const UI_RADIUS_RANGE = {
  min: 0,
  max: 2,
  step: 0.05,
  default: 1,
} as const;

/** 把任意输入夹到合法圆角系数 */
export function clampUiRadiusScale(v: number): number {
  if (!Number.isFinite(v)) return UI_RADIUS_RANGE.default;
  const { min, max } = UI_RADIUS_RANGE;
  // 保留两位小数，避免滑块浮点误差累积后写进 CSS 变成一长串
  return Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
}

/**
 * 全局毛玻璃模糊度区间（单位 px）。
 *
 * 一个滑块驱动**一个** CSS 变量 --glass-blur，快捷方式小方块 / 搜索卡片 /
 * 弹窗 / 抽屉 / 搜索下拉全部从它取值 —— 材质口径统一，拖一次全体一起变。
 * 默认 18px，正是 global.css 里写死的出厂基准，所以「什么都没调」和旧版本观感一致。
 * min 给到 0：允许把毛玻璃关成纯半透明面板，这是用户合法的选择。
 */
export const UI_GLASS_BLUR_RANGE = {
  min: 0,
  max: 40,
  step: 1,
  default: 18,
} as const;

/** 把任意输入夹到合法模糊度（px，取整） */
export function clampUiGlassBlur(v: number): number {
  if (!Number.isFinite(v)) return UI_GLASS_BLUR_RANGE.default;
  const { min, max } = UI_GLASS_BLUR_RANGE;
  return Math.round(Math.min(max, Math.max(min, v)));
}

/** 滑块拉满时，玻璃底色**额外**叠的白色（百分比） */
export const GLASS_MILK_MAX = 20;

/**
 * 由模糊度派生的「奶感」（叠在玻璃底色上的白色百分比）。
 *
 * 为什么需要它：backdrop-filter 只对**有细节**的背景有效。
 * 壁纸本身很平的时候（雾气森林 / 天空 / 大面积虚化这类照片），
 * blur 从 0 拉到 40 画面几乎一模一样，滑块看起来就像失灵了。
 * 让底色跟着滑块一起变厚 —— 模糊越深、磨砂越"奶" ——
 * 于是「毛玻璃」在任何壁纸上都看得出来，0 时仍是最通透的样子。
 */
export function glassMilk(blur: number): number {
  const safe = clampUiGlassBlur(blur);
  const ratio = safe / UI_GLASS_BLUR_RANGE.max;
  return Math.round(ratio * GLASS_MILK_MAX);
}

/**
 * 单个模块的纵向偏移区间（px，正数向下）。
 *
 * 用「只挪视觉、不改布局」的方式实现（App.svelte 里是 position: relative + top）：
 * 移动搜索卡片时快捷方式区不会跟着动 —— 这才是「每个模块各调各的」的真实语义。
 * 代价是往下 / 往上调过头时两个模块会重叠，这是模块独立定位的固有结果；
 * 想要严格不重叠就用「布局」里的预设（居中 / 左对齐 / 两栏）。
 *
 * 范围 ±240px：足够把搜索框从垂直中部推到明显偏上或偏下的位置，
 * 又不至于一拖就飞出屏幕。
 */
export const MODULE_OFFSET_RANGE = {
  min: -240,
  max: 240,
  step: 2,
  default: 0,
} as const;

/** 把任意输入夹到合法模块偏移量（px，取整） */
export function clampModuleOffset(v: number): number {
  if (!Number.isFinite(v)) return MODULE_OFFSET_RANGE.default;
  const { min, max } = MODULE_OFFSET_RANGE;
  return Math.round(Math.min(max, Math.max(min, v)));
}

/**
 * 可以单独调纵向偏移的模块。
 *
 * 为什么不是 MODULE_META 里的三项（搜索框 / 搜索引擎栏 / 快捷方式区）：
 * 前两者按设计**共用同一张玻璃面板**（见 MODULE_META 的描述），
 * 单独挪其中一个会让输入框越过卡片内的分隔线、引擎栏浮到卡片外面，
 * 那是把「一张卡」拆坏的观感。所以这里以**页面上真正独立成块的模块**为单位。
 * 每个 key 同时就是 Settings 上的字段名，省一层映射。
 */
export const OFFSET_MODULES: {
  key: ModuleOffsetKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'searchOffset',
    label: '搜索卡片',
    description: '搜索框与下方的引擎栏会作为一组整体一起移动',
  },
  {
    key: 'shortcutsOffset',
    label: '快捷方式区',
    description: '快捷方式网格与收藏夹入口',
  },
];

// ── 图片处理 ────────────────────────────────────────────────

export const IMAGE_RULES = {
  maxBytes: 5 * 1024 * 1024,
  accept: ['image/jpeg', 'image/png', 'image/webp'],
  /** 等比缩放至最长边不超过该值 */
  maxEdge: 2560,
} as const;

// ── 默认设置 ────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  colors: {},
  wallpaper: DEFAULT_WALLPAPER,
  modules: BUILTIN_MODULES,
  defaultEngineId: DEFAULT_ENGINE_ID,
  layout: DEFAULT_LAYOUT,
  shortcutSize: SHORTCUT_SIZE_RANGE.default,
  shortcutShowNames: true,
  uiRadiusScale: UI_RADIUS_RANGE.default,
  uiGlassBlur: UI_GLASS_BLUR_RANGE.default,
  searchOffset: MODULE_OFFSET_RANGE.default,
  shortcutsOffset: MODULE_OFFSET_RANGE.default,
  suggestEnabled: true,
  suggestDebounce: 180,
};

/** 推荐下拉条数上限 */
export const SUGGEST_LIMITS = {
  bookmark: 3,
  search: 2,
  total: 5,
} as const;

/** 存储键前缀，统一为 `sp:` */
export const STORAGE_PREFIX = 'sp:';

/** 默认分区 id 与名称。旧快捷方式（无 sectionId）全部归入此分区。 */
export const DEFAULT_SECTION_ID = 'default';
export const DEFAULT_SECTION_NAME = '默认分区';

export const STORAGE_KEYS = {
  settings: `${STORAGE_PREFIX}settings`,
  engines: `${STORAGE_PREFIX}engines`,
  /** 已同步到的内置引擎表版本，见 BUILTIN_ENGINE_SYNC_VERSION */
  builtinEngines: `${STORAGE_PREFIX}builtinEngines`,
  shortcuts: `${STORAGE_PREFIX}shortcuts`,
  /** 快捷方式分区列表（独立存储，便于单独管理） */
  sections: `${STORAGE_PREFIX}sections`,
  modules: `${STORAGE_PREFIX}modules`,
  layout: `${STORAGE_PREFIX}layout`,
  /** 必应壁纸列表的本地缓存快照（带 fetchedAt），见 lib/bing.ts */
  bingWallpapers: `${STORAGE_PREFIX}bingWallpapers`,
  schemaVersion: `${STORAGE_PREFIX}schemaVersion`,
} as const;

/** 同步存储的体积关注阈值（单键 8KB 软上限） */
export const SYNC_QUOTA_WARN_BYTES = 8 * 1024;
export const LOCAL_QUOTA_WARN_BYTES = 5 * 1024 * 1024;
