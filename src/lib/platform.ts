/**
 * 平台适配 —— 所有 browser / chrome API 的访问都走这里
 *
 * 目的：让上层代码在三种环境下都能跑
 *   1. 真实扩展（chrome / edge）
 *   2. Vitest + jsdom（有 chrome mock 或纯内存回退）
 *   3. 纯网页预览（无任何扩展 API，全部降级）
 */
import { demoSnapshot, loadBookmarks } from './bookmarks';
import { hasExtensionStorage } from './storage';
import { buildSearchUrl, looksLikeUrl } from './suggest';
import { normalizeInputToUrl } from './validate';
import type { BookmarkPermissionState, SearchEngine } from '../types';

export const isExtensionContext = (): boolean => {
  try {
    return Boolean(
      typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.runtime.getURL,
    );
  } catch {
    return false;
  }
};

export const isEdge = (): boolean =>
  typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent);

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** 新标签页里打开链接：保持「当前页跳转」语义（新标签页本身就是当前页） */
export function navigateCurrentTab(url: string): void {
  window.location.replace(url);
}

/**
 * 统一的「执行一次搜索 / 跳转」入口。
 *
 * SearchBar（回车、选推荐项）与 EngineBar（点引擎）必须共用这一段，
 * 否则两处的「网址识别」规则会漂移 —— 用户在搜索框输 example.com 回车能跳，
 * 点引擎却被当成搜索词，这类不一致非常容易被感知到。
 *
 * 规则：
 *   · 输入看起来是地址 → 直接打开该地址，不拼搜索 URL
 *   · 否则 → 用指定引擎拼搜索 URL（不传引擎则用传入的默认引擎）
 *
 * @returns 实际跳转到的 URL；没有可跳转目标时返回 null
 */
export function runSearch(
  rawInput: string,
  engine: SearchEngine | undefined,
): string | null {
  const text = rawInput.trim();
  if (!text || !engine) return null;

  // 1) 地址形态：无论用哪个引擎触发，都应当直接打开
  if (looksLikeUrl(text)) {
    const url = normalizeInputToUrl(text);
    if (url) {
      navigateCurrentTab(url);
      return url;
    }
  }

  // 2) 普通关键词：交给引擎模板
  const url = buildSearchUrl(engine.urlTemplate, text);
  navigateCurrentTab(url);
  return url;
}

/** 需要在新窗口打开的场合 */
export function openInNewTab(url: string): void {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 回退：临时 textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 读取真实收藏夹权限状态，无 API 时视为 denied（demo 数据仍可用） */
export async function currentBookmarkState(): Promise<BookmarkPermissionState> {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) return 'denied';
  try {
    await chrome.bookmarks.getTree();
    return 'granted';
  } catch {
    return 'denied';
  }
}

export { hasExtensionStorage, loadBookmarks, demoSnapshot };
