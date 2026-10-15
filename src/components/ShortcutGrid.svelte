<!--
  快捷方式网格

  功能清单（对应需求 2.1）：
   · 点击当前页跳转
   · 右键弹出设置菜单：修改名字 / 隐藏名字 / 修改图标 / 修改网址 /
     删除 / 打开 / 复制链接 / 从收藏夹导入
   · 拖拽调整位置并持久化排序
   · 图标自动识别，加载失败回退
   · 隐藏名字后 hover 显示 tooltip

  新增路径：尾部的「添加」按钮已移除，改由页面空白处右键菜单
  「添加快捷方式」进入，网格本身只负责展示与排序。
-->
<script lang="ts">
  import ShortcutLogo from './ShortcutLogo.svelte';
  import SvgIcon from './SvgIcon.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { shortcutsStore } from '../stores/shortcuts';
  import { settingsStore } from '../stores/settings';
  import { uiStore } from '../stores/ui';
  import { sortable } from '../lib/sortable';
  import { copyText, navigateCurrentTab, openInNewTab } from '../lib/platform';
  import { saveIcon } from '../lib/indexeddb';
  import { validateImageFile } from '../lib/validate';
  import type { Shortcut } from '../types';

  interface Props {
    /** 图标边长（px），由设置里的滑块无极调节 */
    size: number;
    oncountchange?: (n: number) => void;
    onselect?: (s: Shortcut) => void;
    /**
     * 指定要渲染的分区 id。缺省时跟随 uiStore.currentSectionId（默认行为）。
     * 触控板滑动手势的「相邻分区预览」会传入具体的分区 id 来同时渲染两个分区。
     */
    sectionId?: string;
    /**
     * 关闭「切换分区」的入场动画。滑动手势期间由外层轨道统一做平移，
     * 内部格子不应再各自播放 28px 滑入，否则会与跟手位移打架。
     */
    noEntrance?: boolean;
  }

  let { size, oncountchange, onselect, sectionId, noEntrance }: Props = $props();

  let shortcuts = $state(shortcutsStore.getState().shortcuts);
  let ready = $state(shortcutsStore.getState().ready);
  /** 名字显隐由设置里的一个全局开关统一控制 */
  let showNames = $state(settingsStore.getState().settings.shortcutShowNames);
  /** 当前所在分区：只有它下面的快捷方式才显示 */
  let currentSectionId = $state(uiStore.getState().currentSectionId);
  /** 切换分区的动画方向（'next' | 'prev' | null），由 uiStore 随 currentSectionId 下发 */
  let slideDir = $state<'next' | 'prev' | null>(uiStore.getState().slideDir);

  // 实际生效的分区：传入 sectionId 时用传入值，否则跟随 uiStore。
  // 这样同一份组件既能渲染「当前分区」（常规），也能渲染「相邻分区」（滑动预览）。
  const activeSectionId = $derived(sectionId ?? currentSectionId);

  $effect(() => {
    const offs = [
      shortcutsStore.subscribe((s) => {
        shortcuts = s.shortcuts;
        ready = s.ready;
      }),
      settingsStore.subscribe((s) => {
        showNames = s.settings.shortcutShowNames;
      }),
      uiStore.subscribe((s) => {
        currentSectionId = s.currentSectionId;
        slideDir = s.slideDir;
      }),
    ];
    return () => offs.forEach((o) => o());
  });

  $effect(() => {
    oncountchange?.(sorted.length);
  });

  const px = $derived(size);
  // 只展示当前分区的快捷方式，并按 order 排序。
  // 各分区内部从 0 重新编号（见 shortcutsStore.reorderSection），
  // 跨分区的 order 数值交错不影响各自展示。
  const sorted = $derived(
    [...shortcuts]
      .filter((s) => s.sectionId === activeSectionId)
      .sort((a, b) => a.order - b.order),
  );

  // ── 右键菜单 ──
  let menu = $state<{ x: number; y: number; target: Shortcut } | null>(null);

  function openMenu(event: MouseEvent, shortcut: Shortcut) {
    event.preventDefault();
    event.stopPropagation();
    menu = { x: event.clientX, y: event.clientY, target: shortcut };
  }

  // ── 重命名 / 改网址：用轻量内联对话框 ──
  type EditField = 'name' | 'url';
  let editing = $state<{ shortcut: Shortcut; field: EditField } | null>(null);
  let editValue = $state('');

  function beginEdit(shortcut: Shortcut, field: EditField) {
    editing = { shortcut, field };
    editValue = field === 'name' ? shortcut.name : shortcut.url;
    menu = null;
  }

  async function commitEdit() {
    if (!editing) return;
    const { shortcut, field } = editing;
    const value = editValue.trim();
    editing = null;
    if (!value) return;

    const res = await shortcutsStore
      .getState()
      .update(shortcut.id, field === 'name' ? { name: value } : { url: value });
    if (!res.ok) uiStore.getState().toast(res.error, 'error');
  }

  // ── 菜单动作 ──

  async function removeShortcut(shortcut: Shortcut) {
    await shortcutsStore.getState().remove(shortcut.id);
    uiStore.getState().toast(`已删除「${shortcut.name}」`, 'success', 1800);
    menu = null;
  }

  async function copyLink(shortcut: Shortcut) {
    const ok = await copyText(shortcut.url);
    uiStore
      .getState()
      .toast(
        ok ? '链接已复制' : '复制失败，请手动复制',
        ok ? 'success' : 'error',
        1800,
      );
    menu = null;
  }

  function openShortcut(shortcut: Shortcut) {
    openInNewTab(shortcut.url);
    menu = null;
  }

  /** 从收藏夹导入：打开收藏夹弹窗，用户在其中逐个导入 */
  function importFromBookmarks() {
    uiStore.getState().openBookmarks();
    menu = null;
  }

  // ── 自定义图标导入 ──
  let iconInput: HTMLInputElement | undefined;
  let iconTarget = $state<Shortcut | null>(null);

  function pickIcon(shortcut: Shortcut) {
    iconTarget = shortcut;
    menu = null;
    iconInput?.click();
  }

  async function onIconChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !iconTarget) return;

    const issues = validateImageFile(file);
    if (issues.length) {
      uiStore.getState().toast(issues[0].message, 'error');
      return;
    }

    try {
      const iconId = `icon_${iconTarget.id}_${Date.now().toString(36)}`;
      await saveIcon(iconId, file);
      const res = await shortcutsStore
        .getState()
        .update(iconTarget.id, { icon: iconId });
      if (!res.ok) throw new Error(res.error);
      uiStore.getState().toast('图标已更新', 'success', 1600);
    } catch (err) {
      uiStore
        .getState()
        .toast(err instanceof Error ? err.message : '图标保存失败', 'error');
    } finally {
      iconTarget = null;
    }
  }

  async function resetIcon(shortcut: Shortcut) {
    await shortcutsStore.getState().update(shortcut.id, { icon: 'auto' });
    uiStore.getState().toast('已恢复自动识别图标', 'success', 1600);
    menu = null;
  }

  // ── 拖拽排序（需求 3–6）──
  // 与引擎栏共用 lib/sortable：跟手移动 + 弹性让位是同一份实现。
  // 这里只补一个「排序中」标记：网格是滚动容器，拖拽期间要临时放开裁剪，
  // 否则把图标拖到网格外就会被裁掉一半。
  let gridEl = $state<HTMLDivElement | undefined>(undefined);
  let sorting = $state(false);

  const shortcutSortable = (node: HTMLElement, shortcut: Shortcut) =>
    sortable(node, {
      root: () => gridEl,
      threshold: 5,
      scale: 1.06,
      onDraggingChange: (v) => (sorting = v),
      onDrop: (fromIndex, toIndex) => {
        // 拖拽排序只在当前分区内部重排（索引对应当前可见列表）
        void shortcutsStore.getState().reorderSection(activeSectionId, fromIndex, toIndex);
      },
    });

  // ── 添加 ──
  // 入口已移到页面空白处的右键菜单（见 App.svelte），
  // 但表单本身留在这里：全局只允许存在一个实例，避免两份状态打架。
  let adding = $state(false);
  let addName = $state('');
  let addUrl = $state('');

  /** 供外部（空白处右键菜单）唤起添加表单 */
  export function openAddForm() {
    adding = true;
    addName = '';
    addUrl = '';
  }

  async function commitAdd() {
    const name = addName.trim();
    const url = addUrl.trim();
    adding = false;
    addName = '';
    addUrl = '';
    if (!url) return;
    const res = await shortcutsStore.getState().add({ name, url, sectionId: activeSectionId });
    if (!res.ok) uiStore.getState().toast(res.error, 'error');
  }
</script>

<div class="shortcuts">
  <div
    bind:this={gridEl}
    class="shortcuts__grid"
    class:shortcuts__grid--sorting={sorting}
    class:shortcuts__grid--names-off={!showNames}
    style:--cell="{px}px"
    data-sortable-root
  >
    {#key activeSectionId}
      <div
        class="shortcuts__keywrap"
        class:shortcuts__keywrap--slide-next={slideDir === 'next'}
        class:shortcuts__keywrap--slide-prev={slideDir === 'prev'}
        class:shortcuts__keywrap--no-anim={noEntrance}
      >
    {#each sorted as shortcut (shortcut.id)}
      <div
        class="shortcut"
        data-shortcut={shortcut.id}
        data-sortable-item
        use:shortcutSortable={shortcut}
        role="button"
        tabindex="0"
        title={`${shortcut.name} · 按住可拖动排序`}
        aria-label={`打开 ${shortcut.name}`}
        oncontextmenu={(e) => openMenu(e, shortcut)}
        onclick={() => {
          onselect?.(shortcut);
          navigateCurrentTab(shortcut.url);
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigateCurrentTab(shortcut.url);
          } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            menu = { x: r.left, y: r.bottom, target: shortcut };
          }
        }}
      >
        <ShortcutLogo {shortcut} size={px} />

        {#if showNames}
          <span class="shortcut__name" title={shortcut.name}>{shortcut.name}</span>
        {:else}
          <!-- 名字整体隐藏：hover / focus 时用 tooltip 兜住可发现性 -->
          <span class="shortcut__tooltip" role="tooltip">{shortcut.name}</span>
        {/if}
      </div>
    {/each}

    <!--
      收藏夹入口：固定在网格尾部，与快捷方式格子同尺寸同排版，
      视觉上就是「格子队列里的最后一格」。
      上一轮误删了这个图标入口（当时只需去掉「添加」按钮），这里恢复。
    -->
    <button
      class="shortcut shortcut--bookmarks"
      type="button"
      title="打开收藏夹，可批量导入为快捷方式"
      aria-label="打开收藏夹"
      onclick={() => uiStore.getState().openBookmarks()}
    >
      <span class="shortcut__logo shortcut__logo--bookmarks" aria-hidden="true">
        <SvgIcon name="bookmark-plus" size={Math.round(px * 0.44)} />
      </span>
      {#if showNames}
        <span class="shortcut__name">收藏夹</span>
      {/if}
      </button>
      </div>
    {/key}
  </div>

  {#if !ready}
    <p class="shortcuts__hint">正在加载快捷方式…</p>
  {:else if sorted.length === 0}
    <p class="shortcuts__hint">
      还没有快捷方式。在页面空白处右键，选择「添加快捷方式」，
      或点击上方的「收藏夹」从书签导入。
    </p>
  {/if}
</div>

<!-- 隐藏的图片选择器，供自定义图标复用 -->
<input
  bind:this={iconInput}
  class="sr-only"
  type="file"
  accept="image/jpeg,image/png,image/webp"
  onchange={onIconChosen}
/>

<!-- 右键菜单 -->
{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={[
      { id: 'open', label: '打开', icon: 'external-link' },
      { id: 'copy', label: '复制链接', icon: 'copy' },
      { type: 'separator' },
      { id: 'name', label: '修改名字', icon: 'edit' },
      { id: 'url', label: '修改网址', icon: 'grid' },
      { id: 'icon', label: '修改图标', icon: 'image' },
      { id: 'reficon', label: '恢复自动图标', icon: 'refresh' },
      { type: 'separator' },
      { id: 'import', label: '从收藏夹导入', icon: 'bookmark-plus' },
      { type: 'separator' },
      { id: 'delete', label: '删除', icon: 'trash', danger: true },
    ]}
    onselect={(id) => {
      const target = menu?.target;
      if (!target) return;
      switch (id) {
        case 'open':
          openShortcut(target);
          break;
        case 'copy':
          void copyLink(target);
          break;
        case 'name':
          beginEdit(target, 'name');
          break;
        case 'url':
          beginEdit(target, 'url');
          break;
        case 'icon':
          pickIcon(target);
          break;
        case 'reficon':
          void resetIcon(target);
          break;
        case 'import':
          importFromBookmarks();
          break;
        case 'delete':
          void removeShortcut(target);
          break;
      }
    }}
    onclose={() => (menu = null)}
  />
{/if}

<!-- 编辑名字 / 网址的内联对话框 -->
{#if editing}
  <div
    class="inline-dialog"
    role="dialog"
    aria-modal="true"
    aria-label={editing.field === 'name' ? '修改名字' : '修改网址'}
  >
    <div class="inline-dialog__panel glass">
      <h3 class="inline-dialog__title">
        {editing.field === 'name' ? '修改名字' : '修改网址'}
      </h3>
      <input
        class="input"
        bind:value={editValue}
        type="text"
        autofocus
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commitEdit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            editing = null;
          }
        }}
      />
      <div class="inline-dialog__actions">
        <button class="btn" type="button" onclick={() => (editing = null)}>取消</button>
        <button class="btn btn--primary" type="button" onclick={commitEdit}>保存</button
        >
      </div>
    </div>
  </div>
{/if}

<!-- 添加对话框 -->
{#if adding}
  <div class="inline-dialog" role="dialog" aria-modal="true" aria-label="添加快捷方式">
    <div class="inline-dialog__panel glass">
      <h3 class="inline-dialog__title">添加快捷方式</h3>

      <!--
        手动填写与「从收藏夹导入」并列，用户在这里就能选路径，
        不必先关掉窗口再去找收藏夹入口。
      -->
      <button
        class="add-import"
        type="button"
        onclick={() => {
          adding = false;
          uiStore.getState().openBookmarks();
        }}
      >
        <span class="add-import__ic" aria-hidden="true">
          <SvgIcon name="bookmark-plus" size={16} />
        </span>
        <span class="add-import__text">
          <span class="add-import__title">从收藏夹导入</span>
          <span class="add-import__sub">打开收藏夹，可多选批量导入</span>
        </span>
        <SvgIcon name="chevron-right" size={14} />
      </button>

      <div class="add-divider"><span>或手动填写</span></div>

      <div class="field">
        <label class="field__label" for="sc-add-name">名字（留空自动取域名）</label>
        <input id="sc-add-name" class="input" bind:value={addName} type="text" />
      </div>
      <div class="field">
        <label class="field__label" for="sc-add-url">网址</label>
        <input
          id="sc-add-url"
          class="input"
          bind:value={addUrl}
          type="text"
          placeholder="https://example.com"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commitAdd();
            } else if (e.key === 'Escape') {
              adding = false;
            }
          }}
        />
      </div>
      <div class="inline-dialog__actions">
        <button class="btn" type="button" onclick={() => (adding = false)}>取消</button>
        <button
          class="btn btn--primary"
          type="button"
          onclick={commitAdd}
          disabled={!addUrl.trim()}
        >
          添加
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .shortcuts {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* {#key currentSectionId} 的包裹层：它是**真实的网格盒子**（不再是 display:contents），
     这样切换分区时才能对它做「平移 + 淡入」动画。
     .shortcuts__grid 已退为滚动容器，这里承接原先的 flex 网格排版并限制 7 列宽度。 */
  .shortcuts__keywrap {
    display: flex;
    flex-wrap: wrap;
    gap: var(--grid-gap);
    align-items: flex-start;
    justify-content: center;
    /* 一行最多 7 格：口径与 .shortcuts__grid 的 max-width 对齐（不含外层 padding），
       保证第 8 格放不下就换行，且滚动条出现时仍是 7 列。 */
    max-width: calc(7 * var(--cell-w) + 6 * var(--grid-gap) + 8px);
    /* 基础：无方向时的中性淡入，避免生硬切换 */
    animation: tile-fade var(--dur-base) var(--ease-soft);
  }

  /* 有方向时：按相对位置平移 + 淡入，覆盖上面的中性淡入 */
  .shortcuts__keywrap--slide-next {
    animation: tile-slide-next var(--dur-base) var(--ease-out);
  }

  .shortcuts__keywrap--slide-prev {
    animation: tile-slide-prev var(--dur-base) var(--ease-out);
  }

  @keyframes tile-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* 进入下一页（滚轮向下 / 点右侧圆点）：内容从右往左滑入 */
  @keyframes tile-slide-next {
    from {
      opacity: 0;
      transform: translateX(28px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* 回到上一页（滚轮向上 / 点左侧圆点）：内容从左往右滑入 */
  @keyframes tile-slide-prev {
    from {
      opacity: 0;
      transform: translateX(-28px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* 滑动手势预览：外层轨道已在做 1:1 平移，内部格子必须完全静止，
     否则会叠加一层 28px 位移，与跟手位移打架。放在滑入规则之后以覆盖。 */
  .shortcuts__keywrap--no-anim {
    animation: none;
  }

  /* ── 快捷方式区：**只有排版，没有材质** ──
     本轮把这一整片「底层块」彻底去掉了。
     以前这里是 `glass glass-milk`，等于在整片快捷方式底下铺一张大玻璃板
     （就是截图里那个大圆角矩形）；现在一个材质类都不挂 ——
     壁纸原样透出来，唯一带材质的是每个图标底下那块小方块，
     它在 ShortcutLogo 里挂 .glass-tile。

     留下的全是几何，所以去掉底板后**图标位置一格都不会跳**：
     · border 依然是 1px（透明）—— 保住那 1px 宽度，
       盒子尺寸与改动前完全一致，不会引起 7 列 / 3 行的换算位移；
     · padding / max-width / max-height / gap / overflow 全部不动。
     · 悬浮与拖拽反馈（.shortcut:hover、.is-dragging）**保留** ——
       那是交互反馈，不属于「底层块」。 */
  .shortcuts__grid {
    border: 1px solid transparent;
    /* ── 网格度量：全部由 --cell 推导，拖动尺寸滑块时排版不会失控 ──
       这三个值同时决定「一格占多大」和「几行占多高」，
       所以 --row-h 改写时不会和实际渲染高度脱节。 */
    /* 一格宽度：必须与 .shortcut 的 width 一致 */
    --cell-w: calc(var(--cell, 56px) + 16px);
    /* 名字行高度：font-size = cell × 0.21，line-height = 1.3 → cell × 0.273 */
    --name-h: calc(var(--cell, 56px) * 0.273);
    /* 一格高度 = 上下内边距(8+8) + 行间距(8) + 名字行 */
    --tile-extra: 24px;
    --row-h: calc(var(--cell, 56px) + var(--name-h) + var(--tile-extra));
    --grid-gap: clamp(10px, 1.6vw, 20px);
    --grid-pad: clamp(14px, 2vw, 22px);

    /* 快捷方式图标底板半径：0.24 是默认比例，再乘全局 --radius-scale。
       定义在这里（而不是 ShortcutLogo 组件里），因为只有这里知道 --cell；
       ShortcutLogo 通过 var(--shortcut-radius) 继承下来。 */
    --shortcut-radius: calc(var(--cell, 56px) * 0.24 * var(--radius-scale));

    /* 退为滚动容器：内部只放 keywrap，居中并限制高度/宽度，超 3 行内部滚动。
       原先的 flex 网格排版已移交给 .shortcuts__keywrap。 */
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--grid-pad);
    /* 一行最多 7 格：把宽度上限卡死在这一行的总宽上，第 8 格放不下就只能换行。
       末尾 +8px 是给竖向滚动条预留的 —— 下面的 ::-webkit-scrollbar 宽度正好也是 8px，
       于是「有没有滚动条」两种状态下都是 7 列，不会因为滚动条出现而突然变成 6 列。 */
    max-width: calc(7 * var(--cell-w) + 6 * var(--grid-gap) + 2 * var(--grid-pad) + 8px);
    /* 最多 3 行：超出的部分在网格内部滚动，不把整个页面往下拉长 */
    max-height: calc(3 * var(--row-h) + 2 * var(--grid-gap) + 2 * var(--grid-pad));
    /* x 轴 hidden：配合 y 轴的 auto，彻底断掉横向滚动条出现的可能 */
    overflow: hidden auto;
    overscroll-behavior: contain;
    margin-inline: auto;
    transition:
      border-color var(--dur-base) var(--ease-soft),
      border-radius var(--dur-base) var(--ease-soft);
  }

  /* 细滚动条：宽度必须与上面 max-width 里预留的 8px 对齐 */
  .shortcuts__grid::-webkit-scrollbar {
    width: 8px;
  }

  .shortcuts__grid::-webkit-scrollbar-track {
    background: transparent;
  }

  .shortcuts__grid::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 24%, transparent);
  }

  .shortcuts__grid::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--text) 40%, transparent);
  }

  /* 全局关闭名字显示时，名字行不占高度（tooltip 是绝对定位，本就不参与布局），
     且 .shortcut 的 column gap 也没有了 —— 两者必须一起改，否则底部会多出 8px 空白。 */
  .shortcuts__grid--names-off {
    --name-h: 0px;
    --tile-extra: 16px;
  }

  /* 排序进行中：只调整光标与堆叠，**刻意不改 max-height / overflow**。
     原因：lib/sortable 在拖拽开始时一次性记下所有同级项的矩形，
     如果此刻改变布局（例如临时放开 3 行限制），记录的位置立刻失效，
     让位动画会整体错位。宁可让拖出边界的图标被裁掉一点，也不要错位。 */
  .shortcuts__grid--sorting {
    position: relative;
    z-index: 1;
  }

  .shortcuts__grid--sorting .shortcut:hover {
    background: transparent;
  }

  .shortcut {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: var(--cell-w);
    /* 固定高度：三行上限的换算依赖它，同时保证每行等高 */
    height: calc(var(--cell) + var(--name-h) + var(--tile-extra));
    padding: 8px 4px;
    border-radius: var(--radius-md);
    /* 拖拽排序：抓取光标；touch-action: none 防止触摸拖拽被页面滚动抢走 */
    cursor: grab;
    touch-action: none;
    transition:
      background-color var(--dur-fast) var(--ease-soft),
      transform var(--dur-fast) var(--ease-out);
    user-select: none;
    touch-action: manipulation;
  }

  .shortcut:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .shortcut:active {
    transform: scale(0.97);
  }

  /* ── 拖拽中（由 lib/sortable 在元素上挂 .is-dragging）──
     缩放与跟手位移都由 sortable 直接写 transform，这里只补「拿起来了」的光影，
     绝不能再写 transform，否则会和跟手位移打架。
     .is-dragging 是运行时由 action 加上的，静态分析看不到，所以要 :global。 */
  .shortcut:global(.is-dragging) {
    background: var(--glass-bg);
    box-shadow:
      0 14px 30px -8px var(--shadow),
      inset 0 1px 0 var(--glass-frost);
    opacity: 0.97;
    cursor: grabbing;
  }

  /* 拖拽期间不要触发按下缩放 / hover 位移 */
  .shortcuts__grid--sorting .shortcut:active,
  .shortcuts__grid--sorting .shortcut:hover {
    transform: none;
  }

  .shortcut__name {
    max-width: 100%;
    /* 名字字号跟着图标边长走，滑块拉大时标签不会显得过小 */
    font-size: calc(var(--cell) * 0.21);
    line-height: 1.3;
    text-align: center;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 隐藏名字后的 tooltip */
  .shortcut__tooltip {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translate(-50%, 100%) scale(0.9);
    padding: 4px 9px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    white-space: nowrap;
    color: var(--text);
    background: var(--glass-surface);
    border: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
    box-shadow: 0 6px 18px -6px var(--shadow);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--dur-fast) var(--ease-soft),
      transform var(--dur-fast) var(--ease-out);
    z-index: 20;
  }

  .shortcut:hover .shortcut__tooltip,
  .shortcut:focus-visible .shortcut__tooltip {
    opacity: 1;
    transform: translate(-50%, 100%) scale(1);
  }

  .shortcuts__hint {
    margin: 0;
    text-align: center;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  /* ── 收藏夹入口：与快捷方式同尺寸的「特殊一格」 ──
     不参与拖拽排序（它不在 sorted 里），仅作为固定的尾部入口。 */
  .shortcut--bookmarks {
    color: var(--text-secondary);
  }

  .shortcut--bookmarks:hover {
    color: var(--text);
  }

  .shortcut__logo--bookmarks {
    display: grid;
    place-items: center;
    width: var(--cell);
    height: var(--cell);
    flex: none;
    /* 与快捷方式图标底板用同一个半径 token，保证圆角缩放同步 */
    border-radius: var(--shortcut-radius);
    /* 虚线描边 + 淡玻璃底：与实心快捷方式图标明确区分 */
    border: 1.5px dashed color-mix(in srgb, var(--text) 26%, transparent);
    background: color-mix(in srgb, var(--text) 5%, transparent);
    transition:
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft),
      color var(--dur-fast) var(--ease-soft);
  }

  .shortcut--bookmarks:hover .shortcut__logo--bookmarks {
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  /* ── 内联对话框 ── */
  .inline-dialog {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    display: grid;
    place-items: center;
    background: rgba(6, 8, 12, 0.42);
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

  .inline-dialog__panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(420px, 92vw);
    padding: 20px;
    border-radius: var(--radius-xl);
    box-shadow: 0 20px 50px -12px var(--shadow);
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

  .inline-dialog__title {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .inline-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* ── 添加对话框里的「从收藏夹导入」入口 ──
     做成一块可点的卡片而不是一行文字链接：它是这个对话框的第二条主路径，
     需要与「手动填写」在视觉上等重，用户才不会忽略。 */
  .add-import {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 11px 12px;
    border-radius: var(--radius-md);
    text-align: left;
    color: var(--text);
    border: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--text) 4%, transparent);
    transition:
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft),
      transform var(--dur-fast) var(--ease-out);
  }

  .add-import:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .add-import:active {
    transform: scale(0.99);
  }

  .add-import__ic {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: var(--radius-sm);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .add-import__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .add-import__title {
    font-size: var(--fs-base);
    font-weight: 500;
  }

  .add-import__sub {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  /* 「或手动填写」分隔线 */
  .add-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  .add-divider::before,
  .add-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }
</style>
