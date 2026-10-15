/**
 * IndexedDB —— 存放二进制资源
 *
 * 两张表：
 *   wallpapers : 壁纸原图（已等比缩放，最长边 ≤ 2560）
 *   icons      : 用户自定义图标（快捷方式 / 搜索引擎）
 *
 * 壁纸图片绝不写入 JSON、绝不进 chrome.storage，避免配额爆掉。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { WallpaperRecord } from '../types';
import { IMAGE_RULES } from './defaults';

const DB_NAME = 'sp-assets';
const DB_VERSION = 1;

interface StartPageDB extends DBSchema {
  wallpapers: {
    key: string;
    value: WallpaperRecord;
    indexes: { byCreatedAt: number };
  };
  icons: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      mime: string;
      bytes: number;
      createdAt: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<StartPageDB>> | null = null;

/** 是否可用 IndexedDB（SSR / 隐私模式下降级） */
export function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function getDB(): Promise<IDBPDatabase<StartPageDB>> {
  if (!hasIndexedDB()) {
    return Promise.reject(new Error('当前环境不支持 IndexedDB'));
  }
  dbPromise ??= openDB<StartPageDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('wallpapers')) {
        const store = db.createObjectStore('wallpapers', { keyPath: 'id' });
        store.createIndex('byCreatedAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('icons')) {
        db.createObjectStore('icons', { keyPath: 'id' });
      }
    },
    blocked() {
      console.warn('[idb] 数据库被其它标签页占用，版本升级被阻塞');
    },
    blocking() {
      // 新版本打开时主动让路，避免多窗口下卡死
      void closeDB();
    },
  });
  return dbPromise;
}

export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    db.close();
  } catch {
    /* 忽略 */
  }
  dbPromise = null;
}

// ── 图片处理 ────────────────────────────────────────────────

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  bytes: number;
}

/**
 * 等比缩放并重编码图片。
 * 用 OffscreenCanvas 优先，回退到普通 canvas；不使用第三方库以控制体积。
 */
export async function processImage(
  file: Blob,
  maxEdge = IMAGE_RULES.maxEdge,
): Promise<ProcessedImage> {
  const bitmap = await createBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  // 无需缩放且体积可控时直接用原图，省一次重编码
  if (scale === 1 && file.size <= IMAGE_RULES.maxBytes) {
    const bytes = file.size;
    const mime = file.type || 'image/png';
    closeBitmap(bitmap);
    return { blob: file, width, height, mime, bytes };
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    closeBitmap(bitmap);
    throw new Error('无法创建绘图上下文');
  }
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height);
  closeBitmap(bitmap);

  const mime = pickOutputMime(file.type);
  const blob = await canvasToBlob(canvas, mime, 0.9);
  return { blob, width, height, mime, bytes: blob.size };
}

function pickOutputMime(input: string): string {
  if (input === 'image/png') return 'image/png'; // 保留透明通道
  if (input === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

async function createBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* 回退到 <img> 解码 */
    }
  }
  return await decodeViaImg(blob);
}

function decodeViaImg(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

function closeBitmap(b: ImageBitmap | HTMLImageElement): void {
  if (typeof ImageBitmap !== 'undefined' && b instanceof ImageBitmap) b.close();
}

function createCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: mime, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('图片编码失败'))),
      mime,
      quality,
    );
  });
}

// ── 壁纸读写 ────────────────────────────────────────────────

export async function saveWallpaper(file: Blob): Promise<WallpaperRecord> {
  const processed = await processImage(file);
  const record: WallpaperRecord = {
    id: `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    blob: processed.blob,
    width: processed.width,
    height: processed.height,
    mime: processed.mime,
    bytes: processed.bytes,
    createdAt: Date.now(),
  };
  const db = await getDB();
  await db.put('wallpapers', record);
  // 只保留最近 3 张，避免老壁纸把配额吃满
  await pruneWallpapers(3, record.id);
  return record;
}

export async function getWallpaper(id: string): Promise<WallpaperRecord | undefined> {
  const db = await getDB();
  return db.get('wallpapers', id);
}

export async function deleteWallpaper(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('wallpapers', id);
}

export async function listWallpapers(): Promise<WallpaperRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('wallpapers', 'byCreatedAt');
  return all.reverse();
}

async function pruneWallpapers(keep: number, protectedId: string): Promise<void> {
  const all = await listWallpapers();
  const extra = all.filter((w) => w.id !== protectedId).slice(keep - 1);
  if (!extra.length) return;
  const db = await getDB();
  await Promise.all(extra.map((w) => db.delete('wallpapers', w.id)));
}

/** 转成可直接用于 CSS 的 objectURL；调用方负责在卸载时 revoke */
export async function wallpaperObjectUrl(id: string): Promise<string | null> {
  const rec = await getWallpaper(id);
  if (!rec) return null;
  return URL.createObjectURL(rec.blob);
}

// ── 自定义图标读写 ──────────────────────────────────────────

export async function saveIcon(id: string, file: Blob): Promise<string> {
  const processed = await processImage(file, 256);
  const db = await getDB();
  await db.put('icons', {
    id,
    blob: processed.blob,
    mime: processed.mime,
    bytes: processed.bytes,
    createdAt: Date.now(),
  });
  return id;
}

export async function getIcon(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  const rec = await db.get('icons', id);
  return rec?.blob;
}

export async function deleteIcon(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('icons', id);
}

export async function iconObjectUrl(id: string): Promise<string | null> {
  const blob = await getIcon(id);
  return blob ? URL.createObjectURL(blob) : null;
}

/** 估算 IndexedDB 已用空间，供设置面板提示 */
export async function estimateUsage(): Promise<{ bytes: number; quota: number }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { bytes: 0, quota: 0 };
  }
  const est = await navigator.storage.estimate();
  return { bytes: est.usage ?? 0, quota: est.quota ?? 0 };
}

export type { StartPageDB };
