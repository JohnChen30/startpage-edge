/**
 * 搜索引擎 store
 *
 * 引擎列表可以增删排序，但必须始终存在至少 1 个引擎，
 * 且 defaultEngineId 必须指向已存在的引擎。
 */
import { createStore } from 'zustand/vanilla';
import {
  BUILTIN_ENGINE_SYNC_VERSION,
  BUILTIN_ENGINES,
  DEFAULT_ENGINE_ID,
  ENGINE_LIMITS,
  STORAGE_KEYS,
} from '../lib/defaults';
import { readRaw, subscribeKey, writeRaw } from '../lib/storage';
import {
  assignOrder,
  dedupeByUrl,
  isEngineArray,
  isFiniteNumber,
  isValidUrlTemplate,
  migrateEngines,
  reindexOrder,
} from '../lib/validate';
import { settingsStore } from './settings';
import type { Result, SearchEngine } from '../types';

export interface EnginesState {
  engines: SearchEngine[];
  ready: boolean;
  init(): Promise<void>;
  current(): SearchEngine | undefined;
  byId(id: string): SearchEngine | undefined;
  add(input: {
    name: string;
    urlTemplate: string;
    icon?: string;
  }): Promise<Result<SearchEngine>>;
  update(
    id: string,
    patch: Partial<Pick<SearchEngine, 'name' | 'urlTemplate' | 'icon'>>,
  ): Promise<Result<void>>;
  remove(id: string): Promise<Result<void>>;
  move(id: string, direction: -1 | 1): Promise<void>;
  reorder(orderedIds: string[]): Promise<void>;
  setDefault(id: string): Promise<void>;
  reset(): Promise<void>;
  applyFromStorage(raw: unknown): void;
}

function persist(engines: SearchEngine[]): Promise<unknown> {
  // 传入数组已是期望顺序，按下标赋 order
  return writeRaw('sync', STORAGE_KEYS.engines, assignOrder(engines));
}

/**
 * 把当前内置引擎的最新定义同步进已有列表。
 *
 * 规则：
 *   · 已存在的内置引擎（builtin === true）
 *       → 刷新 urlTemplate 与 icon；**保留**用户改过的名称与自定义排序。
 *   · 代码里已下线、但用户列表里还留着的内置引擎
 *       → 移除（判定依据是 builtin === true 且 id 不在 BUILTIN_ENGINES 里）。
 *   · 列表中缺失的内置引擎 → 追加到末尾。
 *   · 用户自建的引擎（id 为 custom-*，builtin 非 true）→ 完全不动。
 *
 * 为什么要刷新 / 移除而不是「只补缺失」：上一版只做追加，结果改了内置引擎的
 * URL 模板后老用户看不到新值，下线了引擎也删不掉 —— 改了等于没改。
 */
function syncBuiltins(list: SearchEngine[]): SearchEngine[] {
  const def = new Map(BUILTIN_ENGINES.map((e) => [e.id, e]));
  let changed = false;

  const kept: SearchEngine[] = [];
  for (const e of list) {
    const latest = e.builtin ? def.get(e.id) : undefined;

    // 内置引擎但代码里已下线 → 丢弃
    if (e.builtin && !latest) {
      changed = true;
      continue;
    }

    if (!latest) {
      kept.push(e); // 用户自建引擎，原样保留
      continue;
    }

    if (e.urlTemplate === latest.urlTemplate && e.icon === latest.icon) {
      kept.push(e);
      continue;
    }
    changed = true;
    kept.push({ ...e, urlTemplate: latest.urlTemplate, icon: latest.icon });
  }

  const have = new Set(kept.map((e) => e.id));
  const missing = BUILTIN_ENGINES.filter((e) => !have.has(e.id)).map((e) =>
    structuredClone(e),
  );
  if (missing.length) changed = true;

  // 未发生任何变化时原样返回，避免无意义地整表写回 storage
  return changed ? assignOrder([...kept, ...missing]) : list;
}

export const enginesStore = createStore<EnginesState>((set, get) => ({
  engines: structuredClone(BUILTIN_ENGINES),
  ready: false,

  async init() {
    const raw = await readRaw<unknown>('sync', STORAGE_KEYS.engines);
    const loaded = isEngineArray(raw)
      ? raw
      : (migrateEngines(raw) ?? structuredClone(BUILTIN_ENGINES));

    // ── 内置引擎同步 ──
    // 老用户 storage 里是旧版引擎表，格式合法就会被原样采用，
    // 因此新增引擎、以及改动已有内置引擎的 URL / Logo 都不会自动生效。
    // 用版本号做一次性同步（见 defaults.ts 的 BUILTIN_ENGINE_SYNC_VERSION）。
    const syncedVersion = await readRaw<number>('sync', STORAGE_KEYS.builtinEngines);
    const needSync =
      !isFiniteNumber(syncedVersion) || syncedVersion < BUILTIN_ENGINE_SYNC_VERSION;
    const base = reindexOrder(loaded);
    const engines = needSync ? syncBuiltins(base) : base;

    set({ engines, ready: true });

    if (needSync) {
      // 先落版本号：万一 persist 抛异常（例如配额超限），下一轮启动
      // 也只是重跑一次幂等的同步，不会把列表改坏。
      await writeRaw('sync', STORAGE_KEYS.builtinEngines, BUILTIN_ENGINE_SYNC_VERSION);
      await persist(engines);
    }

    // 修正悬空的 defaultEngineId
    const settings = settingsStore.getState().settings;
    if (!get().byId(settings.defaultEngineId)) {
      await settingsStore
        .getState()
        .setDefaultEngine(get().engines[0]?.id ?? DEFAULT_ENGINE_ID);
    }
  },

  current() {
    const { settings } = settingsStore.getState();
    return get().byId(settings.defaultEngineId) ?? get().engines[0];
  },

  byId(id) {
    return get().engines.find((e) => e.id === id);
  },

  async add(input) {
    const name = input.name.trim();
    const template = input.urlTemplate.trim();
    if (!name) return { ok: false, error: '名称不能为空' };
    if (!isValidUrlTemplate(template)) {
      return { ok: false, error: 'URL 模板必须包含 %s 且为 http(s) 地址' };
    }
    if (get().engines.length >= ENGINE_LIMITS.max) {
      return { ok: false, error: `最多只能添加 ${ENGINE_LIMITS.max} 个引擎` };
    }
    // 同名或同模板视为重复
    if (get().engines.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: `已存在同名引擎「${name}」` };
    }
    if (get().engines.some((e) => e.urlTemplate === template)) {
      return { ok: false, error: '已存在使用相同 URL 模板的引擎' };
    }

    const engine: SearchEngine = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      urlTemplate: template,
      icon: input.icon || 'globe',
      order: get().engines.length,
    };
    const engines = [...get().engines, engine];
    set({ engines });
    await persist(engines);
    return { ok: true, value: engine };
  },

  async update(id, patch) {
    const target = get().byId(id);
    if (!target) return { ok: false, error: '引擎不存在' };
    if (patch.urlTemplate !== undefined) {
      if (!isValidUrlTemplate(patch.urlTemplate)) {
        return { ok: false, error: 'URL 模板必须包含 %s 且为 http(s) 地址' };
      }
      const dup = get().engines.some(
        (e) => e.id !== id && e.urlTemplate === patch.urlTemplate,
      );
      if (dup) return { ok: false, error: '已存在使用相同 URL 模板的引擎' };
    }
    const engines = get().engines.map((e) => (e.id === id ? { ...e, ...patch } : e));
    set({ engines });
    await persist(engines);
    return { ok: true, value: undefined };
  },

  async remove(id) {
    if (get().engines.length <= ENGINE_LIMITS.min) {
      return { ok: false, error: '至少需要保留 1 个搜索引擎' };
    }
    const engines = get().engines.filter((e) => e.id !== id);
    set({ engines: reindexOrder(engines) });
    await persist(get().engines);

    // 删掉的是当前默认引擎，顺移到第一个
    if (settingsStore.getState().settings.defaultEngineId === id) {
      await settingsStore.getState().setDefaultEngine(get().engines[0].id);
    }
    return { ok: true, value: undefined };
  },

  async move(id, direction) {
    const sorted = [...get().engines].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((e) => e.id === id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    // 交换后数组顺序即期望顺序，按下标重赋 order
    [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
    set({ engines: assignOrder(sorted) });
    await persist(get().engines);
  },

  async reorder(orderedIds) {
    const map = new Map(get().engines.map((e) => [e.id, e]));
    const engines = orderedIds
      .map((id) => map.get(id))
      .filter((e): e is SearchEngine => Boolean(e));
    for (const e of get().engines) {
      if (!orderedIds.includes(e.id)) engines.push(e);
    }
    set({ engines: assignOrder(engines) });
    await persist(get().engines);
  },

  async setDefault(id) {
    if (!get().byId(id)) return;
    await settingsStore.getState().setDefaultEngine(id);
  },

  async reset() {
    set({ engines: structuredClone(BUILTIN_ENGINES) });
    await persist(get().engines);
    await settingsStore.getState().setDefaultEngine(DEFAULT_ENGINE_ID);
  },

  applyFromStorage(raw) {
    if (isEngineArray(raw)) set({ engines: reindexOrder(raw) });
  },
}));

export function watchEngines(): () => void {
  return subscribeKey(STORAGE_KEYS.engines, (value) => {
    enginesStore.getState().applyFromStorage(value);
  });
}

export { dedupeByUrl };
