<!--
  应用外壳

  职责：
    · 装配可见模块（搜索卡片 / 快捷方式区）
    · 承载全局浮层（收藏夹弹窗、设置抽屉、Toast、右键菜单）
    · 全局键盘快捷键
    · 壁纸层（懒加载，不阻塞首屏）

  布局响应：模块可见性 + 顺序来自 modulesStore，对齐方式来自 layout.preset。
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import SearchBar from '../../components/SearchBar.svelte';
  import SvgIcon from '../../components/SvgIcon.svelte';
  import EngineBar from '../../components/EngineBar.svelte';
  import ShortcutGrid from '../../components/ShortcutGrid.svelte';
  import SectionPill from '../../components/SectionPill.svelte';
  import BookmarkDialog from '../../components/BookmarkDialog.svelte';
  import SettingsPanel from '../../components/SettingsPanel.svelte';
  import ToastHost from '../../components/ToastHost.svelte';
  import Wallpaper from '../../components/Wallpaper.svelte';
  import WallpaperActions from '../../components/WallpaperActions.svelte';
  import SettingsButton from '../../components/SettingsButton.svelte';
  import ContextMenu from '../../components/ContextMenu.svelte';
  import { modulesStore, settingsStore } from '../../stores/settings';
  import { layoutStore } from '../../stores/layout';
  import { uiStore } from '../../stores/ui';
  import { visibleModules } from '../../lib/layout';

  // ── 订阅 store ──
  // Svelte 5 runes：用 $state 持有快照，$effect 里订阅
  let settings = $state(settingsStore.getState().settings);
  let modules = $state(modulesStore.getState().modules);
  let preset = $state(layoutStore.getState().layout.preset);
  let ui = $state(uiStore.getState());

  $effect(() => {
    const off = settingsStore.subscribe((s) => {
      settings = s.settings;
    });
    return off;
  });

  $effect(() => {
    const off = modulesStore.subscribe((s) => {
      modules = s.modules;
    });
    return off;
  });

  $effect(() => {
    const off = layoutStore.subscribe((s) => {
      preset = s.layout.preset;
    });
    return off;
  });

  $effect(() => {
    const off = uiStore.subscribe((s) => {
      ui = s;
    });
    return off;
  });

  // ── 可见模块（按 order 排序） ──
  const shown = $derived(visibleModules(modules));
  const showSearch = $derived(shown.some((m) => m.type === 'search'));
  const showEngines = $derived(shown.some((m) => m.type === 'engines'));
  const showShortcuts = $derived(shown.some((m) => m.type === 'shortcuts'));

  /**
   * 搜索框与引擎栏是同一个视觉单元 —— 合并成一张圆角矩形毛玻璃卡片。
   * 上半是输入框，下半是引擎图标；两者有一个可见就渲染这张卡。
   */
  const showSearchBlock = $derived(showSearch || showEngines);

  /** 输入框有内容时，在搜索框上方提示「点击引擎直接跳转」（需求 9） */
  const showJumpHint = $derived(showSearch && Boolean(ui.searchQuery.trim()));

  // ── 搜索框引用，供快捷键聚焦 ──
  // bind:this 会写回该变量，必须声明为 $state 才能触发响应式更新
  let searchBar = $state<{ focus(): void; clear(): void } | undefined>(undefined);
  // 快捷方式区引用：右键「添加快捷方式」要唤起它的表单
  let shortcutGrid = $state<{ openAddForm(): void } | undefined>(undefined);

  // ── 页面空白处右键菜单 ──
  // 只在「真正的空白」上弹：落到输入框、按钮、已有右键菜单的目标上时放行，
  // 否则会盖掉组件自己更具体的菜单（例如快捷方式图标上的那一套）。
  let blankMenu = $state<{ x: number; y: number } | null>(null);

  function onBlankContextMenu(event: MouseEvent) {
    const el = event.target as HTMLElement | null;
    // 命中任何交互元素 / 已有菜单体系就交给它们自己处理
    if (
      el?.closest(
        'input, textarea, button, a, [role="menu"], [data-no-blank-menu], .ctx, .drawer, .dialog, .search-area, .shortcuts',
      )
    ) {
      return;
    }
    event.preventDefault();
    blankMenu = { x: event.clientX, y: event.clientY };
  }

  // ── 全局键盘快捷键 ──
  function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function onKeydown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey;

    // Ctrl/Cmd + K 或 / —— 聚焦搜索框
    if ((mod && event.key.toLowerCase() === 'k') || (!mod && event.key === '/')) {
      if (mod || !isTypingTarget(event.target)) {
        event.preventDefault();
        searchBar?.focus();
        return;
      }
    }

    // Esc —— 逐层关闭浮层，优先关闭最上层
    if (event.key === 'Escape') {
      if (blankMenu) {
        blankMenu = null;
        return;
      }
      if (ui.bookmarkDialogOpen || ui.settingsOpen || ui.editorOpen) return;
      if (isTypingTarget(event.target)) {
        (event.target as HTMLInputElement).blur();
      }
    }

    // Ctrl/Cmd + Z —— 布局撤销 / 重做
    if (mod && layoutStore.getState().editing) {
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        layoutStore.getState().undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        layoutStore.getState().redo();
      }
    }
  }

  // ── 快捷方式数据流入 ──
  // 目前外壳不消费快捷方式的计数与选中项，因此不在这里持有状态；
  // 需要时（例如做顶部统计条、或搜索后清空）再加回，避免留下死变量。
  //
  // 注：曾挂在window 上的「滚轮 / 触控板滑动切换分区」已按用户要求整体下线，
  // 分区切换现在只走底部胶囊点击（见 SectionPill.select）。
  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
    };
  });
</script>

<Wallpaper />

<main
  class="stage"
  data-preset={preset}
  data-editing={layoutStore.getState().editing}
  aria-label="起始页主区域"
  oncontextmenu={onBlankContextMenu}
>
  <div class="stage__inner">
    {#if showSearchBlock}
      <!--
        搜索区 = 搜索卡片（毛玻璃）+ 引擎栏，**两块是分开的**：
        卡片的边界只到输入框为止，引擎图标不再被包进卡里 ——
        否则那张卡会一路把引擎栏也框进去（「边框不包括搜索引擎」）。
        引擎图标现在和快捷方式图标一样直接落在壁纸上。

        外面这层 .search-area 只负责两块的间距，
        以及「模块纵向位置 → 搜索卡片」那根滑块共用的偏移量。
      -->
      <div class="search-area">
        {#if showJumpHint}
          <!-- 需求 9：输入框有内容时，在搜索框上方居中提示「点击引擎直接跳转」。
               纯提示，不参与命中测试。 -->
          <div class="engine-jump-hint" aria-hidden="true">
            <SvgIcon name="external-link" size={12} />
            点击引擎直接跳转
          </div>
        {/if}

        {#if showSearch}
          <!-- glass-tile = 「快捷方式小方块」那块材质（全局唯一定义处）。
               搜索卡片与每个快捷方式图标挂的是同一个类，
               所以材质逐像素相同，模糊程度也由同一根滑块驱动。 -->
          <section class="search-block glass-tile">
            <div class="slot slot--search" data-module="search">
              <SearchBar bind:this={searchBar} {settings} />
            </div>
          </section>
        {/if}

        {#if showEngines}
          <div class="slot slot--engines" data-module="engines">
            <EngineBar />
          </div>
        {/if}
      </div>
    {/if}

    {#if showShortcuts}
      <section class="slot slot--shortcuts" data-module="shortcuts">
        <ShortcutGrid
          bind:this={shortcutGrid}
          size={settings.shortcutSize}
        />
      </section>

      <!-- 分区胶囊：仅快捷方式可见时显示，固定在底部正中 -->
      <SectionPill />
    {/if}
  </div>
</main>

{#if ui.bookmarkDialogOpen}
  <BookmarkDialog />
{/if}

{#if ui.settingsOpen}
  <SettingsPanel />
{/if}

<!-- 页面空白处右键：添加快捷方式 / 更改壁纸 / 设置 -->
{#if blankMenu}
  <ContextMenu
    x={blankMenu.x}
    y={blankMenu.y}
    items={[
      { id: 'add-shortcut', label: '添加快捷方式', icon: 'plus' },
      { id: 'change-wallpaper', label: '更改壁纸', icon: 'image' },
      { id: 'settings', label: '设置', icon: 'settings' },
    ]}
    onselect={(id) => {
      blankMenu = null;
      if (id === 'add-shortcut') {
        // 快捷方式区被隐藏时也能加 —— 直接打开收藏夹会让用户迷惑，
        // 所以这里始终唤起添加表单（表单本身在 ShortcutGrid 内）。
        shortcutGrid?.openAddForm();
      } else if (id === 'change-wallpaper') {
        uiStore.getState().openSettings('appearance');
      } else if (id === 'settings') {
        uiStore.getState().openSettings();
      }
    }}
    onclose={() => (blankMenu = null)}
  />
{/if}

<!-- 设置按钮：固定右下角，不可拖拽、不可移除 -->
<SettingsButton />

<!-- 壁纸操作：固定左下角，按当前壁纸类型显示「换一张」或「更换照片」 -->
<WallpaperActions />

<ToastHost />

<style>
  .stage {
    flex: 1;
    display: flex;
    min-height: 0;
    padding: clamp(48px, 12vh, 132px) clamp(20px, 5vw, 72px) 96px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .stage__inner {
    display: flex;
    flex-direction: column;
    gap: clamp(20px, 3.4vh, 38px);
    width: 100%;
    max-width: 980px;
    margin: 0 auto;
    align-self: flex-start;
  }

  /* ── 搜索区外壳 ──
     搜索卡片（毛玻璃）与引擎栏是**独立的两块**：
     卡片的边界只到输入框为止，引擎图标不再被包进卡里，
     而是和快捷方式图标一样直接落在壁纸上。

     这一层只干两件事：
     · 管两者的间距 —— 比 .stage__inner 的大间距紧一档，
       因为它们仍属于「搜索」这一组；
     · 承载共用的纵向偏移量 —— 设置里「搜索卡片」那根滑块
       仍然把卡片与引擎栏**整体一起**搬（与改版前的手感一致）。

     宽度与搜索卡片对齐（720）：引擎栏与右侧那句提示语
     于是和上方输入文字共用同一条中轴。 */
  .search-area {
    position: relative;
    top: var(--search-offset, 0px);
    display: flex;
    flex-direction: column;
    gap: clamp(10px, 1.4vh, 14px);
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
  }

  /* ── 搜索框上方提示：输入框有内容时居中显示「点击引擎直接跳转」 ──
     普通文档流（落在 .search-area 内、搜索卡片之前）+ pointer-events: none，
     不抢点击；与上方输入文字共用同一条中轴。 */
  .engine-jump-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0.85;
    animation: engine-jump-hint-in var(--dur-base) var(--ease-soft);
  }

  @keyframes engine-jump-hint-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 0.85;
      transform: translateY(0);
    }
  }

  /* ── 搜索卡片：只包住输入框的那一层毛玻璃 ──
     宽度收得比快捷方式区窄一些，读起来才像「一张卡」而不是一条通栏；
     内边距比上一版更紧：卡片里只有一行输入，留太大就显空。

     位置：居中预设下，本区与快捷方式区作为一整组垂直居中
     （见下方 .stage[data-preset='center'] .stage__inner 规则）。
     输入框行数变多时卡片变高，整组会围绕垂直中心重新排布 ——
     顶边向上、底边向下各让一半，下方的引擎栏不会突然跳走，观感是稳的。 */
  .search-block {
    /* ── 材质整体交给全局 .glass-tile（本轮的关键改动）──
       那个类就是「快捷方式小方块」（ShortcutLogo 的 .logo__base）的完整配方：
       145° 白色渐变 + 顶部一道亮高光 + 1px 发丝描边 + 一层浅投影
       + backdrop-filter: blur(var(--glass-blur))。
       搜索卡片与每一个快捷方式方块挂的是**同一个类** ——
       材质逐像素相同，只是面积不同；设置里那根「毛玻璃模糊程度」
       滑块一次就把它们全部调整。

       这里刻意**不**再覆盖任何材质属性，只留尺寸与布局。
       此前这几行是各写一份玻璃声明（--glass-blur-search / --glass-surface /
       自带 box-shadow / border-color: transparent），改一处忘一处，
       才会反复出现「搜索框和快捷方式看着不是一种材质」「太暗」这类问题。

       圆角单独给：小方块跟 --cell 走（--shortcut-radius），
       卡片比它大得多，用 --radius-xl；两者都乘 --radius-scale，
       所以设置里的「圆角大小」滑块对它们依旧同步生效。 */
    border-radius: var(--radius-xl);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    /* ── 竖直方向不再垫白（「太粗」的成因）──
       卡片里只有一行输入，而 .search__field 自带上下各 10px 内边距，
       卡再垫一圈 12–16px 就把整条撑到 88px 高，像一条厚砖。
       现在纵向归零：58px = 1px 描边 ×2 + 10px ×2 + 36px 行高，
       正好是搜索框该有的比例；输入框行数变多时依旧只有内容在长。
       水平方向保留：清除 / 直达按钮是绝对定位在 .search__field 上的，
       需要这点外边距才不会顶到圆角上。 */
    padding: 0 clamp(12px, 1.8vw, 16px);
    transition:
      border-color var(--dur-base) var(--ease-soft),
      border-radius var(--dur-base) var(--ease-soft);
  }

  /* ── 聚焦时不再画描边 ──
     这里原有一条 .search-block:focus-within，会把 1px 边框染成
     color-mix(in srgb, var(--accent) 28%, var(--glass-border)) —— 而 --accent 是 #2f6bff，
     于是「一点进搜索框，整个搜索模块就被一圈蓝边包住」。
     现在整条删除：模块外观在聚焦前后完全一致。
     聚焦反馈仍由输入区自己提供（占位符淡出 + 强调色光标），
     见 SearchBar 的 .search__input:focus::placeholder / caret-color。 */

  /* ── 引擎栏现在是卡片**外面**的独立一块 ──
     这里刻意**不写任何规则**：不铺底板、不描边、也不画分隔线 ——
     引擎图标和快捷方式图标一样直接落在壁纸上。
     与上方卡片的间距由 .search-area 的 gap 提供（宽度靠 flex 的 stretch 撑满）。 */

  /* ── 模块纵向偏移（设置 → 外观 → 模块纵向位置）──
     变量由 lib/theme.ts#applyModuleOffsetsToRoot 写成 :root 上的 px 值（可为负）。

     刻意用 position: relative + top，而**不是** transform: translateY。
     两者都是「只挪视觉、不改布局」，移动某个模块时其它模块纹丝不动 ——
     这正是「每个模块各调各的」需要的语义。但 transform 会给后代建立包含块，
     从而把 ShortcutGrid 里 position: fixed 的 .inline-dialog（添加 / 命名的
     居中弹层）从「铺满视口」压成「只铺满被变换的那个盒子」，弹层会整块歪掉；
     relative 不建立包含块，fixed 后代依然相对视口定位，所以这里必须用 relative。

     另外：父级带偏移时 getBoundingClientRect() 的结果会跟着偏，
     而 lib/sortable 的拖拽命中判定正好用的就是它，因此拖拽排序不会错位。

     搜索那一路的偏移量写在上面的 .search-area 上（卡片与引擎栏共用），
     这里只剩快捷方式区自己的一根。 */
  .slot--shortcuts {
    position: relative;
    top: var(--shortcuts-offset, 0px);
  }

  /* 预设布局：居中 —— 经典起始页。整组模块（搜索卡片 + 快捷方式）
     作为一个整体在可视区内垂直居中；水平方向由 max-width + auto 外边距居中。

     这里用 flex 的 auto 外边距，而不是 align-items / align-self: center：
     两者在空间充足时视觉完全等价，但内容一旦高过容器（快捷方式排满 3 行、
     又把图标尺寸调大时就会发生），align-items: center 会让溢出部分向上下
     对称溢出、顶部被裁掉而且滚不上去；auto 外边距在空间不足时会自行退化成 0，
     内容改为从顶边开始排布，正常滚动就能看全。

     基准规则里的 align-self: flex-start **刻意保留**：
     它让内层保持「内容高度」而不是被拉伸（有 auto 外边距时不会被 stretch），
     同时正好充当上面那种溢出场景的对齐兜底。

     另外上下内边距故意不相等（上 clamp(48px,12vh,132px) / 下 96px），
     于是居中点比几何中心略低一点 —— 正好是想要的「下移一些」的观感。 */
  .stage[data-preset='center'] .stage__inner {
    flex: 1 1 auto;
    /* 四向 auto：横向受 max-width(980) 约束后居中，纵向在剩余空间里对半居中 */
    margin: auto;
    align-items: stretch;
  }

  /* 预设布局：左对齐 —— 内容靠左，右侧留白 */
  .stage[data-preset='left'] .stage__inner {
    margin: 0;
    max-width: 760px;
  }

  /* 左对齐时卡片也跟着贴左，不再自动居中 */
  .stage[data-preset='left'] .search-area {
    margin: 0;
  }

  /* 预设布局：两栏 —— 快捷方式区独立到右栏，搜索区占满左栏 */
  .stage[data-preset='two-column'] .stage__inner {
    max-width: 1180px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
    grid-template-areas: 'search shortcuts';
    gap: clamp(20px, 3vw, 44px) clamp(24px, 4vw, 56px);
    align-content: start;
    align-items: start;
  }

  /* 占左栏的是整个搜索区（卡片 + 引擎栏），不能只挪卡片 ——
     否则引擎栏会掉到 grid 的下一个自动行里去。 */
  .stage[data-preset='two-column'] .search-area {
    grid-area: search;
    max-width: 100%;
    margin: 0;
  }

  .stage[data-preset='two-column'] .slot--shortcuts {
    grid-area: shortcuts;
  }

  /* 窄屏统一退化单列，避免两栏挤成一团 */
  @media (max-width: 860px) {
    .stage {
      padding: 56px 20px 96px;
    }

    .stage[data-preset='two-column'] .stage__inner {
      display: flex;
      max-width: 640px;
    }
  }
</style>
