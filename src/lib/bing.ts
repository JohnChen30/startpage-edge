/**
 * 必应每日壁纸 —— 取图 / 选择 / 下载
 *
 * 数据源（官方、无 key、无需登录）：
 *   https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN
 *   → { images: [ { url: '/th?id=OHR.xxx_1920x1080.jpg&rf=…&pid=hp', … } ] }
 *   绝对地址 = https://www.bing.com + images[i].url
 *
 * ── 三个必须注意的点 ──
 * 1) 这个接口**不返回 CORS 头**。扩展页面属于普通网页上下文，跨域 fetch 会被浏览器
 *    拦掉，因此在 manifest 里为 www.bing.com / cn.bing.com 申请了最小范围的
 *    host_permissions。两个域名轮流试：任一域名在当前网络下不通都能自动切到另一个。
 * 2) 图片本身一律用 <img> 直接加载（见 Wallpaper.svelte），不走 fetch + blob。
 *    <img> 不受 CORS 限制，所以「列表能取到就一定能显示」。
 * 3) 就算两条网络路都断了也不能白屏 —— 见下面的四级降级链。
 *
 * 四级降级链（自上而下，取到就停）：
 *   ① 本地缓存（6 小时内，chrome.storage.local）—— 新标签页秒开，零网络等待
 *   ② 实时接口（www.bing.com → cn.bing.com）
 *   ③ 过期缓存（哪怕几天前的，也比没有强）
 *   ④ 构建期烘焙的内置快照（bing-fallback.ts）—— 完全离线也能显示壁纸
 *
 * 无论走了哪一级，都会把结果记录到模块级的 BingStatus，UI 层因此能显示
 * 「具体是因为什么没取到」，而不是一句笼统的「请检查网络」。
 */
import { readRaw, writeRaw } from './storage';
import { STORAGE_KEYS } from './defaults';
import { BING_FALLBACK_IMAGES } from './bing-fallback';
import type { BingImage, BingImageCache } from '../types';

/** 拼绝对地址用（图片本体只需要 <img>，不依赖 host 权限） */
export const BING_ORIGIN = 'https://www.bing.com';

/** 接口路径：最近 8 天、中文市场（需求指定的参数，固定不变） */
const BING_API_PATH = '/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN';

/**
 * 依次尝试的接口主机。
 * www.bing.com 是官方主域；cn.bing.com 是同一套接口的国内入口，返回完全相同的
 * JSON（已实测：同样是 200 / 5780B / 8 条）。哪个能通用哪个。
 */
export const BING_API_HOSTS = ['https://www.bing.com', 'https://cn.bing.com'] as const;

/** 保留旧的导出名，等价于「第一个主机 + 路径」 */
export const BING_API_URL = `${BING_API_HOSTS[0]}${BING_API_PATH}`;

/** 列表缓存有效期：6 小时 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** 单次最多取几天 */
export const BING_DAY_COUNT = 8;

/** 这次列表是从哪儿来的 */
export type BingSource =
  /** 命中 6 小时内的缓存，没有发起网络请求 */
  | 'cache'
  /** 实时接口拿到了 */
  | 'network'
  /** 实时失败，退回过期缓存 */
  | 'cache-stale'
  /** 实时失败且无缓存，用了构建期内置快照 */
  | 'builtin'
  /** 一条路都不通，真的没有图 */
  | 'empty';

export interface BingStatus {
  source: BingSource;
  /** 仅在降级时有值：给用户看的、具体的原因 */
  error: string;
  /** 这次结果的时间戳 */
  updatedAt: number;
}

let status: BingStatus = { source: 'empty', error: '', updatedAt: 0 };

/** 读取最近一次取图的状态（UI 用它把失败原因显示出来） */
export function getBingStatus(): BingStatus {
  return status;
}

/** 把 fetch 抛出的异常翻译成人话 */
function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  // 浏览器把「离线」和「跨域/权限被拦」都归一成这句，拿不到更细的区分
  if (/Failed to fetch|NetworkError|Load failed|net::|ERR_/i.test(msg)) {
    return '连接不上必应服务器（当前无网络，或扩展的主机权限未生效）';
  }
  return msg || '取图失败';
}

/**
 * 本地时区的 YYYY-MM-DD，用来判断「今天」。
 *
 * 刻意**不用** `toISOString().slice(0, 10)`：那是 UTC 日期，在东八区
 * 凌晨 0–8 点会算成前一天，导致「当天已定过」的判断在半夜失效、
 * 新标签页突然换图。必应自己的日界线也是北京时间零点
 * （接口里 fullstartdate 形如 202610111600，即 UTC 16:00 = 东八区 0:00），
 * 所以本地日期正好和它的「一天」对齐。
 */
export function todayStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface RawArchiveEntry {
  url?: unknown;
  urlbase?: unknown;
  copyright?: unknown;
  startdate?: unknown;
  enddate?: unknown;
}

function toBingImage(raw: RawArchiveEntry): BingImage | null {
  if (typeof raw.url !== 'string' || !raw.url) return null;
  // 接口给的是相对路径（/th?id=…），少数情况下可能已是绝对地址
  const url = raw.url.startsWith('http') ? raw.url : `${BING_ORIGIN}${raw.url}`;
  const urlbase = typeof raw.urlbase === 'string' ? raw.urlbase : '';
  return {
    url,
    urlbase,
    copyright: typeof raw.copyright === 'string' ? raw.copyright : '',
    date:
      typeof raw.startdate === 'string'
        ? `${raw.startdate.slice(0, 4)}-${raw.startdate.slice(4, 6)}-${raw.startdate.slice(6, 8)}`
        : '',
  };
}

/**
 * 直接打接口（无缓存）。
 * 逐个主机尝试，任意一个只要能解析出非空列表就算成功；
 * 全部失败时抛出**最后一个**错误，供上层翻译成用户可读的原因。
 */
export async function fetchBingImages(): Promise<BingImage[]> {
  let lastError: unknown = null;

  for (const host of BING_API_HOSTS) {
    try {
      const res = await fetch(`${host}${BING_API_PATH}`, { credentials: 'omit' });
      if (!res.ok) throw new Error(`必应壁纸接口返回 ${res.status}`);
      const data = (await res.json()) as { images?: unknown };
      if (!Array.isArray(data.images)) continue;

      const images = data.images
        .map((item) => toBingImage(item as RawArchiveEntry))
        .filter((item): item is BingImage => item !== null)
        .slice(0, BING_DAY_COUNT);

      if (images.length) return images;
    } catch (err) {
      // 记下失败原因后换下一个域名，不中断
      lastError = err;
      console.warn(`[bing] ${host} 取图失败，换下一个域名`, err);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('必应壁纸接口没有返回可用图片');
}

async function readCache(): Promise<BingImageCache | null> {
  const raw = await readRaw<unknown>('local', STORAGE_KEYS.bingWallpapers);
  if (!raw || typeof raw !== 'object') return null;
  const cache = raw as Partial<BingImageCache>;
  if (!Array.isArray(cache.images) || !cache.images.length) return null;
  if (!Number.isFinite(cache.fetchedAt)) return null;
  // 缓存里的记录同样过一遍结构校验，避免旧版本脏数据把渲染搞崩
  const images = cache.images
    .map((item) => toBingImage(item as RawArchiveEntry))
    .filter((item): item is BingImage => item !== null);
  if (!images.length) return null;
  return { fetchedAt: cache.fetchedAt as number, images };
}

async function writeCache(images: BingImage[]): Promise<void> {
  const cache: BingImageCache = { fetchedAt: Date.now(), images };
  await writeRaw('local', STORAGE_KEYS.bingWallpapers, cache);
}

/**
 * 取最近 8 天的壁纸列表，按「缓存 → 实时 → 过期缓存 → 内置快照」四级降级。
 * 这个函数**永不抛异常、永不返回空数组**（除非连内置快照都被清空了），
 * 调用方不必自己兜底。
 *
 * @param force 忽略新鲜缓存强制走网络（用户主动点「刷新」场景）
 */
export async function loadBingImages(force = false): Promise<BingImage[]> {
  // ① 新鲜缓存
  if (!force) {
    const cached = await readCache();
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      status = { source: 'cache', error: '', updatedAt: cached.fetchedAt };
      return cached.images;
    }
  }

  let failure = '';

  // ② 实时接口
  try {
    const images = await fetchBingImages();
    if (images.length) {
      await writeCache(images);
      status = { source: 'network', error: '', updatedAt: Date.now() };
      return images;
    }
  } catch (err) {
    failure = describeError(err);
    console.warn('[bing] 实时取图失败，继续降级', err);
  }

  // ③ 过期缓存
  const cached = await readCache();
  if (cached?.images.length) {
    status = { source: 'cache-stale', error: failure, updatedAt: Date.now() };
    return cached.images;
  }

  // ④ 内置快照：不写缓存。它是安全网，不是数据源 ——
  //    一旦写进缓存，6 小时内都会被当成「刚从网络拿到的」而不再重试。
  if (BING_FALLBACK_IMAGES.length) {
    status = { source: 'builtin', error: failure, updatedAt: Date.now() };
    return [...BING_FALLBACK_IMAGES];
  }

  status = { source: 'empty', error: failure, updatedAt: Date.now() };
  return [];
}

/**
 * 在列表中挑一张。
 * @param current 当前正在显示的地址；会尽量避开它，避免「点了没变化」
 */
export function pickBingImage(images: BingImage[], current?: string): BingImage | null {
  if (!images.length) return null;
  const candidates =
    images.length > 1 ? images.filter((i) => i.url !== current) : images;
  const pool = candidates.length ? candidates : images;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 下载 ────────────────────────────────────────────────────

/** 触发浏览器下载 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 下载远程图片。
 * 优先 fetch+blob（能拿到真正的二进制，文件名可控）；
 * 跨域被拦时退化为新窗口打开原图，让用户自己「图片另存为」——
 * 总比点了没反应好。
 */
export async function downloadRemoteImage(
  url: string,
  filename: string,
): Promise<'download' | 'opened'> {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    triggerDownload(blob, filename);
    return 'download';
  } catch {
    window.open(url, '_blank', 'noopener');
    return 'opened';
  }
}
