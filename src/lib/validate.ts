/**
 * 校验器与 JSON Schema —— 同时服务于
 *   1) 存储读取时的运行时校验
 *   2) 导入文件的格式校验与错误提示
 *
 * 刻意手写而不引入 zod：包体积预算 < 300KB，且校验规则本身很集中。
 */
import {
  BUILTIN_ENGINES,
  BUILTIN_MODULES,
  DEFAULT_SECTION_ID,
  DEFAULT_SETTINGS,
  IMAGE_RULES,
  SHORTCUT_SIZE_RANGE,
  SUGGEST_LIMITS,
  clampModuleOffset,
  clampShortcutSize,
  clampUiGlassBlur,
  clampUiRadiusScale,
} from './defaults';
import type {
  ColorConfig,
  LayoutState,
  ModuleConfig,
  ModuleType,
  PresetLayout,
  Section,
  Settings,
  SearchEngine,
  Shortcut,
  ThemeMode,
  WallpaperConfig,
  ValidationIssue,
} from '../types';

// ── 基础断言 ────────────────────────────────────────────────

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isString = (v: unknown): v is string => typeof v === 'string';

export const isNonEmptyString = (v: unknown): v is string =>
  isString(v) && v.trim().length > 0;

export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ── 颜色 ────────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGBA = /^rgba?\([\d\s.,%]+\)$/i;

export function isColorString(v: unknown): v is string {
  return isString(v) && (HEX.test(v.trim()) || RGBA.test(v.trim()));
}

const COLOR_KEYS: (keyof ColorConfig)[] = [
  'bg',
  'text',
  'textSecondary',
  'accent',
  'line',
  'lineHighlight',
  'shadow',
  'glassBg',
  'glassBorder',
];

/** 颜色允许 hex 或 rgba()，因为 line / shadow 默认带透明度 */
export function isColorConfig(v: unknown): v is ColorConfig {
  if (!isObject(v)) return false;
  return COLOR_KEYS.every((k) => v[k] === undefined || isColorString(v[k]));
}

// ── URL / 模板 ──────────────────────────────────────────────

export function isHttpUrl(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 引擎模板必须含 %s，且本身是合法 http(s) 地址 */
export function isValidUrlTemplate(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false;
  if (!v.includes('%s')) return false;
  return isHttpUrl(v.replace('%s', 'test'));
}

/**
 * 把用户输入拆成 host / 剩余部分，供地址判定复用。
 *
 * 规则要点：
 *   · 认「带点的域名」—— example.com、www.xxx.com、sub.example.co.uk、xxx.cn
 *   · 认 localhost 与 IPv4
 *   · 认单标签带端口 —— dev:3000
 *   · 不认裸单词 —— react 应当被搜索，而不是猜成某个内网站点
 */
function parseHost(input: string): {
  host: string;
  rest: string;
  isDomain: boolean;
  isLocalhost: boolean;
  isIpv4: boolean;
  hasPort: boolean;
} {
  const rest = input.split(/[/?#]/)[0] ?? '';
  const host = rest.split(':')[0] ?? '';
  const afterHost = rest.slice(host.length);
  return {
    host,
    rest,
    // 至少要有一个点，且各段非空：a.com / www.a.com / a.co.uk / xx.cn
    isDomain: /^[\w-]+(\.[\w-]+)+$/.test(host),
    isLocalhost: /^localhost$/i.test(host),
    isIpv4: /^\d{1,3}(\.\d{1,3}){3}$/.test(host),
    hasPort: /^:\d+$/.test(afterHost),
  };
}

/**
 * 把用户输入变成可访问的地址。
 * 支持：完整 URL、裸域名（含 www. 前缀与 .cn 等各类后缀）、
 *       localhost:port、IPv4、单标签带端口。
 * 其它一律返回 null，由调用方决定是否当搜索词处理。
 */
export function normalizeInputToUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return isHttpUrl(raw) ? raw : null;
  // 其它协议（ftp:、file: 等）不接管，避免把奇怪的东西当网页打开
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/\d/.test(raw.split(':')[1] ?? '')) {
    const parsed = parseHost(raw);
    if (!parsed.hasPort) return null;
  }

  const { isDomain, isLocalhost, isIpv4, hasPort } = parseHost(raw);

  if (isDomain || isLocalhost || isIpv4) return `https://${raw}`;
  // 单标签带端口，如 "dev:3000"，视为本地地址
  if (hasPort) return `https://${raw}`;
  return null;
}

// ── 壁纸 ────────────────────────────────────────────────────

export function isWallpaperConfig(v: unknown): v is WallpaperConfig {
  if (!isObject(v)) return false;
  if (v.type !== 'solid' && v.type !== 'image' && v.type !== 'bing') return false;
  if (!isFiniteNumber(v.blur) || !isFiniteNumber(v.brightness)) return false;
  if (!isFiniteNumber(v.maskOpacity)) return false;
  if (v.type === 'image' && v.imageRef !== undefined && !isString(v.imageRef)) {
    return false;
  }
  // bing 类型多两个**可选**字符串字段：当前图地址 + 定妆日期
  // （第一次加载还没取到图、老版本数据还没补日期时，两者都允许缺省）
  if (v.type === 'bing' && v.bingUrl !== undefined && !isString(v.bingUrl)) {
    return false;
  }
  if (v.bingPickedOn !== undefined && !isString(v.bingPickedOn)) return false;
  if (v.color !== undefined && !isColorString(v.color)) return false;
  return true;
}

// ── 搜索引擎 ────────────────────────────────────────────────

export function isSearchEngine(v: unknown): v is SearchEngine {
  if (!isObject(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.name) &&
    isValidUrlTemplate(v.urlTemplate) &&
    isNonEmptyString(v.icon) &&
    isFiniteNumber(v.order)
  );
}

export const isEngineArray = (v: unknown): v is SearchEngine[] =>
  Array.isArray(v) && v.every(isSearchEngine);

// ── 快捷方式 ────────────────────────────────────────────────

export function isShortcut(v: unknown): v is Shortcut {
  if (!isObject(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.name) &&
    isHttpUrl(v.url) &&
    isString(v.icon) &&
    isBoolean(v.hideName) &&
    isFiniteNumber(v.order)
  );
}

export const isShortcutArray = (v: unknown): v is Shortcut[] =>
  Array.isArray(v) && v.every(isShortcut);

// ── 分区 ────────────────────────────────────────────────────

export function isSection(v: unknown): v is Section {
  if (!isObject(v)) return false;
  return isNonEmptyString(v.id) && isNonEmptyString(v.name) && isFiniteNumber(v.order);
}

export const isSectionArray = (v: unknown): v is Section[] =>
  Array.isArray(v) && v.every(isSection);

// ── 模块 ────────────────────────────────────────────────────

const MODULE_TYPES: ModuleType[] = ['search', 'engines', 'shortcuts'];

export function isModuleConfig(v: unknown): v is ModuleConfig {
  if (!isObject(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    MODULE_TYPES.includes(v.type as ModuleType) &&
    isBoolean(v.visible) &&
    isFiniteNumber(v.order)
  );
}

export const isModuleArray = (v: unknown): v is ModuleConfig[] =>
  Array.isArray(v) && v.every(isModuleConfig);

// ── 布局 ────────────────────────────────────────────────────

const PRESETS: PresetLayout[] = ['center', 'left', 'two-column'];

export function isLayoutState(v: unknown): v is LayoutState {
  if (!isObject(v)) return false;
  if (!PRESETS.includes(v.preset as PresetLayout)) return false;
  return Array.isArray(v.grid);
}

// ── 设置 ────────────────────────────────────────────────────

const THEMES: ThemeMode[] = ['system', 'light', 'dark'];

export function isSettings(v: unknown): v is Settings {
  if (!isObject(v)) return false;
  if (!THEMES.includes(v.theme as ThemeMode)) return false;
  if (!isObject(v.colors)) return false;
  if (!isWallpaperConfig(v.wallpaper)) return false;
  if (!isModuleArray(v.modules)) return false;
  if (!isNonEmptyString(v.defaultEngineId)) return false;
  if (!isLayoutState(v.layout)) return false;
  if (!isFiniteNumber(v.shortcutSize)) return false;
  if (!isBoolean(v.shortcutShowNames)) return false;
  if (!isFiniteNumber(v.uiRadiusScale)) return false;
  if (!isFiniteNumber(v.uiGlassBlur)) return false;
  if (!isFiniteNumber(v.searchOffset)) return false;
  if (!isFiniteNumber(v.shortcutsOffset)) return false;
  if (!isBoolean(v.suggestEnabled)) return false;
  if (!isFiniteNumber(v.suggestDebounce)) return false;
  return true;
}

// ── 迁移 ────────────────────────────────────────────────────

/**
 * 旧版档位（sm/md/lg）→ 新的 px 尺寸。
 * 无极调节上线前用户存的是字符串档位，这里做一次映射，
 * 免得老用户的尺寸设置被直接丢弃回默认值。
 */
const LEGACY_SIZE_PX: Record<string, number> = {
  sm: 44,
  md: 56,
  lg: 72,
};

/**
 * 旧版本设置 → 当前结构。
 * 目前只有 v1，保留骨架供未来字段增删使用。
 */
export function migrateSettings(raw: unknown): Settings | undefined {
  if (!isObject(raw)) return undefined;
  const next = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  // 局部修复而不是整体丢弃，尽量保住用户已有配置
  if (!THEMES.includes(next.theme)) next.theme = DEFAULT_SETTINGS.theme;
  if (!isWallpaperConfig(next.wallpaper)) {
    next.wallpaper = DEFAULT_SETTINGS.wallpaper;
  }
  if (!isModuleArray(next.modules) || next.modules.length === 0) {
    next.modules = BUILTIN_MODULES;
  }
  if (!isLayoutState(next.layout)) next.layout = DEFAULT_SETTINGS.layout;
  if (!isFiniteNumber(next.suggestDebounce)) {
    next.suggestDebounce = DEFAULT_SETTINGS.suggestDebounce;
  }
  // 尺寸：旧档位字符串 → px；非法值 → 默认
  if (typeof next.shortcutSize === 'string') {
    next.shortcutSize =
      LEGACY_SIZE_PX[next.shortcutSize] ?? SHORTCUT_SIZE_RANGE.default;
  }
  next.shortcutSize = clampShortcutSize(next.shortcutSize);
  if (!isBoolean(next.shortcutShowNames)) next.shortcutShowNames = true;
  // 圆角系数：老版本没有这个字段 → 落到默认 1；非法值同样夹回默认
  next.uiRadiusScale = clampUiRadiusScale(next.uiRadiusScale);
  // 毛玻璃模糊度：同上，老版本没有这个字段 → 由 DEFAULT_SETTINGS 补 18px
  next.uiGlassBlur = clampUiGlassBlur(next.uiGlassBlur);
  // 模块纵向偏移：老版本没有 → 补 0（即「不动」），不会把老用户的版式挪位
  next.searchOffset = clampModuleOffset(next.searchOffset);
  next.shortcutsOffset = clampModuleOffset(next.shortcutsOffset);
  next.suggestDebounce = clamp(next.suggestDebounce, 150, 250);
  return next;
}

export function migrateEngines(raw: unknown): SearchEngine[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = raw.filter(isSearchEngine);
  if (!valid.length) return undefined;
  return valid
    .map((e, i) => ({ ...e, order: isFiniteNumber(e.order) ? e.order : i }))
    .sort((a, b) => a.order - b.order)
    .map((e, i) => ({ ...e, order: i }));
}

export function migrateShortcuts(raw: unknown): Shortcut[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = raw.filter(isShortcut);
  return dedupeBySectionUrl(valid)
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i }));
}

// ── 导入文件校验 ────────────────────────────────────────────

/**
 * 校验导入的 JSON。
 * 返回结构化问题列表，方便 UI 精确提示「哪个字段坏了」。
 */
export function validateImportBundle(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObject(raw)) {
    return [{ path: '$', message: '文件内容不是合法 JSON 对象' }];
  }

  if (!isFiniteNumber(raw.schemaVersion)) {
    issues.push({ path: 'schemaVersion', message: '缺少 schemaVersion 或类型错误' });
  } else if (raw.schemaVersion > 1) {
    issues.push({
      path: 'schemaVersion',
      message: `文件版本 ${raw.schemaVersion} 高于当前支持的 1，请升级扩展`,
    });
  }

  if (raw.settings !== undefined && !isObject(raw.settings)) {
    issues.push({ path: 'settings', message: 'settings 必须是对象' });
  }

  if (raw.engines !== undefined) {
    if (!Array.isArray(raw.engines)) {
      issues.push({ path: 'engines', message: 'engines 必须是数组' });
    } else {
      raw.engines.forEach((e, i) => {
        if (!isSearchEngine(e)) {
          const reason = !isObject(e)
            ? '不是对象'
            : !isValidUrlTemplate((e as Record<string, unknown>).urlTemplate)
              ? 'urlTemplate 非法（需为含 %s 的 http(s) 地址）'
              : '缺少 id / name / icon 或字段类型错误';
          issues.push({ path: `engines[${i}]`, message: reason });
        }
      });
    }
  }

  if (raw.shortcuts !== undefined) {
    if (!Array.isArray(raw.shortcuts)) {
      issues.push({ path: 'shortcuts', message: 'shortcuts 必须是数组' });
    } else {
      raw.shortcuts.forEach((s, i) => {
        if (!isShortcut(s)) {
          const reason = !isObject(s)
            ? '不是对象'
            : !isHttpUrl((s as Record<string, unknown>).url)
              ? 'url 必须是 http(s) 地址'
              : '缺少 id / name 或字段类型错误';
          issues.push({ path: `shortcuts[${i}]`, message: reason });
        }
      });
    }
  }

  if (raw.modules !== undefined && !isModuleArray(raw.modules)) {
    issues.push({ path: 'modules', message: 'modules 结构非法' });
  }

  if (raw.sections !== undefined) {
    if (!isSectionArray(raw.sections)) {
      issues.push({ path: 'sections', message: 'sections 必须是分区对象数组' });
    } else {
      raw.sections.forEach((s, i) => {
        if (!isSection(s)) {
          issues.push({ path: `sections[${i}]`, message: '缺少 id / name 或字段类型错误' });
        }
      });
    }
  }

  return issues;
}

// ── 图片校验 ────────────────────────────────────────────────

export function validateImageFile(file: File): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!IMAGE_RULES.accept.includes(file.type)) {
    issues.push({
      path: 'file',
      message: `不支持的格式 ${file.type || '未知'}，请使用 jpg / png / webp`,
    });
  }
  if (file.size > IMAGE_RULES.maxBytes) {
    const mb = (file.size / 1024 / 1024).toFixed(2);
    issues.push({
      path: 'file',
      message: `文件 ${mb}MB 超过 5MB 上限`,
    });
  }
  return issues;
}

// ── 去重 / 约束 ─────────────────────────────────────────────

/** 快捷方式按 URL 去重（忽略末尾斜杠与大小写差异） */
export function dedupeByUrl<T extends { url: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    const key = normalizeUrlKey(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * 快捷方式按「分区 + URL」去重：同一分区内不允许重复，但不同分区可以出现同一网址。
 * 缺 sectionId 的按默认分区处理（与运行时兜底一致）。
 * 用于存储读取 / 迁移 / 跨窗口同步，避免把用户刻意放在多分区里的同一网址误删。
 */
export function dedupeBySectionUrl<T extends { url: string; sectionId?: string }>(
  list: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    const key = `${item.sectionId ?? DEFAULT_SECTION_ID}::${normalizeUrlKey(item.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * 按 order 排序后重排为连续序号。
 *
 * 适用场景：从存储读回数据后做归一化（此时数组顺序不可信，order 才可信）。
 *
 * ⚠️ 不要把「已经排好序的数组」交给它 —— 它会按旧的 order 值重新排一遍，
 * 反而把新顺序丢掉。UI 拖拽排序后应当用 assignOrder 直接按下标赋 order。
 */
export function reindexOrder<T extends { order: number }>(list: T[]): T[] {
  return [...list]
    .sort((a, b) => a.order - b.order)
    .map((item, i) => ({ ...item, order: i }));
}

/**
 * 按数组当前顺序直接赋予 order，不做任何排序。
 *
 * 适用场景：拖拽排序、上移下移之后 —— 此时数组顺序就是用户意图，
 * order 需要跟着数组走，而不是反过来。
 */
export function assignOrder<T extends { order: number }>(list: T[]): T[] {
  return list.map((item, i) => ({ ...item, order: i }));
}

export { BUILTIN_ENGINES, DEFAULT_SETTINGS, SUGGEST_LIMITS };
