<!--
  设置面板 —— 右侧滑出抽屉

  分类：外观 / 搜索 / 快捷方式 / 收藏夹 / 模块 / 数据
  包含：配色自定义、壁纸（纯色/图片/模糊/亮度/遮罩）、默认引擎、
        引擎增删排序与 URL 模板、快捷方式管理、模块显隐排序、
        预设布局切换、导入导出、恢复默认。
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';
  import { settingsStore, modulesStore } from '../stores/settings';
  import { enginesStore } from '../stores/engines';
  import { shortcutsStore } from '../stores/shortcuts';
  import { sectionsStore } from '../stores/sections';
  import { layoutStore } from '../stores/layout';
  import { uiStore, type SettingsTab } from '../stores/ui';
  import {
    DEFAULT_SECTION_ID,
    ENGINE_LIMITS,
    MODULE_META,
    MODULE_OFFSET_RANGE,
    OFFSET_MODULES,
    PRESET_LAYOUTS,
    SHORTCUT_LIMITS,
    SHORTCUT_SIZE_RANGE,
    UI_GLASS_BLUR_RANGE,
    UI_RADIUS_RANGE,
  } from '../lib/defaults';
  import { validateImageFile } from '../lib/validate';
  import {
    deleteWallpaper,
    estimateUsage,
    saveWallpaper,
    saveIcon,
  } from '../lib/indexeddb';
  import { applyImport, exportToFile, importFromFile, resetAll } from '../lib/io';
  import { downloadWallpaper } from '../lib/wallpaper';
  import { getBingStatus } from '../lib/bing';
  import type {
    ColorConfig,
    ImportStrategy,
    PresetLayout,
    SearchEngine,
  } from '../types';

  let tab = $state<SettingsTab>(uiStore.getState().settingsTab);
  let settings = $state(settingsStore.getState().settings);
  let colors = $state(settingsStore.getState().colors);
  let resolvedTheme = $state(settingsStore.getState().resolvedTheme);
  let modules = $state(modulesStore.getState().modules);
  let engines = $state(enginesStore.getState().engines);
  let shortcuts = $state(shortcutsStore.getState().shortcuts);
  let sections = $state(sectionsStore.getState().sections);
  let currentSectionId = $state(uiStore.getState().currentSectionId);
  let layout = $state(layoutStore.getState().layout);

  $effect(() => {
    const offs = [
      uiStore.subscribe((s) => {
        tab = s.settingsTab;
        currentSectionId = s.currentSectionId;
      }),
      settingsStore.subscribe((s) => {
        settings = s.settings;
        colors = s.colors;
        resolvedTheme = s.resolvedTheme;
      }),
      modulesStore.subscribe((s) => (modules = s.modules)),
      enginesStore.subscribe((s) => (s.engines, (engines = s.engines))),
      shortcutsStore.subscribe((s) => (shortcuts = s.shortcuts)),
      sectionsStore.subscribe((s) => (sections = s.sections)),
      layoutStore.subscribe((s) => (layout = s.layout)),
    ];
    return () => offs.forEach((o) => o());
  });

  let panelEl: HTMLDivElement | undefined;
  let usage = $state({ bytes: 0, quota: 0 });

  $effect(() => {
    void estimateUsage().then((u) => (usage = u));
  });

  // ── 关闭：Esc ──
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function close() {
    uiStore.getState().closeSettings();
  }

  // ── 外观：配色 ──

  // 只暴露两项：字体颜色与强调色。
  // 其余颜色（底色 / 线条 / 阴影 / 毛玻璃等）由主题按深浅模式自动派生，
  // 不再开放给用户编辑，以保证毛玻璃与立体质感始终协调。
  const colorFields: { key: keyof ColorConfig; label: string }[] = [
    { key: 'text', label: '字体颜色' },
    { key: 'accent', label: '强调色' },
  ];

  /** 颜色值可能是 rgba()，原生 color input 只认 hex —— 需转换 */
  function toHex(value: string): string {
    const v = value.trim();
    if (v.startsWith('#'))
      return v.length === 4 || v.length === 5 ? expandShortHex(v) : v.slice(0, 7);
    const m = v.match(/rgba?\(([^)]+)\)/i);
    if (!m) return '#000000';
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
    const [r, g, b] = parts;
    return (
      '#' +
      [r, g, b]
        .map((n) =>
          Math.max(0, Math.min(255, Math.round(n ?? 0)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }

  function expandShortHex(v: string): string {
    const h = v.slice(1);
    return (
      '#' +
      h
        .slice(0, 3)
        .split('')
        .map((c) => c + c)
        .join('')
    );
  }

  function isCustomized(key: keyof ColorConfig): boolean {
    return settings.colors?.[resolvedTheme]?.[key] !== undefined;
  }

  function resetOneColor(key: keyof ColorConfig) {
    const next = { ...(settings.colors?.[resolvedTheme] ?? {}) };
    delete next[key];
    void settingsStore.getState().patchColors({});
    // patchColors 是合并语义，这里直接覆写当前主题的整份覆盖
    void settingsStore.getState().patchSettings({
      colors: { ...settings.colors, [resolvedTheme]: next },
    });
  }

  // ── 外观：壁纸 ──
  let wallpaperInput: HTMLInputElement | undefined;
  let uploading = $state(false);

  function pickWallpaper() {
    wallpaperInput?.click();
  }

  async function onWallpaperChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const issues = validateImageFile(file);
    if (issues.length) {
      uiStore.getState().toast(issues[0].message, 'error');
      return;
    }

    uploading = true;
    try {
      const prevRef = settings.wallpaper.imageRef;
      const record = await saveWallpaper(file);
      await settingsStore.getState().patchWallpaper({
        type: 'image',
        imageRef: record.id,
      });
      // 清掉上一张，避免 IndexedDB 堆积
      if (prevRef && prevRef !== record.id) {
        await deleteWallpaper(prevRef).catch(() => {});
      }
      const kb = Math.round(record.bytes / 1024);
      uiStore
        .getState()
        .toast(
          `壁纸已应用（${record.width}×${record.height}，${kb}KB）`,
          'success',
          2200,
        );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '壁纸保存失败';
      uiStore.getState().toast(`${msg}，可能已超出存储配额`, 'error', 3400);
    } finally {
      uploading = false;
    }
  }

  async function clearWallpaper() {
    const ref = settings.wallpaper.imageRef;
    await settingsStore.getState().patchWallpaper({
      type: 'solid',
      imageRef: undefined,
    });
    if (ref) await deleteWallpaper(ref).catch(() => {});
  }

  // ── 壁纸：必应每日 / 下载 ──
  let bingBusy = $state(false);
  let downloading = $state(false);

  /** 切到必应壁纸；首次进入时顺带把「今天这张」取回来 */
  async function setWallpaperType(type: 'bing') {
    await settingsStore.getState().patchWallpaper({ type });
    void settingsStore.getState().ensureBingWallpaper();
  }

  async function shuffleBing() {
    if (bingBusy) return;
    bingBusy = true;
    try {
      const ok = await settingsStore.getState().shuffleBingWallpaper();
      if (!ok) {
        // 带出 lib/bing.ts 记录的真实原因（离线 / 权限 / 接口异常）
        const { error } = getBingStatus();
        uiStore
          .getState()
          .toast(
            error ? `必应壁纸没取到：${error}` : '必应壁纸没取到，请稍后重试',
            'error',
            3400,
          );
      }
    } finally {
      bingBusy = false;
    }
  }

  async function downloadCurrent() {
    if (downloading) return;
    downloading = true;
    try {
      const res = await downloadWallpaper(settings.wallpaper);
      if (!res.ok) {
        uiStore.getState().toast(res.error, 'error', 3000);
        return;
      }
      uiStore
        .getState()
        .toast(
          res.value === 'download' ? '壁纸已开始下载' : '已在新标签页打开原图',
          'success',
          2200,
        );
    } finally {
      downloading = false;
    }
  }

  // ── 搜索：引擎管理 ──
  let engineDialogOpen = $state(false);
  let engineDraft = $state<{ id?: string; name: string; urlTemplate: string }>({
    name: '',
    urlTemplate: '',
  });

  function beginEngineEdit(engine?: SearchEngine) {
    engineDraft = engine
      ? { id: engine.id, name: engine.name, urlTemplate: engine.urlTemplate }
      : { name: '', urlTemplate: '' };
    engineDialogOpen = true;
  }

  async function commitEngine() {
    const { id, name, urlTemplate } = engineDraft;
    const res = id
      ? await enginesStore.getState().update(id, { name, urlTemplate })
      : await enginesStore.getState().add({ name, urlTemplate });
    if (!res.ok) {
      uiStore.getState().toast(res.error, 'error');
      return;
    }
    engineDialogOpen = false;
  }

  async function removeEngine(engine: SearchEngine) {
    const res = await enginesStore.getState().remove(engine.id);
    if (!res.ok) uiStore.getState().toast(res.error, 'error');
  }

  /** 引擎自定义图标 */
  let engineIconInput: HTMLInputElement | undefined;
  let engineIconTarget = $state<SearchEngine | null>(null);

  function pickEngineIcon(engine: SearchEngine) {
    engineIconTarget = engine;
    engineIconInput?.click();
  }

  async function onEngineIconChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !engineIconTarget) return;

    const issues = validateImageFile(file);
    if (issues.length) {
      uiStore.getState().toast(issues[0].message, 'error');
      return;
    }
    try {
      const iconId = `engicon_${engineIconTarget.id}_${Date.now().toString(36)}`;
      await saveIcon(iconId, file);
      const res = await enginesStore
        .getState()
        .update(engineIconTarget.id, { icon: iconId });
      if (!res.ok) throw new Error(res.error);
      uiStore.getState().toast('引擎图标已更新', 'success', 1600);
    } catch (err) {
      uiStore
        .getState()
        .toast(err instanceof Error ? err.message : '图标保存失败', 'error');
    } finally {
      engineIconTarget = null;
    }
  }

  // ── 数据：导入导出 ──
  let importInput: HTMLInputElement | undefined;
  let pendingImport = $state<{
    text: string;
    errors: string[];
    parsed: Awaited<ReturnType<typeof importFromFile>>;
  } | null>(null);

  function pickImport() {
    importInput?.click();
  }

  async function onImportChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const parsed = await importFromFile(file);
    if (!parsed.ok) {
      uiStore.getState().toast(`导入失败：${parsed.errors[0]}`, 'error', 4200);
      pendingImport = { text: '', errors: parsed.errors, parsed };
      return;
    }
    pendingImport = { text: '', errors: [], parsed };
  }

  async function confirmImport(strategy: ImportStrategy) {
    if (!pendingImport?.parsed.ok || !pendingImport.parsed.bundle) return;
    const res = await applyImport(pendingImport.parsed.bundle, strategy);
    if (res.ok) {
      uiStore
        .getState()
        .toast(
          `导入完成：新增 ${res.added} 项，覆盖 ${res.replaced} 项`,
          'success',
          2800,
        );
      // 重新加载各 store 以反映新数据
      await Promise.all([
        settingsStore.getState().init(),
        modulesStore.getState().init(),
        enginesStore.getState().init(),
        shortcutsStore.getState().init(),
        layoutStore.getState().init(),
      ]);
    } else {
      uiStore.getState().toast(`导入失败：${res.errors[0]}`, 'error', 3600);
    }
    pendingImport = null;
  }

  async function doReset() {
    if (!confirm('确定恢复默认设置？快捷方式与配色将被清空，此操作不可撤销。')) return;
    await resetAll();
    await Promise.all([
      settingsStore.getState().init(),
      modulesStore.getState().init(),
      enginesStore.getState().init(),
      shortcutsStore.getState().init(),
      layoutStore.getState().init(),
    ]);
    uiStore.getState().toast('已恢复默认设置', 'success');
  }

  const TABS: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'appearance', label: '外观', icon: 'palette' },
    { id: 'search', label: '搜索', icon: 'search' },
    { id: 'shortcuts', label: '快捷方式', icon: 'grid' },
    { id: 'bookmarks', label: '收藏夹', icon: 'star' },
    { id: 'modules', label: '模块', icon: 'layout' in {} ? 'grid' : 'grid' },
    { id: 'data', label: '数据', icon: 'download' },
  ];

  const THEME_OPTIONS = [
    { id: 'system', label: '跟随系统', icon: 'monitor' },
    { id: 'light', label: '浅色', icon: 'sun' },
    { id: 'dark', label: '深色', icon: 'moon' },
  ] as const;

  const presets = Object.entries(PRESET_LAYOUTS) as [
    PresetLayout,
    { label: string; description: string },
  ][];

  const sortedModules = $derived([...modules].sort((a, b) => a.order - b.order));

  const sortedEngines = $derived([...engines].sort((a, b) => a.order - b.order));

  const sortedShortcuts = $derived([...shortcuts].sort((a, b) => a.order - b.order));

  function fmtBytes(n: number): string {
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  // ── 分区管理（设置 → 快捷方式）──
  async function renameSection(id: string, name: string) {
    const res = await sectionsStore.getState().rename(id, name);
    if (!res.ok) uiStore.getState().toast(res.error, 'error');
  }

  async function addSection() {
    const res = await sectionsStore.getState().add({ name: undefined });
    if (res.ok) {
      uiStore.getState().setCurrentSection(res.value.id);
      uiStore.getState().toast('已新建分区', 'success', 1600);
    } else {
      uiStore.getState().toast(res.error, 'error');
    }
  }

  async function deleteSection(id: string) {
    const sec = sections.find((s) => s.id === id);
    if (!sec) return;
    if (id === DEFAULT_SECTION_ID) {
      uiStore.getState().toast('默认分区不可删除', 'error');
      return;
    }
    const count = shortcuts.filter((s) => s.sectionId === id).length;
    const msg =
      count > 0
        ? `删除「${sec.name}」？其下 ${count} 个快捷方式将移入默认分区。`
        : `删除「${sec.name}」？`;
    if (!confirm(msg)) return;
    const res = await sectionsStore.getState().remove(id);
    if (!res.ok) {
      uiStore.getState().toast(res.error, 'error');
      return;
    }
    // 若删掉的是当前分区，回退到默认分区
    if (id === currentSectionId) {
      uiStore.getState().setCurrentSection(DEFAULT_SECTION_ID);
    }
    uiStore.getState().toast(`已删除「${sec.name}」`, 'success', 1600);
  }

  function moveSection(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    void sectionsStore.getState().reorder(index, target);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- 遮罩 -->
<div class="overlay" role="presentation" onclick={close}></div>

<div
  bind:this={panelEl}
  class="drawer glass"
  role="dialog"
  aria-modal="true"
  aria-label="设置"
>
  <!-- 头部 -->
  <header class="drawer__head">
    <h2 class="drawer__title">设置</h2>
    <button
      class="btn btn--ghost btn--icon"
      type="button"
      aria-label="关闭设置"
      onclick={close}
    >
      <SvgIcon name="close" size={16} />
    </button>
  </header>

  <div class="drawer__main">
    <!-- 分类导航 -->
    <nav class="drawer__nav" aria-label="设置分类">
      {#each TABS as t (t.id)}
        <button
          class="nav-item"
          class:nav-item--active={tab === t.id}
          type="button"
          aria-current={tab === t.id ? 'page' : undefined}
          onclick={() => uiStore.getState().setSettingsTab(t.id)}
        >
          <SvgIcon name={t.icon} size={15} />
          <span>{t.label}</span>
        </button>
      {/each}
    </nav>

    <!-- 内容区 -->
    <div class="drawer__body scroll-area">
      {#if tab === 'appearance'}
        <section class="group">
          <h3 class="group__title">主题</h3>
          <div class="segmented" role="radiogroup" aria-label="主题模式">
            {#each THEME_OPTIONS as opt (opt.id)}
              <button
                class="segmented__item"
                class:segmented__item--active={settings.theme === opt.id}
                type="button"
                role="radio"
                aria-checked={settings.theme === opt.id}
                onclick={() => settingsStore.getState().setTheme(opt.id)}
              >
                <SvgIcon name={opt.icon} size={14} />
                <span>{opt.label}</span>
              </button>
            {/each}
          </div>
          <p class="hint">
            当前生效：{resolvedTheme === 'dark'
              ? '深色'
              : '浅色'}。配色改动只作用于当前生效的主题。
          </p>
        </section>

        <section class="group">
          <h3 class="group__title">
            <span>配色</span>
            <button
              class="btn btn--ghost btn--sm"
              type="button"
              onclick={() => settingsStore.getState().resetColors()}
              >恢复默认配色</button
            >
          </h3>
          <div class="colors">
            {#each colorFields as f (f.key)}
              <label class="color-field">
                <span class="color-field__label">{f.label}</span>
                <span class="color-field__controls">
                  <input
                    class="color-field__picker"
                    type="color"
                    value={toHex(colors[f.key])}
                    aria-label={`${f.label}颜色`}
                    oninput={(e) =>
                      settingsStore
                        .getState()
                        .patchColors({
                          [f.key]: (e.target as HTMLInputElement).value,
                        } as Partial<ColorConfig>)}
                  />
                  <code class="color-field__value">{colors[f.key]}</code>
                  {#if isCustomized(f.key)}
                    <button
                      class="color-field__reset"
                      type="button"
                      aria-label={`把${f.label}恢复默认`}
                      title="恢复默认"
                      onclick={() => resetOneColor(f.key)}
                    >
                      <SvgIcon name="refresh" size={12} />
                    </button>
                  {/if}
                </span>
              </label>
            {/each}
          </div>
        </section>

        <section class="group">
          <h3 class="group__title">壁纸</h3>

          <div class="row">
            <span class="row__label">背景类型</span>
            <div class="segmented segmented--sm">
              <button
                class="segmented__item"
                class:segmented__item--active={settings.wallpaper.type === 'solid'}
                type="button"
                onclick={() =>
                  settingsStore.getState().patchWallpaper({ type: 'solid' })}
                >纯色</button
              >
              <button
                class="segmented__item"
                class:segmented__item--active={settings.wallpaper.type === 'bing'}
                type="button"
                title="每天自动更新的必应壁纸（可随机切换最近 8 天）"
                onclick={() => setWallpaperType('bing')}>必应每日</button
              >
              <button
                class="segmented__item"
                class:segmented__item--active={settings.wallpaper.type === 'image'}
                type="button"
                disabled={!settings.wallpaper.imageRef}
                title={
                  settings.wallpaper.imageRef
                    ? '使用导入的本地图片'
                    : '请先在下方导入一张图片'
                }
                onclick={() =>
                  settingsStore.getState().patchWallpaper({ type: 'image' })}
                >本地照片</button
              >
            </div>
          </div>

          {#if settings.wallpaper.type === 'bing'}
            <div class="row">
              <span class="row__label">必应壁纸</span>
              <div class="row__actions">
                <button
                  class="btn btn--ghost"
                  type="button"
                  disabled={bingBusy}
                  onclick={shuffleBing}
                >
                  <SvgIcon name="refresh" size={14} />
                  换一张
                </button>
              </div>
            </div>
            <p class="hint">
              随机取自最近 8 天的必应壁纸。左下角也有一个同样的快捷按钮。
            </p>
          {/if}

          {#if settings.wallpaper.type === 'solid'}
            <div class="row">
              <span class="row__label">纯色</span>
              <input
                class="color-field__picker"
                type="color"
                value={settings.wallpaper.color ?? '#0d0f14'}
                aria-label="壁纸底色"
                oninput={(e) =>
                  settingsStore
                    .getState()
                    .patchWallpaper({ color: (e.target as HTMLInputElement).value })}
              />
            </div>
          {/if}

          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">导入图片</span>
              <span class="row__sub">jpg / png / webp，最大 5MB，自动缩放到 2560px</span
              >
            </div>
            <div class="row__actions">
              <button
                class="btn"
                type="button"
                onclick={pickWallpaper}
                disabled={uploading}
              >
                <SvgIcon name="image" size={14} />
                {uploading ? '处理中…' : '选择图片'}
              </button>
              {#if settings.wallpaper.imageRef}
                <button class="btn btn--ghost" type="button" onclick={clearWallpaper}>
                  移除
                </button>
              {/if}
            </div>
          </div>

          <!-- 下载当前壁纸原图：必应图直接下远程原图，本地图直接从 IndexedDB 取原始 blob -->
          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">下载当前壁纸</span>
              <span class="row__sub">
                {settings.wallpaper.type === 'bing'
                  ? '下载正在显示的必应壁纸原图（1920×1080）'
                  : settings.wallpaper.type === 'image'
                    ? '下载导入的本地原图（未经裁剪）'
                    : '纯色背景没有可下载的图片'}
              </span>
            </div>
            <div class="row__actions">
              <button
                class="btn"
                type="button"
                disabled={downloading || settings.wallpaper.type === 'solid'}
                onclick={() => void downloadCurrent()}
              >
                <SvgIcon name="download" size={14} />
                {downloading ? '准备中…' : '下载壁纸'}
              </button>
            </div>
          </div>

          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">模糊程度</span>
              <span class="row__value">{settings.wallpaper.blur}px</span>
            </div>
            <input
              class="slider"
              type="range"
              min="0"
              max="20"
              step="1"
              value={settings.wallpaper.blur}
              aria-label="壁纸模糊程度"
              oninput={(e) =>
                settingsStore
                  .getState()
                  .patchWallpaper({
                    blur: Number((e.target as HTMLInputElement).value),
                  })}
            />
          </div>

          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">亮度</span>
              <span class="row__value">{settings.wallpaper.brightness}%</span>
            </div>
            <input
              class="slider"
              type="range"
              min="0"
              max="100"
              step="1"
              value={settings.wallpaper.brightness}
              aria-label="壁纸亮度"
              oninput={(e) =>
                settingsStore
                  .getState()
                  .patchWallpaper({
                    brightness: Number((e.target as HTMLInputElement).value),
                  })}
            />
          </div>

          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">遮罩透明度</span>
              <span class="row__value">{settings.wallpaper.maskOpacity}%</span>
            </div>
            <input
              class="slider"
              type="range"
              min="0"
              max="80"
              step="1"
              value={settings.wallpaper.maskOpacity}
              aria-label="壁纸遮罩透明度"
              oninput={(e) =>
                settingsStore
                  .getState()
                  .patchWallpaper({
                    maskOpacity: Number((e.target as HTMLInputElement).value),
                  })}
            />
          </div>
        </section>

        <!-- 全局圆角：一处调节，搜索卡片 / 快捷方式 / 毛玻璃浮层一起变 -->
        <section class="group">
          <h3 class="group__title">圆角</h3>
          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">圆角大小</span>
              <span class="row__value"
                >{Math.round(settings.uiRadiusScale * 100)}%</span
              >
            </div>
            <input
              class="slider"
              type="range"
              min={UI_RADIUS_RANGE.min}
              max={UI_RADIUS_RANGE.max}
              step={UI_RADIUS_RANGE.step}
              value={settings.uiRadiusScale}
              aria-label="全局圆角大小"
              oninput={(e) =>
                settingsStore
                  .getState()
                  .setUiRadiusScale(Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <p class="hint">
            统一调整搜索卡片、快捷方式与毛玻璃浮层的圆角；100% 为默认。
          </p>
        </section>

        <!-- 全局毛玻璃模糊度：一处调节，所有玻璃模块一起变厚 / 变薄 -->
        <section class="group">
          <h3 class="group__title">毛玻璃</h3>
          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">模糊程度</span>
              <span class="row__value">{settings.uiGlassBlur}px</span>
            </div>
            <input
              class="slider"
              type="range"
              min={UI_GLASS_BLUR_RANGE.min}
              max={UI_GLASS_BLUR_RANGE.max}
              step={UI_GLASS_BLUR_RANGE.step}
              value={settings.uiGlassBlur}
              aria-label="全局毛玻璃模糊程度"
              oninput={(e) =>
                settingsStore
                  .getState()
                  .setUiGlassBlur(Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <p class="hint">
            一根滑块统一调整**全部**毛玻璃：快捷方式底板、搜索卡片、收藏夹弹窗、
            设置抽屉、搜索下拉，取的都是同一个值；18px 为默认。
            值越大，模糊越深、玻璃底色也越「奶」（磨砂感更强）——
            所以即使壁纸很平（纯色 / 雾气 / 大片虚化）也能看出明显变化。
            调到 0 即回到最通透的样子。
          </p>
        </section>

        <!-- 模块纵向位置：每个模块各一个滑块，互不干扰 -->
        <section class="group">
          <h3 class="group__title">模块纵向位置</h3>
          {#each OFFSET_MODULES as mod (mod.key)}
            <div class="row row--stack">
              <div class="row__head">
                <span class="row__label">{mod.label}</span>
                <span class="row__value">
                  {settings[mod.key] > 0 ? '+' : ''}{settings[mod.key]}px
                </span>
              </div>
              <input
                class="slider"
                type="range"
                min={MODULE_OFFSET_RANGE.min}
                max={MODULE_OFFSET_RANGE.max}
                step={MODULE_OFFSET_RANGE.step}
                value={settings[mod.key]}
                aria-label={`${mod.label}的纵向位置`}
                oninput={(e) =>
                  settingsStore
                    .getState()
                    .setModuleOffset(
                      mod.key,
                      Number((e.target as HTMLInputElement).value),
                    )}
              />
              <p class="hint">{mod.description}</p>
            </div>
          {/each}
          <p class="hint">
            负数向上、正数向下，0px 为默认（回到预设布局排好的位置）。
            只移动自己，其它模块不受影响；因此调过头时两个模块可能重叠，
            需要严格不重叠请改用「模块」里的预设布局。
          </p>
        </section>

        <section class="group">
          <h3 class="group__title">快捷方式</h3>

          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">图标大小</span>
              <span class="row__value">{settings.shortcutSize}px</span>
            </div>
            <input
              class="slider"
              type="range"
              min={SHORTCUT_SIZE_RANGE.min}
              max={SHORTCUT_SIZE_RANGE.max}
              step={SHORTCUT_SIZE_RANGE.step}
              value={settings.shortcutSize}
              aria-label="快捷方式图标大小"
              oninput={(e) =>
                settingsStore
                  .getState()
                  .setShortcutSize(Number((e.target as HTMLInputElement).value))}
            />
          </div>

          <div class="row">
            <span class="row__label">显示名字</span>
            <button
              class="switch"
              class:switch--on={settings.shortcutShowNames}
              data-on={settings.shortcutShowNames}
              type="button"
              role="switch"
              aria-checked={settings.shortcutShowNames}
              aria-label="显示快捷方式名字"
              onclick={() =>
                settingsStore
                  .getState()
                  .setShortcutShowNames(!settings.shortcutShowNames)}
            ></button>
          </div>
          <p class="hint">关闭后所有快捷方式只显示图标，界面更干净。</p>
        </section>
      {:else if tab === 'search'}
        <section class="group">
          <h3 class="group__title">默认搜索引擎</h3>
          <div class="engine-picker">
            {#each sortedEngines as engine (engine.id)}
              <button
                class="engine-chip"
                class:engine-chip--active={settings.defaultEngineId === engine.id}
                type="button"
                onclick={() => enginesStore.getState().setDefault(engine.id)}
              >
                {#if settings.defaultEngineId === engine.id}
                  <SvgIcon name="check" size={11} />
                {/if}
                <span>{engine.name}</span>
              </button>
            {/each}
          </div>
          <p class="hint">回车时使用默认引擎搜索。</p>
        </section>

        <section class="group">
          <h3 class="group__title">
            <span>搜索引擎管理</span>
            <button
              class="btn btn--ghost btn--sm"
              type="button"
              onclick={() => enginesStore.getState().reset()}>恢复内置引擎</button
            >
          </h3>

          <ul class="list-rows">
            {#each sortedEngines as engine, i (engine.id)}
              <li class="list-row">
                <span class="list-row__index">{i + 1}</span>
                <span class="list-row__main">
                  <span class="list-row__title">
                    {engine.name}
                    {#if engine.builtin}<em class="tag">内置</em>{/if}
                  </span>
                  <code class="list-row__sub">{engine.urlTemplate}</code>
                </span>
                <span class="list-row__ops">
                  <button
                    class="mini-btn"
                    type="button"
                    aria-label="上移"
                    disabled={i === 0}
                    onclick={() => enginesStore.getState().move(engine.id, -1)}
                    ><SvgIcon name="arrow-up" size={12} /></button
                  >
                  <button
                    class="mini-btn"
                    type="button"
                    aria-label="下移"
                    disabled={i === sortedEngines.length - 1}
                    onclick={() => enginesStore.getState().move(engine.id, 1)}
                    ><SvgIcon name="arrow-down" size={12} /></button
                  >
                  <button
                    class="mini-btn"
                    type="button"
                    aria-label="更换图标"
                    title="更换图标"
                    onclick={() => pickEngineIcon(engine)}
                    ><SvgIcon name="image" size={12} /></button
                  >
                  <button
                    class="mini-btn"
                    type="button"
                    aria-label="编辑"
                    onclick={() => beginEngineEdit(engine)}
                    ><SvgIcon name="edit" size={12} /></button
                  >
                  <button
                    class="mini-btn mini-btn--danger"
                    type="button"
                    aria-label="删除"
                    disabled={sortedEngines.length <= ENGINE_LIMITS.min}
                    onclick={() => removeEngine(engine)}
                    ><SvgIcon name="trash" size={12} /></button
                  >
                </span>
              </li>
            {/each}
          </ul>

          <button
            class="btn btn--primary"
            type="button"
            disabled={sortedEngines.length >= ENGINE_LIMITS.max}
            onclick={() => beginEngineEdit()}
          >
            <SvgIcon name="plus" size={14} />
            添加搜索引擎
          </button>
        </section>

        <section class="group">
          <h3 class="group__title">搜索推荐</h3>
          <div class="row">
            <span class="row__label">
              启用本地推荐
              <span class="row__sub"
                >只匹配本地收藏与快捷方式，不联网、不上传搜索词</span
              >
            </span>
            <button
              class="switch"
              class:switch--on={settings.suggestEnabled}
              data-on={settings.suggestEnabled}
              type="button"
              role="switch"
              aria-checked={settings.suggestEnabled}
              aria-label="启用本地搜索推荐"
              onclick={() =>
                settingsStore.getState().setSuggestEnabled(!settings.suggestEnabled)}
            ></button>
          </div>

          <div class="row row--stack">
            <div class="row__head">
              <span class="row__label">推荐防抖延迟</span>
              <span class="row__value">{settings.suggestDebounce}ms</span>
            </div>
            <input
              class="slider"
              type="range"
              min="150"
              max="250"
              step="10"
              value={settings.suggestDebounce}
              aria-label="推荐防抖延迟"
              oninput={(e) =>
                settingsStore
                  .getState()
                  .setSuggestDebounce(Number((e.target as HTMLInputElement).value))}
            />
          </div>
        </section>
      {:else if tab === 'shortcuts'}
        <section class="group">
          <h3 class="group__title">
            <span>分区管理</span>
            <button class="btn btn--ghost btn--sm" type="button" onclick={addSection}
              >新建分区</button
            >
          </h3>
          <ul class="list-rows">
            {#each sections as sec, i (sec.id)}
              <li class="list-row">
                <span class="list-row__index">{i + 1}</span>
                <span class="list-row__main">
                  <input
                    class="section-name-input"
                    type="text"
                    value={sec.name}
                    disabled={sec.id === DEFAULT_SECTION_ID}
                    maxlength={32}
                    aria-label={`分区名称 ${sec.name}`}
                    onchange={(e) => renameSection(sec.id, e.currentTarget.value)}
                  />
                </span>
                <span class="list-row__ops">
                  <button
                    class="mini-btn"
                    type="button"
                    aria-label="上移"
                    disabled={i === 0}
                    onclick={() => moveSection(i, -1)}
                    ><SvgIcon name="arrow-up" size={12} /></button
                  >
                  <button
                    class="mini-btn"
                    type="button"
                    aria-label="下移"
                    disabled={i === sections.length - 1}
                    onclick={() => moveSection(i, 1)}
                    ><SvgIcon name="arrow-down" size={12} /></button
                  >
                  <button
                    class="mini-btn mini-btn--danger"
                    type="button"
                    aria-label="删除"
                    disabled={sec.id === DEFAULT_SECTION_ID}
                    onclick={() => deleteSection(sec.id)}
                    ><SvgIcon name="trash" size={12} /></button
                  >
                </span>
              </li>
            {/each}
          </ul>
          <p class="hint">
            默认分区不可删除、不可改名。删除其它分区时，其下的快捷方式会移入默认分区。
          </p>
        </section>

        <section class="group">
          <h3 class="group__title">
            <span>快捷方式（{sortedShortcuts.length}/{SHORTCUT_LIMITS.max}）</span>
            {#if sortedShortcuts.length}
              <button
                class="btn btn--ghost btn--sm"
                type="button"
                onclick={() => {
                  if (confirm('清空所有快捷方式？'))
                    void shortcutsStore.getState().clear();
                }}>清空</button
              >
            {/if}
          </h3>

          {#if sortedShortcuts.length === 0}
            <p class="hint">
              还没有快捷方式。在起始页空白处右键选「添加快捷方式」，或从收藏夹导入。
            </p>
          {:else}
            <ul class="list-rows">
              {#each sortedShortcuts as sc, i (sc.id)}
                <li class="list-row">
                  <span class="list-row__index">{i + 1}</span>
                  <span class="list-row__main">
                    <span class="list-row__title">
                      {sc.name}
                      {#if sc.icon !== 'auto'}<em class="tag">自定义图标</em>{/if}
                    </span>
                    <code class="list-row__sub">{sc.url}</code>
                  </span>
                  <span class="list-row__ops">
                    <button
                      class="mini-btn"
                      type="button"
                      aria-label="上移"
                      disabled={i === 0}
                      onclick={() => shortcutsStore.getState().moveTo(i, i - 1)}
                      ><SvgIcon name="arrow-up" size={12} /></button
                    >
                    <button
                      class="mini-btn"
                      type="button"
                      aria-label="下移"
                      disabled={i === sortedShortcuts.length - 1}
                      onclick={() => shortcutsStore.getState().moveTo(i, i + 1)}
                      ><SvgIcon name="arrow-down" size={12} /></button
                    >
                    <button
                      class="mini-btn mini-btn--danger"
                      type="button"
                      aria-label="删除"
                      onclick={() => shortcutsStore.getState().remove(sc.id)}
                      ><SvgIcon name="trash" size={12} /></button
                    >
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {:else if tab === 'bookmarks'}
        <section class="group">
          <h3 class="group__title">收藏夹</h3>
          <div class="row row--stack">
            <p class="hint">
              扩展通过 <code>chrome.bookmarks</code> 只读显示你的收藏夹，不会修改、删除或上传任何书签。
              收藏夹以模态弹窗打开，可在其中逐个或批量导入为快捷方式。
            </p>
          </div>
          <div class="row__actions">
            <button
              class="btn"
              type="button"
              onclick={() => uiStore.getState().openBookmarks()}
            >
              <SvgIcon name="star" size={14} />
              打开收藏夹弹窗
            </button>
          </div>
        </section>

        <section class="group">
          <h3 class="group__title">隐私说明</h3>
          <ul class="bullets">
            <li>不收集搜索词</li>
            <li>不上传书签数据</li>
            <li>不劫持搜索、不修改默认搜索引擎</li>
            <li>不申请 host 权限，不读取任何网页内容</li>
          </ul>
        </section>
      {:else if tab === 'modules'}
        <section class="group">
          <h3 class="group__title">显示的模块</h3>
          <ul class="module-list">
            {#each sortedModules as mod, i (mod.id)}
              <li class="module-item">
                <button
                  class="switch"
                  class:switch--on={mod.visible}
                  data-on={mod.visible}
                  type="button"
                  role="switch"
                  aria-checked={mod.visible}
                  aria-label={`显示${MODULE_META[mod.type].label}`}
                  onclick={() => modulesStore.getState().toggle(mod.id)}
                ></button>
                <span class="module-item__main">
                  <span class="module-item__title">{MODULE_META[mod.type].label}</span>
                  <span class="module-item__sub"
                    >{MODULE_META[mod.type].description}</span
                  >
                </span>
                <span class="module-item__ops">
                  <button
                    class="mini-btn"
                    type="button"
                    aria-label="上移"
                    disabled={i === 0}
                    onclick={() => modulesStore.getState().move(mod.id, -1)}
                    ><SvgIcon name="arrow-up" size={12} /></button
                  >
                  <button
                    class="mini-btn"
                    type="button"
                    aria-label="下移"
                    disabled={i === sortedModules.length - 1}
                    onclick={() => modulesStore.getState().move(mod.id, 1)}
                    ><SvgIcon name="arrow-down" size={12} /></button
                  >
                </span>
              </li>
            {/each}
          </ul>
          <p class="hint">
            移除模块只是隐藏，数据会保留。设置按钮固定在右下角，不可移除。
          </p>
        </section>

        <section class="group">
          <h3 class="group__title">预设布局</h3>
          <div class="presets">
            {#each presets as [id, meta] (id)}
              <button
                class="preset"
                class:preset--active={layout.preset === id}
                type="button"
                aria-pressed={layout.preset === id}
                onclick={() => layoutStore.getState().setPreset(id)}
              >
                <span class="preset__preview preset__preview--{id}" aria-hidden="true">
                  <i></i><i></i><i></i>
                </span>
                <span class="preset__label">{meta.label}</span>
                <span class="preset__desc">{meta.description}</span>
              </button>
            {/each}
          </div>
        </section>

      {:else if tab === 'data'}
        <section class="group">
          <h3 class="group__title">导出设置</h3>
          <p class="hint">
            将设置、引擎、快捷方式、模块导出为带版本号的 JSON。 壁纸图片不写入
            JSON（只导出参数），因为图片保存在浏览器本地。
          </p>
          <button
            class="btn btn--primary"
            type="button"
            onclick={() => void exportToFile()}
          >
            <SvgIcon name="download" size={14} />
            导出 JSON
          </button>
        </section>

        <section class="group">
          <h3 class="group__title">导入设置</h3>
          <p class="hint">导入会先校验格式。冲突时按 ID 覆盖，新 ID 追加。</p>
          <button class="btn" type="button" onclick={pickImport}>
            <SvgIcon name="upload" size={14} />
            选择 JSON 文件
          </button>
        </section>

        <section class="group">
          <h3 class="group__title">存储占用</h3>
          <dl class="stats">
            <div class="stats__row">
              <dt>本地存储已用</dt>
              <dd>{fmtBytes(usage.bytes)}</dd>
            </div>
            <div class="stats__row">
              <dt>可用配额</dt>
              <dd>{fmtBytes(usage.quota)}</dd>
            </div>
            <div class="stats__row">
              <dt>快捷方式</dt>
              <dd>{sortedShortcuts.length} 项</dd>
            </div>
            <div class="stats__row">
              <dt>搜索引擎</dt>
              <dd>{sortedEngines.length} 项</dd>
            </div>
          </dl>
        </section>

        <section class="group group--danger">
          <h3 class="group__title">恢复默认</h3>
          <p class="hint">
            清空配色、壁纸参数、快捷方式与引擎自定义，回到初始状态。此操作不可撤销。
          </p>
          <button class="btn btn--danger" type="button" onclick={doReset}>
            <SvgIcon name="refresh" size={14} />
            恢复默认设置
          </button>
        </section>
      {/if}
    </div>
  </div>
</div>

<!-- 隐藏的输入控件 -->
<input
  bind:this={wallpaperInput}
  class="sr-only"
  type="file"
  accept="image/jpeg,image/png,image/webp"
  onchange={onWallpaperChosen}
/>
<input
  bind:this={engineIconInput}
  class="sr-only"
  type="file"
  accept="image/jpeg,image/png,image/webp"
  onchange={onEngineIconChosen}
/>
<input
  bind:this={importInput}
  class="sr-only"
  type="file"
  accept="application/json,.json"
  onchange={onImportChosen}
/>

<!-- 引擎编辑对话框 -->
{#if engineDialogOpen}
  <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="搜索引擎">
    <div class="sub-dialog__panel glass">
      <h3 class="sub-dialog__title">
        {engineDraft.id ? '编辑搜索引擎' : '添加搜索引擎'}
      </h3>
      <div class="field">
        <label class="field__label" for="eng-name">名称</label>
        <input id="eng-name" class="input" bind:value={engineDraft.name} type="text" />
      </div>
      <div class="field">
        <label class="field__label" for="eng-url">搜索 URL 模板（必须包含 %s）</label>
        <input
          id="eng-url"
          class="input"
          bind:value={engineDraft.urlTemplate}
          type="text"
          placeholder="https://example.com/search?q=%s"
        />
      </div>
      <p class="hint">%s 会被替换为经过 URL 编码的搜索词。</p>
      <div class="sub-dialog__actions">
        <button class="btn" type="button" onclick={() => (engineDialogOpen = false)}
          >取消</button
        >
        <button class="btn btn--primary" type="button" onclick={commitEngine}
          >保存</button
        >
      </div>
    </div>
  </div>
{/if}

<!-- 导入策略选择 -->
{#if pendingImport}
  <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="导入设置">
    <div class="sub-dialog__panel glass">
      {#if pendingImport.parsed.ok}
        <h3 class="sub-dialog__title">选择导入方式</h3>
        <p class="hint">
          文件校验通过，包含
          {pendingImport.parsed.bundle?.engines.length ?? 0} 个引擎、
          {pendingImport.parsed.bundle?.shortcuts.length ?? 0} 个快捷方式。
        </p>
        <ul class="bullets">
          <li><strong>合并</strong>：同 ID 以文件为准覆盖，新 ID 追加，现有数据保留</li>
          <li><strong>覆盖</strong>：完全以文件为准，当前设置被替换</li>
        </ul>
        <div class="sub-dialog__actions">
          <button class="btn" type="button" onclick={() => (pendingImport = null)}
            >取消</button
          >
          <button class="btn" type="button" onclick={() => confirmImport('merge')}
            >合并</button
          >
          <button
            class="btn btn--primary"
            type="button"
            onclick={() => confirmImport('overwrite')}
          >
            覆盖
          </button>
        </div>
      {:else}
        <h3 class="sub-dialog__title">
          <SvgIcon name="warning" size={15} /> 文件格式有问题
        </h3>
        <ul class="bullets bullets--error">
          {#each pendingImport.errors.slice(0, 8) as err, i (i)}
            <li>{err}</li>
          {/each}
        </ul>
        {#if pendingImport.errors.length > 8}
          <p class="hint">还有 {pendingImport.errors.length - 8} 条问题未显示。</p>
        {/if}
        <div class="sub-dialog__actions">
          <button
            class="btn btn--primary"
            type="button"
            onclick={() => (pendingImport = null)}
          >
            知道了
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ── 抽屉：右侧滑出 ── */
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-drawer);
    display: flex;
    flex-direction: column;
    width: min(680px, 92vw);
    border-radius: 0;
    border-right: none;
    border-top: none;
    border-bottom: none;
    box-shadow: -24px 0 60px -20px var(--shadow);
    animation: drawer-in var(--dur-slow) var(--ease-out);
  }

  @keyframes drawer-in {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .drawer__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--glass-border);
    flex: none;
  }

  .drawer__title {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .drawer__main {
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }

  @media (max-width: 620px) {
    .drawer__main {
      grid-template-columns: 1fr;
    }

    .drawer__nav {
      flex-direction: row;
      overflow-x: auto;
      border-right: none;
      border-bottom: 1px solid var(--line);
    }
  }

  /* ── 左侧分类导航 ── */
  .drawer__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    border-right: 1px solid var(--line);
    overflow-y: auto;
    flex: none;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    font-size: var(--fs-base);
    color: var(--text-secondary);
    text-align: left;
    white-space: nowrap;
    transition:
      color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .nav-item:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .nav-item--active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    font-weight: 500;
  }

  /* ── 内容区 ── */
  .drawer__body {
    padding: 16px 18px 40px;
    min-height: 0;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 20px;
  }

  .group:last-child {
    border-bottom: none;
    margin-bottom: 0;
  }

  .group--danger .group__title {
    color: #e5484d;
  }

  .group__title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .hint {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.65;
    color: var(--text-secondary);
  }

  .hint code {
    padding: 1px 5px;
    border-radius: 4px;
    font-size: var(--fs-xs);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  /* ── 通用行 ── */
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .row--stack {
    flex-direction: column;
    align-items: stretch;
    gap: 7px;
  }

  .row__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .row__label {
    font-size: var(--fs-sm);
    font-weight: 500;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row__sub {
    font-size: var(--fs-xs);
    font-weight: 400;
    color: var(--text-secondary);
  }

  .row__value {
    font-size: var(--fs-xs);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .row__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ── 分段控件 ── */
  .segmented {
    display: flex;
    gap: 3px;
    padding: 3px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
  }

  .segmented--sm {
    align-self: flex-start;
  }

  .segmented__item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: calc(var(--radius-md) - 3px);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    transition:
      color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
    white-space: nowrap;
  }

  .segmented__item:hover:not(:disabled) {
    color: var(--text);
  }

  .segmented__item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .segmented__item--active {
    color: var(--text);
    background: var(--glass-bg);
    box-shadow: 0 1px 3px var(--shadow);
    font-weight: 500;
  }

  /* ── 配色表 ── */
  .colors {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }

  .color-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    transition: border-color var(--dur-fast) var(--ease-soft);
  }

  .color-field:hover {
    border-color: var(--text-secondary);
  }

  .color-field__label {
    font-size: var(--fs-sm);
    white-space: nowrap;
  }

  .color-field__controls {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .color-field__picker {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
    flex: none;
  }

  .color-field__picker::-webkit-color-swatch-wrapper {
    padding: 2px;
  }

  .color-field__picker::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
  }

  .color-field__value {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    max-width: 74px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .color-field__reset {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: var(--text-secondary);
    flex: none;
  }

  .color-field__reset:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  /* ── 引擎选择 chip ── */
  .engine-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .engine-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    transition:
      color var(--dur-fast) var(--ease-soft),
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .engine-chip:hover {
    color: var(--text);
    border-color: var(--text-secondary);
  }

  .engine-chip--active {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 48%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    font-weight: 500;
  }

  /* ── 行列表 ── */
  .list-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .list-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    transition: border-color var(--dur-fast) var(--ease-soft);
  }

  .list-row:hover {
    border-color: var(--text-secondary);
  }

  .list-row__index {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: var(--fs-xs);
    flex: none;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text) 8%, transparent);
    font-variant-numeric: tabular-nums;
  }

  .list-row__main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .list-row__title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .list-row__sub {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  }

  .list-row__ops {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }

  .tag {
    padding: 1px 5px;
    border-radius: 4px;
    font-size: var(--fs-xs);
    font-style: normal;
    font-weight: 400;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text) 9%, transparent);
    flex: none;
  }

  .mini-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    transition:
      color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .mini-btn:hover:not(:disabled) {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .mini-btn--danger:hover:not(:disabled) {
    color: #e5484d;
    background: color-mix(in srgb, #e5484d 12%, transparent);
  }

  .mini-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* ── 模块列表 ── */
  .module-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .module-item {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 11px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
  }

  .module-item__main {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .module-item__title {
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .module-item__sub {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  .module-item__ops {
    display: flex;
    gap: 2px;
    flex: none;
  }

  /* ── 预设布局预览 ── */
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 9px;
  }

  .preset {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 11px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    text-align: left;
    transition:
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .preset:hover {
    border-color: var(--text-secondary);
  }

  .preset--active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, transparent);
  }

  .preset__preview {
    display: flex;
    gap: 4px;
    height: 34px;
    padding: 5px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }

  .preset__preview i {
    display: block;
    border-radius: 2px;
    background: var(--text-secondary);
    opacity: 0.45;
    height: 100%;
  }

  /* 居中：三块横向铺满 */
  .preset__preview--center {
    flex-direction: column;
  }

  .preset__preview--center i {
    flex: 1;
  }

  /* 左对齐：宽度递减，靠左 */
  .preset__preview--left {
    flex-direction: column;
    align-items: flex-start;
  }

  .preset__preview--left i:nth-child(1) {
    width: 100%;
    flex: 1;
  }

  .preset__preview--left i:nth-child(2) {
    width: 70%;
    flex: 1;
  }

  .preset__preview--left i:nth-child(3) {
    width: 45%;
    flex: 1;
  }

  /* 两栏：左大右小 */
  .preset__preview--two-column {
    gap: 5px;
  }

  .preset__preview--two-column i:nth-child(1) {
    flex: 2.2;
  }

  .preset__preview--two-column i:nth-child(2) {
    flex: 1;
  }

  /* 第三个元素在 two-column 下隐藏，只表达两栏结构 */
  .preset__preview--two-column i:nth-child(3) {
    display: none;
  }

  .preset__label {
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .preset__desc {
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  /* ── 统计 ── */
  .stats {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 0;
  }

  .stats__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--text) 5%, transparent);
    font-size: var(--fs-sm);
  }

  .stats__row dt {
    color: var(--text-secondary);
  }

  .stats__row dd {
    margin: 0;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  /* ── 要点列表 ── */
  .bullets {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 0;
    padding-left: 18px;
    list-style: disc;
    font-size: var(--fs-sm);
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .bullets--error {
    color: #e5484d;
  }

  /* ── 子对话框 ── */
  .sub-dialog {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-drawer) + 10);
    display: grid;
    place-items: center;
    background: rgba(6, 8, 12, 0.46);
    backdrop-filter: blur(2px);
    animation: overlay-in var(--dur-base) var(--ease-soft);
  }

  @keyframes overlay-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .sub-dialog__panel {
    display: flex;
    flex-direction: column;
    gap: 13px;
    width: min(460px, 92vw);
    max-height: 80vh;
    overflow-y: auto;
    padding: 20px;
    border-radius: var(--radius-xl);
    box-shadow: 0 24px 60px -16px var(--shadow);
    animation: panel-in var(--dur-base) var(--ease-out);
  }

  @keyframes panel-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .sub-dialog__title {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .sub-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* ── 开关 ── */
  .switch--on {
    background: var(--accent);
  }

  .btn--sm {
    height: 26px;
    padding: 0 10px;
    font-size: var(--fs-xs);
  }

  /* ── 分区名称输入框：行内编辑，平时无边框，聚焦才显形 ── */
  .section-name-input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid transparent;
    font-size: var(--fs-base);
    color: var(--text);
    transition:
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .section-name-input:hover:not(:disabled) {
    border-color: var(--line);
  }

  .section-name-input:focus {
    outline: none;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }

  .section-name-input:disabled {
    color: var(--text-secondary);
    cursor: not-allowed;
  }
</style>
