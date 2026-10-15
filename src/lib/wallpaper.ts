/**
 * 壁纸通用操作 —— 本地图片落库 / 下载当前壁纸
 *
 * 刻意不依赖任何 store：调用方把「当前壁纸配置」传进来，函数只做纯操作。
 * 这样设置面板和左下角的浮层按钮可以共用同一套逻辑，不会各写一份而逐渐漂移。
 */
import { deleteWallpaper, getWallpaper, saveWallpaper } from './indexeddb';
import { downloadRemoteImage, BING_ORIGIN } from './bing';
import { validateImageFile } from './validate';
import type { Result, WallpaperConfig } from '../types';

export interface AppliedWallpaper {
  /** IndexedDB 记录 id，写回 wallpaper.imageRef */
  id: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * 校验并保存用户选择的本地图片，返回可直接写进设置的信息。
 * 只负责「校验 + 落库 + 清旧记录」，不碰设置。
 */
export async function applyWallpaperFile(
  file: File,
  previousRef?: string,
): Promise<Result<AppliedWallpaper>> {
  const issues = validateImageFile(file);
  if (issues.length) return { ok: false, error: issues[0].message };

  try {
    const record = await saveWallpaper(file);
    // 清掉上一张，避免 IndexedDB 无限堆积
    if (previousRef && previousRef !== record.id) {
      await deleteWallpaper(previousRef).catch(() => {});
    }
    return {
      ok: true,
      value: {
        id: record.id,
        width: record.width,
        height: record.height,
        bytes: record.bytes,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '壁纸保存失败';
    return { ok: false, error: `${msg}，可能已超出存储配额` };
  }
}

/** 从 MIME 推断扩展名 */
function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

export type DownloadOutcome = 'download' | 'opened';

/**
 * 下载「当前正在显示」的壁纸原图。
 *   · 必应壁纸 → 直接下载远程原图（1920×1080）
 *   · 自定义图片 → 从 IndexedDB 取出原始 blob，直接用本地二进制下载（无需联网）
 */
export async function downloadWallpaper(
  wp: WallpaperConfig,
): Promise<Result<DownloadOutcome>> {
  const stamp = new Date().toISOString().slice(0, 10);

  if (wp.type === 'bing') {
    const url = wp.bingUrl;
    if (!url || !url.startsWith(BING_ORIGIN)) {
      return { ok: false, error: '当前还没有可下载的必应壁纸' };
    }
    const outcome = await downloadRemoteImage(url, `bing-wallpaper-${stamp}.jpg`);
    return { ok: true, value: outcome };
  }

  if (wp.type === 'image') {
    const ref = wp.imageRef;
    if (!ref) return { ok: false, error: '当前没有可下载的自定义壁纸' };
    try {
      const record = await getWallpaper(ref);
      if (!record?.blob) return { ok: false, error: '原图已丢失，请重新导入' };
      const url = URL.createObjectURL(record.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallpaper-${stamp}.${extFromMime(record.mime)}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { ok: true, value: 'download' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '读取原图失败';
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: '纯色背景没有可下载的图片' };
}
