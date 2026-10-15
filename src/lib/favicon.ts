/**
 * favicon 解析 —— 核心目标：拿到网站「最原始」的 logo
 *
 * 优先级（与服务端 / 客户端能力对齐）：
 *   1. manifest icons   —— 需要 host 访问，本扩展不申请 host_permissions，故标记为未启用
 *   2. apple-touch-icon —— 同上
 *   3. og:image         —— 同上
 *   4. /favicon.ico     —— 走 chrome://favicon 私有协议，无需 host 权限 ★ 主力链路
 *   5. 首字母 / 默认图标 —— 兜底，永远可用
 *
 * 说明：步骤 1–3 需要读取目标页面 DOM 或发起跨域请求，与「不申请 host_permissions」
 * 的合规约束冲突。因此运行时实际走 4 → 5 两级链路；1–3 保留为可选增强入口，
 * 若未来产品决定申请 host 权限，只需实现 fetchSiteIconCandidates 即可无缝接入。
 */
import { getIcon } from './indexeddb';

export type FaviconSource =
  'custom' | 'manifest' | 'apple-touch' | 'og-image' | 'favicon-ico' | 'letter';

export interface FaviconResult {
  src: string;
  source: FaviconSource;
  /** 是否为可丢弃的 objectURL */
  revocable: boolean;
}

const memoryCache = new Map<string, FaviconResult>();

/** 取出站点 origin，失败返回 null */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * 首选链路：chrome://favicon（Chromium 私有协议，需 favicon 权限，无需 host 权限）。
 * 通过 /_favicon/ 端点访问，Edge / Chromium 114+ 支持。
 *
 * 关于尺寸：这个端点会尽量返回不小于 size 的图标，但站点本身只有 16×16 时
 * 它也变不出更清晰的。所以「清晰度」要靠两点兜住：
 *   1. 请求时给足 size（我们用 128），能拿到 32/48/64 的站点就不会糊
 *   2. 渲染端用 image-rendering + 圆角容器，把不得不放大的小图标
 *      处理成「有意为之」的观感，而不是模糊拉伸（见 ShortcutLogo.svelte）
 */
export function faviconUrl(
  pageUrl: string,
  size = 64,
  showFallbackMonogram = true,
): string | null {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return null;
  const params = new URLSearchParams({
    pageUrl,
    size: String(size),
  });
  if (showFallbackMonogram) params.set('showFallbackMonogram', 'true');
  return chrome.runtime.getURL(`/_favicon/?${params.toString()}`);
}

/**
 * 候选链：按「大概率更清晰」的顺序排列。
 *
 * 同一端点请求不同 size，Chromium 会选择最接近的可用图标位图 ——
 * 先试 128，再退回 64，最后才是站点根目录的 /favicon.ico（通常是 16×16）。
 * 这样有高清 favicon 的站点能拿到高清，只有 16×16 的站点点缀也最轻。
 */
export function faviconCandidates(pageUrl: string): string[] {
  const out: string[] = [];
  for (const size of [128, 64]) {
    const u = faviconUrl(pageUrl, size, false);
    if (u) out.push(u);
  }
  const root = rootFaviconUrl(pageUrl);
  if (root) out.push(root);
  return out;
}

/** 二级兜底：站点根目录的 /favicon.ico */
export function rootFaviconUrl(pageUrl: string): string | null {
  const origin = originOf(pageUrl);
  return origin ? `${origin}/favicon.ico` : null;
}

/**
 * 可选增强入口（当前未启用，需 host_permissions）。
 * 保留实现骨架以便后续按需开启。
 */
export function fetchSiteIconCandidates(_pageUrl: string): string[] {
  // 未申请 host 权限，刻意不实现网络请求。
  return [];
}

/** 首字母：支持中英文，英文取前两个词首字母更易辨识 */
export function monogramOf(name: string): string {
  const clean = name.trim();
  if (!clean) return '?';
  // 含中日韩字符：取前两个字符
  if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(clean)) {
    const chars = Array.from(clean).filter((c) => !/\s/.test(c));
    return chars.slice(0, 2).join('').toUpperCase();
  }
  const words = clean.split(/[\s\-_.]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return Array.from(clean)[0].toUpperCase();
}

/** 由字符串稳定地派生一个色相，让首字母图标颜色各异但可复现 */
export function monogramHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}

// ── 统一解析入口 ────────────────────────────────────────────

export interface ResolveFaviconOptions {
  url: string;
  name: string;
  /** Shortcut.icon：'auto' 或 IndexedDB 图标 id */
  icon: string;
  size?: number;
}

/**
 * 解析出一个可用的图标 src。
 * 永远不返回 null —— 最差情况返回空字符串，由 UI 决定渲染首字母。
 */
export async function resolveFavicon(
  opts: ResolveFaviconOptions,
): Promise<FaviconResult> {
  const { url, name, icon, size = 64 } = opts;

  // 0. 用户自定义图标优先
  if (icon && icon !== 'auto') {
    const cached = memoryCache.get(`custom:${icon}`);
    if (cached) return cached;
    try {
      const blob = await getIcon(icon);
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        const result: FaviconResult = {
          src: objectUrl,
          source: 'custom',
          revocable: true,
        };
        memoryCache.set(`custom:${icon}`, result);
        return result;
      }
    } catch (err) {
      console.warn('[favicon] 自定义图标读取失败，回退自动识别', err);
    }
  }

  // 1. chrome://favicon 私有协议
  const cacheKey = `auto:${url}:${size}`;
  const hit = memoryCache.get(cacheKey);
  if (hit) return hit;

  const fav = faviconUrl(url, size, false) ?? rootFaviconUrl(url);
  if (fav) {
    const result: FaviconResult = {
      src: fav,
      source: 'favicon-ico',
      revocable: false,
    };
    memoryCache.set(cacheKey, result);
    return result;
  }

  // 2. 首字母兜底
  void name;
  return { src: '', source: 'letter', revocable: false };
}

/** index.html 里的 <img onerror> 需要知道下一级回退是什么 */
export function fallbackChain(url: string): string[] {
  const chain: string[] = [];
  const fav = faviconUrl(url, 64, false);
  if (fav) chain.push(fav);
  const root = rootFaviconUrl(url);
  if (root) chain.push(root);
  return chain;
}

export function clearFaviconCache(): void {
  for (const item of memoryCache.values()) {
    if (item.revocable) URL.revokeObjectURL(item.src);
  }
  memoryCache.clear();
}
