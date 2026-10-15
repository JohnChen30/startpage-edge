/**
 * 内联 SVG 图标库 —— 不热链第三方，全部内联以控制体积与合规风险
 *
 * 每个图标使用 currentColor，便于跟随主题着色。
 */
export interface SvgIcon {
  /** viewBox */
  box: string;
  /** path / 结构片段 */
  body: string;
}

export const SVG_ICONS: Record<string, SvgIcon> = {
  // ── 搜索引擎（简化品牌符号，非官方商标复制） ──
  bing: {
    box: '0 0 24 24',
    body: `<path fill="currentColor" d="M5 3.5 8.4 2v15.1l5.1-2.9-2.5-1.2-1.6-3.7 8.5 3.6v4.3L8.6 22.5 5 19.9z"/>`,
  },
  google: {
    box: '0 0 24 24',
    body: `<path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="currentColor" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a6 6 0 0 1-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="currentColor" d="M6.4 14a6 6 0 0 1 0-3.8V7.6H3.1a10 10 0 0 0 0 8.9z"/><path fill="currentColor" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.6l3.3 2.6A6 6 0 0 1 12 6z"/>`,
  },
  baidu: {
    box: '0 0 24 24',
    body: `<circle cx="6.2" cy="9.6" r="2.6" fill="currentColor"/><circle cx="17.8" cy="9.6" r="2.6" fill="currentColor"/><circle cx="9.6" cy="4.9" r="2.4" fill="currentColor"/><circle cx="14.4" cy="4.9" r="2.4" fill="currentColor"/><path fill="currentColor" d="M12 12.2c-3.3 0-6 2.2-6 4.7 0 1.9 1.6 3.1 3.4 3.1 1 0 1.7-.3 2.6-.3s1.6.3 2.6.3c1.8 0 3.4-1.2 3.4-3.1 0-2.5-2.7-4.7-6-4.7z"/>`,
  },
  yandex: {
    box: '0 0 24 24',
    body: `<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm2.4 16.5h-2.6v-6.3l-3.1 6.3H5.9l3.9-7.4a4.4 4.4 0 0 1-2-3.8c0-2.6 1.9-4.3 5-4.3h3.6zm-2.6-8.6V4.9h-1c-1.3 0-2 .7-2 1.7 0 1.1.7 1.8 2 1.8z"/>`,
  },
  sm: {
    box: '0 0 24 24',
    body: `<path fill="currentColor" d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm3 3v4h1.6v-2.2l1 2.2h1.1l1-2.2V14H13v-4h-1.5l-1.2 2.6L9.1 10zm6.1 0v4H15v-1.4h1.2c1 0 1.6-.5 1.6-1.3S17.2 10 16.2 10zm1.9 1.1h.5c.3 0 .5.2.5.4s-.2.4-.5.4h-.5z"/>`,
  },
  // ── AI 对话引擎（简化品牌符号，非官方商标复制）──
  // 这两家的默认 Logo 是远程 Favicon（见 defaults.ts 的 faviconApiUrl）。
  // 下面的内联图形是「远程取不到 / 离线」时的兜底：
  // EngineBar 会在远程图加载失败后，用与引擎 id 同名的内置图形顶上，
  // 所以用户看到的仍是一枚品牌图形，而不是光秃秃的首字母。
  // 鲸鱼侧影（圆头 + 上扬尾鳍），取自 DeepSeek 的鲸鱼意象
  deepseek: {
    box: '0 0 24 24',
    body: `<circle cx="10.2" cy="13.1" r="6.1" fill="currentColor"/><path fill="currentColor" d="M14.9 10.3 21.5 6.7l-1.7 6.4 1.7 6.4-6.6-3.6z"/>`,
  },
  // 六边形结 + 右下角收尾，呼应千问 / Qwen 的几何标识
  qwen: {
    box: '0 0 24 24',
    body: `<path fill="currentColor" d="M12 2.6 20.2 7.4v9.2L12 21.4 3.8 16.6V7.4z"/><path fill="currentColor" d="M16.2 15.2l4.2 4.2-2.1 2.1-4.2-4.2z"/>`,
  },
  // 通用 / 自定义引擎
  globe: {
    box: '0 0 24 24',
    body: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>`,
  },
  // ── UI ──
  settings: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.9a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.2V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>`,
  },
  star: {
    box: '0 0 24 24',
    body: `<path fill="currentColor" d="m12 3.3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.5l5.9-.9z"/>`,
  },
  folder: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.3H19a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
  },
  'chevron-right': {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6"/>`,
  },
  'chevron-down': {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/>`,
  },
  search: {
    box: '0 0 24 24',
    body: `<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m16 16 4.5 4.5"/>`,
  },
  close: {
    box: '0 0 24 24',
    body: `<path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/>`,
  },
  plus: {
    box: '0 0 24 24',
    body: `<path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/>`,
  },
  check: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/>`,
  },
  trash: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/>`,
  },
  edit: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4l10-10-4-4L4 16zM14 6l4 4"/>`,
  },
  copy: {
    box: '0 0 24 24',
    body: `<rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>`,
  },
  eye: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
  },
  'eye-off': {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4M6.4 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.3 3.2-.7"/>`,
  },
  image: {
    box: '0 0 24 24',
    body: `<rect x="3" y="4.5" width="18" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="9.5" r="1.6" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="m4 17 5-5 4 4 3-2.5 4 3.5"/>`,
  },
  grid: {
    box: '0 0 24 24',
    body: `<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
  },
  list: {
    box: '0 0 24 24',
    body: `<path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.6" cy="6.5" r="1.3" fill="currentColor"/><circle cx="4.6" cy="12" r="1.3" fill="currentColor"/><circle cx="4.6" cy="17.5" r="1.3" fill="currentColor"/>`,
  },
  download: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16"/>`,
  },
  upload: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 19h16"/>`,
  },
  palette: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.4 3.4A1.8 1.8 0 0 1 12 21z"/><circle cx="8" cy="10" r="1.4" fill="currentColor"/><circle cx="12" cy="7.5" r="1.4" fill="currentColor"/><circle cx="16" cy="10" r="1.4" fill="currentColor"/>`,
  },
  sun: {
    box: '0 0 24 24',
    body: `<circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>`,
  },
  moon: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/>`,
  },
  monitor: {
    box: '0 0 24 24',
    body: `<rect x="3" y="4" width="18" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 20h6M12 16.5V20"/>`,
  },
  refresh: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20 11a8 8 0 1 0-2 5.7M20 5v6h-6"/>`,
  },
  'arrow-up': {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0-6 6m6-6 6 6"/>`,
  },
  'arrow-down': {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m0 0 6-6m-6 6-6-6"/>`,
  },
  undo: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 8h10a5.5 5.5 0 0 1 0 11H8M4 8l4-4M4 8l4 4"/>`,
  },
  redo: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20 8H10a5.5 5.5 0 0 0 0 11h6M20 8l-4-4M20 8l-4 4"/>`,
  },
  'external-link': {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`,
  },
  'bookmark-plus': {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1z"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 8v5M9.5 10.5h5"/>`,
  },
  info: {
    box: '0 0 24 24',
    body: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 11v5M12 8h.01"/>`,
  },
  warning: {
    box: '0 0 24 24',
    body: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3.8 21 19.5H3z"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 9.5v4.5M12 17h.01"/>`,
  },
};

export function getSvgIcon(name: string): SvgIcon | undefined {
  return SVG_ICONS[name];
}
