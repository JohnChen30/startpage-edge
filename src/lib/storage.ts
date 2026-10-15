/**
 * 存储层 —— chrome.storage 统一封装
 *
 * 设计要点：
 * 1. 同步 / 本地两条通道，读写都带 schema 校验与默认值兜底。
 * 2. 多窗口同步：监听 chrome.storage.onChanged，把变更广播给所有订阅者。
 * 3. 权限降级：非扩展环境（如 Vitest / 纯网页预览）自动回退到内存实现，
 *    保证同一份代码在测试和开发预览下都能跑。
 */
import { STORAGE_KEYS } from './defaults';
import type { Result } from '../types';

// ── 运行时探测 ──────────────────────────────────────────────

interface ChromeLike {
  storage?: {
    sync?: chrome.storage.StorageArea;
    local?: chrome.storage.StorageArea;
    onChanged?: {
      addListener: (
        cb: (
          changes: Record<string, chrome.storage.StorageChange>,
          area: string,
        ) => void,
      ) => void;
      removeListener: (
        cb: (
          changes: Record<string, chrome.storage.StorageChange>,
          area: string,
        ) => void,
      ) => void;
    };
  };
}

const g = globalThis as unknown as { chrome?: ChromeLike; browser?: ChromeLike };

export function getChrome(): ChromeLike | undefined {
  return g.chrome ?? g.browser;
}

export type StorageAreaName = 'sync' | 'local';

/** 是否运行在真实扩展环境 */
export function hasExtensionStorage(area: StorageAreaName): boolean {
  return Boolean(getChrome()?.storage?.[area]);
}

// ── 内存回退实现 ────────────────────────────────────────────

const memory: Record<StorageAreaName, Map<string, unknown>> = {
  sync: new Map(),
  local: new Map(),
};

type ChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: StorageAreaName,
) => void;

const listeners = new Set<ChangeListener>();
let nativeListenerAttached = false;

/** 让内存回退也能触发 onChanged，便于本地预览时验证多窗口同步 */
function emit(
  changes: ChangeListener extends (c: infer C, a: never) => void ? C : never,
  area: StorageAreaName,
) {
  for (const cb of listeners) cb(changes, area);
}

function attachNativeListener(): void {
  if (nativeListenerAttached) return;
  const onChanged = getChrome()?.storage?.onChanged;
  if (!onChanged) return;
  onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    for (const cb of listeners) cb(changes, area);
  });
  nativeListenerAttached = true;
}

// ── 基础读写 ────────────────────────────────────────────────

function areaOf(name: StorageAreaName): chrome.storage.StorageArea | undefined {
  return getChrome()?.storage?.[name];
}

export async function readRaw<T>(
  area: StorageAreaName,
  key: string,
): Promise<T | undefined> {
  const native = areaOf(area);
  if (native) {
    const res = await native.get(key);
    return res?.[key] as T | undefined;
  }
  return memory[area].get(key) as T | undefined;
}

export async function writeRaw(
  area: StorageAreaName,
  key: string,
  value: unknown,
): Promise<void> {
  const native = areaOf(area);
  if (native) {
    await native.set({ [key]: value });
    return;
  }
  const oldValue = memory[area].get(key);
  memory[area].set(key, value);
  emit({ [key]: { oldValue, newValue: value } }, area);
}

export async function removeRaw(area: StorageAreaName, key: string): Promise<void> {
  const native = areaOf(area);
  if (native) {
    await native.remove(key);
    return;
  }
  const oldValue = memory[area].get(key);
  memory[area].delete(key);
  emit({ [key]: { oldValue, newValue: undefined } }, area);
}

/** 读取整个 area（用于导出） */
export async function readAllRaw(
  area: StorageAreaName,
): Promise<Record<string, unknown>> {
  const native = areaOf(area);
  if (native) return (await native.get(null)) as Record<string, unknown>;
  return Object.fromEntries(memory[area]);
}

// ── 带校验 / 兜底的读写 ─────────────────────────────────────

/**
 * 读一个键：命中且通过校验则返回值，否则回退默认值。
 * 任何异常都不抛给调用方 —— 起始页必须能打开。
 */
export async function readValidated<T>(
  area: StorageAreaName,
  key: string,
  fallback: T,
  validate: (raw: unknown) => raw is T,
  migrate?: (raw: unknown) => T | undefined,
): Promise<T> {
  try {
    const raw = await readRaw<unknown>(area, key);
    if (raw === undefined) return structuredCloneSafe(fallback);
    if (validate(raw)) return raw;
    const migrated = migrate?.(raw);
    if (migrated !== undefined) return migrated;
    console.warn(`[storage] 键 ${key} 校验失败，已回退默认值`);
    return structuredCloneSafe(fallback);
  } catch (err) {
    console.warn(`[storage] 读取 ${key} 失败`, err);
    return structuredCloneSafe(fallback);
  }
}

/** 写一个键，超配额时返回失败而不是抛异常 */
export async function writeChecked(
  area: StorageAreaName,
  key: string,
  value: unknown,
): Promise<Result<void>> {
  try {
    await writeRaw(area, key, value);
    return { ok: true, value: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知存储错误';
    return { ok: false, error: message };
  }
}

// ── 订阅 ────────────────────────────────────────────────────

/** 订阅某个键的跨窗口变化 */
export function subscribeKey(
  key: string,
  cb: (newValue: unknown, oldValue: unknown, area: StorageAreaName) => void,
): () => void {
  attachNativeListener();
  const listener: ChangeListener = (changes, area) => {
    const change = changes[key];
    if (!change) return;
    cb(change.newValue, change.oldValue, area);
  };
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 订阅多个键 */
export function subscribeKeys(
  keys: readonly string[],
  cb: (area: StorageAreaName, changedKeys: string[]) => void,
): () => void {
  attachNativeListener();
  const listener: ChangeListener = (changes, area) => {
    const hit = keys.filter((k) => k in changes);
    if (hit.length) cb(area, hit);
  };
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 测试用：清空内存回退与订阅 */
export function __resetStorageForTests(): void {
  for (const area of ['sync', 'local'] as const) memory[area].clear();
  listeners.clear();
  nativeListenerAttached = false;
}

// ── 小工具 ──────────────────────────────────────────────────

function structuredCloneSafe<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

/** 估算某个值序列化后占用字节数，用于配额提示 */
export function estimateBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

export { STORAGE_KEYS };
