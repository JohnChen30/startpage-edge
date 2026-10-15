/**
 * 搜索推荐引擎 —— P0 纯本地，不调用任何外部 suggest API
 *
 * 数据来源：
 *   1. 本地收藏匹配（浏览器书签 + 快捷方式）
 *   2. 用输入词生成的搜索链接
 *
 * 匹配优先级：标题完全匹配 > 标题开头匹配 > 标题包含 > URL 包含
 */
import { SUGGEST_LIMITS } from './defaults';
import { normalizeInputToUrl } from './validate';
import type { BookmarkNode, SearchEngine, Shortcut, SuggestItem } from '../types';

const RANK = {
  titleExact: 0,
  titlePrefix: 1,
  titleContains: 2,
  urlContains: 3,
} as const;

interface Candidate {
  title: string;
  url: string;
  subtitle: string;
  rank: number;
  matchRange?: [number, number];
}

function scoreCandidate(
  title: string,
  url: string,
  indexed: string,
): { rank: number; matchRange?: [number, number] } | null {
  const lowerTitle = title.toLowerCase();
  if (lowerTitle === indexed) {
    return { rank: RANK.titleExact, matchRange: [0, title.length] };
  }
  if (lowerTitle.startsWith(indexed)) {
    return { rank: RANK.titlePrefix, matchRange: [0, indexed.length] };
  }
  const at = lowerTitle.indexOf(indexed);
  if (at >= 0) {
    return { rank: RANK.titleContains, matchRange: [at, at + indexed.length] };
  }
  if (url.toLowerCase().includes(indexed)) {
    return { rank: RANK.urlContains };
  }
  return null;
}

export interface SuggestInput {
  query: string;
  bookmarks: BookmarkNode[];
  shortcuts: Shortcut[];
  engines: SearchEngine[];
  defaultEngineId: string;
  engineUrlTemplate: string;
  /** 是否追加「搜索 xxx」候选 */
  includeSearch: boolean;
  /**
   * 只返回收藏夹命中项，不带任何搜索引擎兜底候选。
   * 起始页据此实现「推荐只推荐收藏夹内容；没有匹配就完全不显示下拉」。
   * 开启后 includeSearch 会被忽略。
   */
  bookmarkOnly?: boolean;
}

/**
 * 生成推荐列表。返回结果已按优先级排序并裁剪到上限。
 */
export function buildSuggestions(input: SuggestInput): SuggestItem[] {
  const query = input.query.trim();
  if (!query) return [];

  const indexed = query.toLowerCase();

  // ── 候选取自 书签 + 快捷方式，按 URL 去重 ──
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  const push = (title: string, url: string, subtitle: string): void => {
    if (!url) return;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    const scored = scoreCandidate(title || url, url, indexed);
    if (!scored) return;
    seen.add(key);
    candidates.push({
      title: title || url,
      url,
      subtitle,
      rank: scored.rank,
      matchRange: scored.matchRange,
    });
  };

  for (const b of input.bookmarks) {
    if (b.url) push(b.title, b.url, '收藏');
  }
  for (const s of input.shortcuts) {
    push(s.name, s.url, '快捷方式');
  }

  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.title.localeCompare(b.title, 'zh-Hans-CN');
  });

  const bookmarkItems: SuggestItem[] = candidates
    .slice(0, SUGGEST_LIMITS.bookmark)
    .map((c, i) => ({
      id: `bm-${i}-${c.url}`,
      kind: 'bookmark' as const,
      title: c.title,
      subtitle: c.subtitle,
      url: c.url,
      matchRange: c.matchRange,
    }));

  // ── 用输入词生成搜索候选 ──
  const searchItems: SuggestItem[] = [];
  if (input.includeSearch && !input.bookmarkOnly) {
    const defaultEngine =
      input.engines.find((e) => e.id === input.defaultEngineId) ?? input.engines[0];

    searchItems.push({
      id: 'search-default',
      kind: 'search',
      title: query,
      subtitle: defaultEngine ? `${defaultEngine.name} 搜索` : '搜索',
      engineId: defaultEngine?.id,
    });

    // 第二个搜索候选给「次优先引擎」，让用户一键换引擎
    const secondary = input.engines.find((e) => e.id !== defaultEngine?.id);
    if (secondary && SUGGEST_LIMITS.search > 1) {
      searchItems.push({
        id: 'search-alt',
        kind: 'search',
        title: query,
        subtitle: `${secondary.name} 搜索`,
        engineId: secondary.id,
      });
    }
  }

  return [...bookmarkItems, ...searchItems].slice(0, SUGGEST_LIMITS.total);
}

// ── 搜索执行 ────────────────────────────────────────────────

/** 把查询词安全地填进引擎模板 */
export function buildSearchUrl(template: string, query: string): string {
  const trimmed = query.trim();
  if (!template.includes('%s')) return template;
  return template.replace('%s', encodeURIComponent(trimmed));
}

/**
 * 判断输入是否应被当作「直接地址」而非搜索词。
 *
 * 实现上直接复用 normalizeInputToUrl —— 两处如果各写一套正则，
 * 迟早会出现「回车能跳、点引擎却搜索」这类不一致。
 * 单标签（如 "react"）不算地址，否则用户搜单词时会被误解为要打开内网站点。
 */
export function looksLikeUrl(input: string): boolean {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return false;
  if (/^https?:\/\/\S+$/i.test(raw)) return true;
  return normalizeInputToUrl(raw) !== null;
}

// ── 防抖 ────────────────────────────────────────────────────

/**
 * 简单防抖，用于输入 150–250ms 后触发推荐计算。
 * 不用 requestIdleCallback，因为推荐计算本身很短，实时性更重要。
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): ((...args: A) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const wrapped = (...args: A) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = pending;
      pending = null;
      if (a) fn(...a);
    }, wait);
  };

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  wrapped.flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const a = pending;
    pending = null;
    if (a) fn(...a);
  };

  return wrapped;
}

// ── 高亮 ────────────────────────────────────────────────────

/** 把标题按匹配区间切成 [前, 命中, 后] 三段，便于渲染高亮 */
export function splitHighlight(
  text: string,
  range?: [number, number],
): [string, string, string] {
  if (!range) return [text, '', ''];
  const [start, end] = range;
  if (start < 0 || end > text.length || start >= end) return [text, '', ''];
  return [text.slice(0, start), text.slice(start, end), text.slice(end)];
}
