/**
 * Service Worker（Manifest V3 background）
 *
 * 职责边界 —— 严格按需求收敛，绝不越界：
 *   1. 首次安装初始化（写入 schemaVersion 与默认数据）
 *   2. 书签变化监听 → 向已打开的 newtab 页面广播
 *   3. 消息路由
 *
 * 明确不做的事：
 *   · 不用 setInterval / 心跳保活。MV3 下 SW 空闲 30 秒即终止，
 *     保活既是反模式也会被商店审核质疑。
 *   · 不承担任何渲染逻辑，全部交给 newtab 页面。
 *   · 不发网络请求。
 */
import {
  STORAGE_KEYS,
  BUILTIN_ENGINES,
  BUILTIN_MODULES,
  DEFAULT_SETTINGS,
} from '../lib/defaults';
import { SCHEMA_VERSION } from '../types';
import { readRaw, writeRaw } from '../lib/storage';

/** 广播给所有 newtab 标签页；没有打开的页面时静默失败 */
async function broadcast(type: string, payload?: unknown): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({
      url: chrome.runtime.getURL('newtab.html'),
    });
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      // 标签页可能正在卸载，sendMessage 会 reject —— 忽略即可
      chrome.tabs.sendMessage(tab.id, { type, payload }).catch(() => {});
    }
  } catch (err) {
    console.warn('[sw] 广播失败', err);
  }
}

/** 首次安装：只补齐缺失的键，不覆盖任何已有数据 */
async function initializeIfNeeded(): Promise<void> {
  const version = await readRaw<number>('sync', STORAGE_KEYS.schemaVersion);

  if (version === undefined) {
    await writeRaw('sync', STORAGE_KEYS.schemaVersion, SCHEMA_VERSION);
  }

  const checks: [string, unknown][] = [
    [STORAGE_KEYS.settings, DEFAULT_SETTINGS],
    [STORAGE_KEYS.engines, BUILTIN_ENGINES],
    [STORAGE_KEYS.modules, BUILTIN_MODULES],
  ];

  for (const [key, fallback] of checks) {
    const existing = await readRaw('sync', key);
    if (existing === undefined) {
      await writeRaw('sync', key, fallback);
    }
  }

  const shortcuts = await readRaw('local', STORAGE_KEYS.shortcuts);
  if (shortcuts === undefined) {
    await writeRaw('local', STORAGE_KEYS.shortcuts, []);
  }
}

// ── 书签变化监听 ──
// 只做「通知」，数据让页面自己去拉 —— SW 可能随时被回收，
// 不在 SW 里缓存书签树，避免状态不一致。

const BOOKMARK_EVENTS = [
  'onCreated',
  'onRemoved',
  'onChanged',
  'onMoved',
  'onChildrenReordered',
  'onImportEnded',
] as const;

function registerBookmarkWatchers(): void {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) return;

  for (const name of BOOKMARK_EVENTS) {
    const event = chrome.bookmarks[name as keyof typeof chrome.bookmarks] as
      chrome.events.Event<(...args: unknown[]) => void> | undefined;
    event?.addListener(() => {
      void broadcast('bookmarks:changed');
    });
  }
}

// ── 安装 / 更新 ──

export default defineBackground(() => {
  // 每次 SW 唤醒都确保基础数据存在（幂等，成本极低）
  void initializeIfNeeded();

  chrome.runtime.onInstalled.addListener((details) => {
    void initializeIfNeeded();

    if (details.reason === 'install') {
      console.info('[起始页] 安装完成，schemaVersion =', SCHEMA_VERSION);
    }
  });

  registerBookmarkWatchers();

  // ── 消息路由 ──
  // 页面需要时才请求，SW 只做转发，不持有业务状态
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string })?.type;

    switch (type) {
      case 'ping':
        sendResponse({ ok: true, schemaVersion: SCHEMA_VERSION });
        return false;

      case 'bookmarks:permission':
        // 让页面知道书签权限是否可用，用于渲染授权引导
        sendResponse({ ok: Boolean(chrome.bookmarks) });
        return false;

      default:
        return false;
    }
  });
});
