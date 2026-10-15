/**
 * 起始页扩展 —— 全局类型定义
 *
 * 分层约定：
 *   Settings   → 轻量偏好，存 chrome.storage.sync
 *   Shortcut / Layout → 较大配置，存 chrome.storage.local
 *   Wallpaper 图片 / 自定义图标 → 二进制，存 IndexedDB
 *   书签数据 → 只读、不进内存持久层、不上传
 */

// ────────────────────────────────────────────────────────────
// 主题与配色
// ────────────────────────────────────────────────────────────

export type ThemeMode = 'system' | 'light' | 'dark';

/** 实际生效的主题（system 解析后的结果） */
export type ResolvedTheme = 'light' | 'dark';

/**
 * 配色。键名与 CSS 变量一一对应：
 *   bg → --bg, lineHighlight → --line-highlight ...
 */
export interface ColorConfig {
  /** 页面底色 —— --bg */
  bg: string;
  /** 主文字 —— --text */
  text: string;
  /** 次级文字 / 占位符 —— --text-secondary */
  textSecondary: string;
  /** 强调色（默认引擎高光、焦点线） —— --accent */
  accent: string;
  /** 基准线条色 —— --line */
  line: string;
  /** 立体高光色 —— --line-highlight */
  lineHighlight: string;
  /** 阴影色，含透明度 —— --shadow */
  shadow: string;
  /** 毛玻璃背景 —— --glass-bg */
  glassBg: string;
  /** 毛玻璃描边 —— --glass-border */
  glassBorder: string;
}

/** 深色 / 浅色两套默认配色 */
export type ThemePalette = Record<ResolvedTheme, ColorConfig>;

// ────────────────────────────────────────────────────────────
// 壁纸
// ────────────────────────────────────────────────────────────

export type WallpaperType = 'solid' | 'image' | 'bing';

export interface WallpaperConfig {
  type: WallpaperType;
  /** type === 'solid' 时生效 */
  color?: string;
  /** type === 'image' 时生效，指向 IndexedDB 中的 blob 记录 */
  imageRef?: string;
  /**
   * type === 'bing' 时生效：当前显示的必应壁纸**绝对地址**。
   *
   * 刻意只存 URL 不存图片本体：
   *   · 导出 JSON 时能安全带上（不含二进制，文件仍是几十 KB 量级）；
   *   · 浏览器自身会缓存这张图，新标签页打开时命中 HTTP 缓存，秒开；
   *   · 换一张 = 换一个 URL，不需要写 IndexedDB。
   */
  bingUrl?: string;
  /**
   * type === 'bing' 时生效：bingUrl 这张图被「定下来」的**本地日期**（YYYY-MM-DD）。
   *
   * 为什么需要这个字段 —— 它修的是一个真实 Bug：
   *   ensureBingWallpaper() 每次打开新标签页都会跑，而它原先只知道
   *   「当前 URL 在不在最近 8 天列表里」。可列表本身有三个来源
   *   （6 小时缓存 / 实时接口 / 离线快照），换了来源就可能不含用户选的那张，
   *   于是「换一张」之后新建标签页会被悄悄换回去。
   *   记下日期后，判断变成「今天是否已经定过这张」：
   *   当天开多少个标签页都保持同一张，跨天才自动换成新的一张。
   */
  bingPickedOn?: string;
  /** 模糊程度 0–20px */
  blur: number;
  /** 亮度 0–100（%） */
  brightness: number;
  /** 遮罩透明度 0–80（%） */
  maskOpacity: number;
}

// ────────────────────────────────────────────────────────────
// 必应每日壁纸
// ────────────────────────────────────────────────────────────

export interface BingImage {
  /** 绝对地址：https://www.bing.com + images[i].url */
  url: string;
  /** 原始 urlbase，可用于拼 UHD 等其它尺寸 */
  urlbase: string;
  /** 版权文案 */
  copyright: string;
  /** 形如 2026-10-12 */
  date: string;
}

/** 本地缓存的壁纸列表快照 */
export interface BingImageCache {
  fetchedAt: number;
  images: BingImage[];
}

/** IndexedDB 中保存的壁纸元信息（原图 + 缩放图） */
export interface WallpaperRecord {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  createdAt: number;
}

// ────────────────────────────────────────────────────────────
// 搜索引擎
// ────────────────────────────────────────────────────────────

export interface SearchEngine {
  id: string;
  name: string;
  /** 必须含 %s 占位符 */
  urlTemplate: string;
  /**
   * 图标引用，三种形态：
   *   · 内置 SVG key（bing / google / baidu / yandex / sm / globe …）
   *   · IndexedDB 里的自定义图标 ref（`engicon_*`）
   *   · http(s) 远程地址，用 <img> 直接加载（AI 引擎走 Favicon API）
   * 无法识别或加载失败时，EngineBar 回退到名称首字母。
   */
  icon: string;
  /** 已删除内置引擎的判定：builtin 为 true 时不允许改 id */
  builtin?: boolean;
  order: number;
}

// ────────────────────────────────────────────────────────────
// 快捷方式
// ────────────────────────────────────────────────────────────

export interface Shortcut {
  id: string;
  name: string;
  url: string;
  /** 'auto' 表示走 favicon 链路；其它值为 IndexedDB 自定义图标 ref 或内置图标 key */
  icon: string;
  /** 隐藏名字后 hover 显示 tooltip */
  hideName: boolean;
  order: number;
  createdAt: number;
  /** 所属分区 id；缺省归入默认分区（见 DEFAULT_SECTION_ID） */
  sectionId: string;
}

// ────────────────────────────────────────────────────────────
// 快捷方式分区
// ────────────────────────────────────────────────────────────

export interface Section {
  id: string;
  name: string;
  order: number;
}

// ────────────────────────────────────────────────────────────
// 模块
// ────────────────────────────────────────────────────────────

export type ModuleType = 'search' | 'engines' | 'shortcuts';

export interface ModuleConfig {
  id: string;
  type: ModuleType;
  /** 移除模块后数据保留，只把 visible 置 false */
  visible: boolean;
  order: number;
}

/** P0 预设布局 */
export type PresetLayout = 'center' | 'left' | 'two-column';

/** P1 网格布局：每模块在 12 列网格中的占用 */
export interface GridPlacement {
  moduleId: string;
  /** 起始列 1–12 */
  col: number;
  /** 跨列数 1–12 */
  span: number;
  /** 行序号，从 1 开始 */
  row: number;
}

export interface LayoutState {
  preset: PresetLayout;
  /** P1 生效；P0 忽略 */
  grid: GridPlacement[];
}

// ────────────────────────────────────────────────────────────
// 收藏夹（只读视图，不持久化）
// ────────────────────────────────────────────────────────────

export interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
  dateAdded?: number;
}

export type BookmarkPermissionState = 'granted' | 'denied' | 'prompt' | 'empty';

export interface BookmarksSnapshot {
  state: BookmarkPermissionState;
  tree: BookmarkNode[];
  /** 扁平化后的所有书签，供搜索用 */
  flat: BookmarkNode[];
  /** 不包含根节点的书签总数 */
  count: number;
}

// ────────────────────────────────────────────────────────────
// 搜索推荐
// ────────────────────────────────────────────────────────────

export type SuggestKind = 'bookmark' | 'search';

export interface SuggestItem {
  id: string;
  kind: SuggestKind;
  /** 主展示文案 */
  title: string;
  /** 副展示文案：书签显示 URL，搜索显示引擎名 */
  subtitle?: string;
  /** kind === 'search' 时的执行引擎 */
  engineId?: string;
  /** kind === 'bookmark' 时的目标地址 */
  url?: string;
  /** 高亮匹配区间 [start, end) */
  matchRange?: [number, number];
}

// ────────────────────────────────────────────────────────────
// 顶层设置
// ────────────────────────────────────────────────────────────

/** 可以单独调整纵向偏移的模块 —— 值就是 Settings 上的字段名，省一层映射 */
export type ModuleOffsetKey = 'searchOffset' | 'shortcutsOffset';

export interface Settings {
  theme: ThemeMode;
  /** 用户覆盖后的配色；未覆盖时跟随当前主题的默认值 */
  colors: Partial<Record<ResolvedTheme, Partial<ColorConfig>>>;
  wallpaper: WallpaperConfig;
  modules: ModuleConfig[];
  defaultEngineId: string;
  layout: LayoutState;
  /** 快捷方式图标边长（px），滑块无极调节 */
  shortcutSize: number;
  /** 是否显示快捷方式名字（全局统一开关） */
  shortcutShowNames: boolean;
  /**
   * 全局圆角缩放系数（0.5–2.0，默认 1）。
   * 以基准半径（--radius-base）为 1，等比放大 / 缩小
   * --radius-sm/md/lg/xl，从而统一影响搜索卡片、快捷方式、毛玻璃浮层等。
   */
  uiRadiusScale: number;
  /**
   * 全局毛玻璃模糊度（px，0–40，默认 18）。
   *
   * 全站**只存这一个数**：搜索卡片、快捷方式底板、弹窗、抽屉、搜索下拉
   * 都用同一个 --glass-blur 取值，因此不存在「某处比别处厚一档」的差，
   * 也不会出现两个数被改得不自洽、导致「搜索框比别的玻璃还薄」的怪状态。
   */
  uiGlassBlur: number;
  /**
   * 「搜索卡片」（搜索框 + 引擎栏，同一张玻璃卡）的纵向偏移量，px，正数向下。
   *
   * 只挪视觉、不改布局（App.svelte 用 position: relative + top 实现），
   * 所以它下方的模块不会跟着移动 —— 各模块互不干扰正是这个字段的意义。
   */
  searchOffset: number;
  /** 「快捷方式区」的纵向偏移量，px，正数向下 */
  shortcutsOffset: number;
  /** 是否启用本地搜索推荐 */
  suggestEnabled: boolean;
  /** 推荐下拉防抖，150–250ms */
  suggestDebounce: number;
}

// ────────────────────────────────────────────────────────────
// 导入 / 导出
// ────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;

export interface ExportBundle {
  schemaVersion: number;
  exportedAt: string;
  settings: Settings;
  engines: SearchEngine[];
  shortcuts: Shortcut[];
  sections: Section[];
  modules: ModuleConfig[];
}

export type ImportStrategy = 'merge' | 'overwrite';

export interface ImportResult {
  ok: boolean;
  strategy: ImportStrategy;
  added: number;
  replaced: number;
  /** 校验失败的字段说明，ok 为 false 时使用 */
  errors: string[];
}

// ────────────────────────────────────────────────────────────
// 工具类型
// ────────────────────────────────────────────────────────────

export interface ValidationIssue {
  path: string;
  message: string;
}

/** 统一返回结构，避免各层抛裸异常 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
