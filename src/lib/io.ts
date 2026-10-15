/**
 * 设置导入 / 导出 —— 带版本号的 JSON Schema
 *
 * 关键约束：
 *   · 壁纸图片不写入 JSON，只导出参数；图片本体在 IndexedDB
 *   · 导入冲突策略：按 ID 覆盖，新 ID 追加，用户可选「合并 / 覆盖」
 *   · 格式校验失败必须给出精确提示，而不是静默失败
 */
import {
  DEFAULT_SECTION_ID,
  DEFAULT_SECTION_NAME,
  DEFAULT_SETTINGS,
  BUILTIN_ENGINES,
  BUILTIN_MODULES,
  STORAGE_KEYS,
} from './defaults';
import { readRaw, writeRaw, type StorageAreaName } from './storage';
import {
  isEngineArray,
  isModuleArray,
  isSectionArray,
  isSettings,
  isShortcutArray,
  migrateEngines,
  migrateSettings,
  migrateShortcuts,
  reindexOrder,
  validateImportBundle,
} from './validate';
import { sectionsStore } from '../stores/sections';
import {
  SCHEMA_VERSION,
  type ExportBundle,
  type ImportResult,
  type ImportStrategy,
  type ModuleConfig,
  type SearchEngine,
  type Section,
  type Settings,
  type Shortcut,
} from '../types';

// ── 读取当前状态 ────────────────────────────────────────────

async function readSettings(): Promise<Settings> {
  const raw = await readRaw<unknown>('sync', STORAGE_KEYS.settings);
  return isSettings(raw)
    ? raw
    : (migrateSettings(raw) ?? structuredClone(DEFAULT_SETTINGS));
}

async function readEngines(): Promise<SearchEngine[]> {
  const raw = await readRaw<unknown>('sync', STORAGE_KEYS.engines);
  return isEngineArray(raw)
    ? raw
    : (migrateEngines(raw) ?? structuredClone(BUILTIN_ENGINES));
}

async function readShortcuts(): Promise<Shortcut[]> {
  const raw = await readRaw<unknown>('local', STORAGE_KEYS.shortcuts);
  return isShortcutArray(raw) ? raw : (migrateShortcuts(raw) ?? []);
}

async function readModules(): Promise<ModuleConfig[]> {
  const raw = await readRaw<unknown>('sync', STORAGE_KEYS.modules);
  return isModuleArray(raw) && raw.length ? raw : structuredClone(BUILTIN_MODULES);
}

async function readSections(): Promise<Section[]> {
  const raw = await readRaw<unknown>('local', STORAGE_KEYS.sections);
  return isSectionArray(raw) ? raw : [];
}

// ── 导出 ────────────────────────────────────────────────────

export async function buildExportBundle(): Promise<ExportBundle> {
  const [settings, engines, shortcuts, modules, sections] = await Promise.all([
    readSettings(),
    readEngines(),
    readShortcuts(),
    readModules(),
    readSections(),
  ]);

  // 壁纸只导参数，剔除指向 IndexedDB 的 imageRef（图片本体无法跨设备复现）
  const exportSettings: Settings = {
    ...settings,
    wallpaper: { ...settings.wallpaper },
    // 导出时清掉本机 IndexedDB 引用，避免导入方引用到不存在的图片
    colors: { ...settings.colors },
  };
  if (exportSettings.wallpaper.type === 'image') {
    delete exportSettings.wallpaper.imageRef;
    exportSettings.wallpaper.type = 'solid';
  } else {
    // 非图片类型不留 IndexedDB 引用
    delete exportSettings.wallpaper.imageRef;
  }
  // 必应壁纸：只带「类型 + 当前选中的图片地址」，二进制与本机缓存都不写入
  if (exportSettings.wallpaper.type !== 'bing') {
    delete exportSettings.wallpaper.bingUrl;
  }
  // 「定妆日期」是本机当天的运行时状态，跨设备/跨天都没有意义 —— 不进导出文件。
  // 导入方在 init() 的迁移里会把它补成导入当天，于是导入后当天也不会被换掉。
  delete exportSettings.wallpaper.bingPickedOn;

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: exportSettings,
    engines,
    shortcuts,
    sections,
    modules,
  };
}

export async function exportToFile(filename?: string): Promise<void> {
  const bundle = await buildExportBundle();
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename ?? `startpage-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 导入 ────────────────────────────────────────────────────

export interface ParsedImport {
  ok: boolean;
  errors: string[];
  bundle?: ExportBundle;
}

/** 解析文件文本，先做结构校验再交给 applyImport */
export function parseImportText(text: string): ParsedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : '解析失败';
    return { ok: false, errors: [`JSON 解析失败：${message}`] };
  }

  const issues = validateImportBundle(raw);
  if (issues.length) {
    return {
      ok: false,
      errors: issues.map((i) => `${i.path}：${i.message}`),
    };
  }

  const obj = raw as Record<string, unknown>;
  const settings = isSettings(obj.settings)
    ? obj.settings
    : (migrateSettings(obj.settings) ?? structuredClone(DEFAULT_SETTINGS));

  return {
    ok: true,
    errors: [],
    bundle: {
      schemaVersion:
        typeof obj.schemaVersion === 'number' ? obj.schemaVersion : SCHEMA_VERSION,
      exportedAt:
        typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      settings,
      engines: isEngineArray(obj.engines) ? obj.engines : [],
      shortcuts: isShortcutArray(obj.shortcuts) ? obj.shortcuts : [],
      sections: isSectionArray(obj.sections) ? obj.sections : [],
      modules: isModuleArray(obj.modules) ? obj.modules : [],
    },
  };
}

/**
 * 保证默认分区存在，且每个快捷方式的 sectionId 都指向真实分区。
 * 缺失 sections（老文件）时自动创建默认分区并把所有快捷方式归入其中。
 */
function normalizeSectionsAndShortcuts(
  sections: Section[],
  shortcuts: Shortcut[],
): { sections: Section[]; shortcuts: Shortcut[] } {
  let secs = sections.length ? reindexOrder(sections) : [];
  if (!secs.some((s) => s.id === DEFAULT_SECTION_ID)) {
    secs = [...secs, { id: DEFAULT_SECTION_ID, name: DEFAULT_SECTION_NAME, order: secs.length }];
  }
  const ids = new Set(secs.map((s) => s.id));
  const fixedShortcuts = shortcuts.map((s) =>
    s.sectionId && ids.has(s.sectionId) ? s : { ...s, sectionId: DEFAULT_SECTION_ID },
  );
  return { sections: secs, shortcuts: fixedShortcuts };
}

/**
 * 应用导入。
 * merge     —— 同 ID 以文件为准覆盖，文件独有 ID 追加到末尾
 * overwrite —— 完全以文件为准，缺失的部分回退默认值
 */
export async function applyImport(
  bundle: ExportBundle,
  strategy: ImportStrategy,
): Promise<ImportResult> {
  const result: ImportResult = {
    ok: true,
    strategy,
    added: 0,
    replaced: 0,
    errors: [],
  };

  try {
    if (strategy === 'overwrite') {
      const settings = migrateSettings(bundle.settings) ?? DEFAULT_SETTINGS;
      const engines = bundle.engines.length
        ? reindexOrder(bundle.engines)
        : structuredClone(BUILTIN_ENGINES);
      const modules = bundle.modules.length
        ? bundle.modules
        : structuredClone(BUILTIN_MODULES);

      // 覆盖策略下也保证 defaultEngineId 指向存在的引擎
      settings.defaultEngineId = engines.some((e) => e.id === settings.defaultEngineId)
        ? settings.defaultEngineId
        : (engines[0]?.id ?? settings.defaultEngineId);

      // 分区：以文件为准，缺失默认分区则补建；快捷方式 sectionId 规整
      const { sections: outSections, shortcuts: outShortcuts } =
        normalizeSectionsAndShortcuts(bundle.sections, bundle.shortcuts);

      await Promise.all([
        writeRaw('sync', STORAGE_KEYS.settings, settings),
        writeRaw('sync', STORAGE_KEYS.engines, engines),
        writeRaw('sync', STORAGE_KEYS.modules, modules),
        writeRaw('local', STORAGE_KEYS.shortcuts, reindexOrder(outShortcuts)),
        writeRaw('local', STORAGE_KEYS.sections, outSections),
        writeRaw('sync', STORAGE_KEYS.schemaVersion, SCHEMA_VERSION),
      ]);

      result.added = outShortcuts.length;
      result.replaced = engines.length;
      return result;
    }

    // ── merge ──
    const [curSettings, curEngines, curShortcuts, curModules, curSections] = await Promise.all([
      readSettings(),
      readEngines(),
      readShortcuts(),
      readModules(),
      readSections(),
    ]);

    // 引擎
    const engineMap = new Map(curEngines.map((e) => [e.id, e]));
    for (const incoming of bundle.engines) {
      if (engineMap.has(incoming.id)) {
        engineMap.set(incoming.id, { ...engineMap.get(incoming.id)!, ...incoming });
        result.replaced++;
      } else {
        engineMap.set(incoming.id, incoming);
        result.added++;
      }
    }
    const mergedEngines = reindexOrder([...engineMap.values()]);

    // 快捷方式
    const shortcutMap = new Map(curShortcuts.map((s) => [s.id, s]));
    for (const incoming of bundle.shortcuts) {
      if (shortcutMap.has(incoming.id)) {
        shortcutMap.set(incoming.id, {
          ...shortcutMap.get(incoming.id)!,
          ...incoming,
        });
        result.replaced++;
      } else {
        // 新 ID 追加到末尾
        shortcutMap.set(incoming.id, {
          ...incoming,
          order: shortcutMap.size,
        });
        result.added++;
      }
    }
    const mergedShortcuts = reindexOrder([...shortcutMap.values()]);

    // 分区：以当前为底，文件同 ID 覆盖、新 ID 追加
    const sectionMap = new Map(curSections.map((s) => [s.id, s]));
    for (const incoming of bundle.sections) {
      if (sectionMap.has(incoming.id)) {
        sectionMap.set(incoming.id, { ...sectionMap.get(incoming.id)!, ...incoming });
        result.replaced++;
      } else {
        sectionMap.set(incoming.id, incoming);
        result.added++;
      }
    }
    const mergedSectionsRaw = [...sectionMap.values()];

    // 规整：补齐默认分区，修正指向不存在分区的快捷方式
    const { sections: mergedSections, shortcuts: mergedShortcutsFixed } =
      normalizeSectionsAndShortcuts(mergedSectionsRaw, mergedShortcuts);

    // 设置：以当前为底，用文件中的显式字段覆盖
    const incomingSettings = migrateSettings(bundle.settings);
    const mergedSettings: Settings = {
      ...curSettings,
      ...(incomingSettings ?? {}),
      modules: curSettings.modules,
      layout: curSettings.layout,
      defaultEngineId: mergedEngines.some(
        (e) => e.id === incomingSettings?.defaultEngineId,
      )
        ? incomingSettings!.defaultEngineId
        : curSettings.defaultEngineId,
    };

    // 模块
    const mergedModules = bundle.modules.length
      ? mergeModules(curModules, bundle.modules)
      : curModules;

    await Promise.all([
      writeRaw('sync', STORAGE_KEYS.settings, mergedSettings),
      writeRaw('sync', STORAGE_KEYS.engines, mergedEngines),
      writeRaw('sync', STORAGE_KEYS.modules, mergedModules),
      writeRaw('local', STORAGE_KEYS.shortcuts, reindexOrder(mergedShortcutsFixed)),
      writeRaw('local', STORAGE_KEYS.sections, mergedSections),
      writeRaw('sync', STORAGE_KEYS.schemaVersion, SCHEMA_VERSION),
    ]);

    return result;
  } catch (err) {
    result.ok = false;
    result.errors.push(
      err instanceof Error ? err.message : '写入存储失败，可能已超出配额',
    );
    return result;
  }
}

function mergeModules(
  current: ModuleConfig[],
  incoming: ModuleConfig[],
): ModuleConfig[] {
  const map = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) {
    map.set(m.id, { ...(map.get(m.id) ?? m), ...m });
  }
  return reindexOrder([...map.values()]);
}

/** 从 File 读取并解析 */
export async function importFromFile(file: File): Promise<ParsedImport> {
  if (file.size > 1024 * 1024) {
    return { ok: false, errors: ['文件超过 1MB，可能不是设置备份文件'] };
  }
  const text = await file.text();
  return parseImportText(text);
}

// ── 恢复默认 ────────────────────────────────────────────────

export async function resetAll(): Promise<void> {
  const areas: [StorageAreaName, string][] = [
    ['sync', STORAGE_KEYS.settings],
    ['sync', STORAGE_KEYS.engines],
    ['sync', STORAGE_KEYS.modules],
    ['sync', STORAGE_KEYS.layout],
    ['local', STORAGE_KEYS.shortcuts],
    ['local', STORAGE_KEYS.sections],
  ];
  await Promise.all(
    areas.map(async ([area, key]) => {
      const { removeRaw } = await import('./storage');
      await removeRaw(area, key);
    }),
  );
  await writeRaw('sync', STORAGE_KEYS.schemaVersion, SCHEMA_VERSION);
}
