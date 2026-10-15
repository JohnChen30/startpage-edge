<!--
  收藏夹弹窗 —— 模态弹窗（非侧边抽屉、非展开面板）

  规格逐条落地：
   · 类型：模态 + 半透明遮罩，居中
   · 尺寸：宽 720px、高 560px，最高 80vh
   · 窄屏：宽 90vw、高 70vh
   · 关闭：点击遮罩 / Esc / 关闭按钮
   · 焦点：打开时进入弹窗，关闭后回到触发按钮
   · 内容区独立滚动，弹窗本身不滚动
   · 顶部：标题 + 搜索框 + 关闭按钮
   · 中部：书签树，多级展开折叠，每项右侧「导入到快捷方式」
   · 底部：状态栏显示数量或权限提示
   · 空状态 / 权限被拒：各有引导文案
-->
<script lang="ts">
  /*
   * svelte/prefer-svelte-reactivity 在本文件是误报：
   * 我们用「拷贝后再赋值」的不可变更新模式（new Set(prev) → expanded = next），
   * 这正是 Svelte 5 推荐的写法，并不需要 SvelteSet。
   */
  /* eslint-disable svelte/prefer-svelte-reactivity */
  import SvgIcon from './SvgIcon.svelte';
  import ShortcutLogo from './ShortcutLogo.svelte';
  import UndoButton from './UndoButton.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { bookmarksStore } from '../stores/bookmarks';
  import { shortcutsStore } from '../stores/shortcuts';
  import { uiStore } from '../stores/ui';
  import { openPermissionPage, searchInTree } from '../lib/bookmarks';
  import { navigateCurrentTab } from '../lib/platform';
  import { SHORTCUT_LIMITS } from '../lib/defaults';
  import type { BookmarkNode } from '../types';

  let snapshot = $state(bookmarksStore.getState().snapshot);
  let query = $state('');
  let expanded = $state<Set<string>>(new Set());
  let usingDemo = $state(bookmarksStore.getState().usingDemo);
  let loading = $state(bookmarksStore.getState().loading);
  /** 正在导入的书签 id，用于按钮 loading 态 */
  let importingId = $state<string | null>(null);

  /** 多选集合 —— 与 uiStore 同步，关闭弹窗时可被清空 */
  let selected = $state<Set<string>>(new Set(uiStore.getState().selectedBookmarks));
  /** 多选模式：默认开启，让「批量导入」这条主路径不用先点开关 */
  let multiMode = $state(true);
  /** 视图方式：列表（默认，信息密度高）/ 网格（图标大，便于快速辨认） */
  let view = $state<'list' | 'grid'>('list');

  /**
   * 切换视图。
   *
   * 用**显式传参**而不是从 `event.currentTarget.dataset` 里读 —— 之前那版
   * 依赖事件对象上的 currentTarget，一旦它取不到（Svelte 的事件委托会把
   * currentTarget 指到遍历中的元素），表达式就抛异常、整个处理函数静默中断，
   * 表现就是「按钮点了完全没反应」。传参彻底断掉这条可能的失败路径。
   */
  function setView(next: 'list' | 'grid') {
    if (view === next) return;
    view = next;
  }

  /**
   * 每个按钮一个专属处理函数：**双绑 pointerdown + click**。
   *
   * pointerdown 比 click 先到，任何发生在 click 阶段（含捕获）的拦截都影响不到它，
   * 于是「按下即切换」，反馈也是即时的；万一 pointerdown 被谁 preventDefault 掉，
   * click 这条仍在。两条并存是安全的 —— setView 内部有判重，重复赋值没有任何副作用。
   *
   * 刻意写成零参数的具名函数而不是 `() => setView('grid')` 这类内联箭头：
   * 内联表达式曾因为依赖事件对象上的 currentTarget 而在协作时拿到错的元素，
   * 抛异常后整个处理函数静默中断，表象就是「点了完全没反应」。
   */
  function toList() {
    setView('list');
  }

  function toGrid() {
    setView('grid');
  }

  $effect(() => {
    const off = bookmarksStore.subscribe((s) => {
      snapshot = s.snapshot;
      usingDemo = s.usingDemo;
      loading = s.loading;
    });
    return off;
  });

  $effect(() => {
    const off = uiStore.subscribe((s) => {
      selected = s.selectedBookmarks;
    });
    return off;
  });

  let panelEl: HTMLDivElement | undefined;
  let searchEl: HTMLInputElement | undefined;
  /** 内容区（滚动容器）—— 进入文件夹层时把滚动位置归零 */
  let bodyEl: HTMLDivElement | undefined;
  /** 打开前的焦点元素，关闭时归还 */
  let previouslyFocused: HTMLElement | null = null;

  // ── 焦点管理 ──
  $effect(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    // 打开后把焦点送进弹窗（搜索框，最常用）
    queueMicrotask(() => searchEl?.focus());

    return () => {
      // 关闭后归还焦点，交给触发它的收藏夹按钮
      previouslyFocused?.focus?.();
    };
  });

  // ── 焦点陷阱：Tab 在弹窗内循环 ──
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !panelEl) return;

    const focusables = panelEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function close() {
    uiStore.getState().closeBookmarks();
  }

  // ── 树渲染 ──

  const isSearching = $derived(query.trim().length > 0);

  /**
   * 搜索结果（标题 **或** 网址命中）。
   *
   * ⚠️ 这里刻意**不再调用** `bookmarksStore.filtered()`：
   *    它读的是 **store 里存的那份 query**，而本组件输入框绑定的是组件本地的
   *    query，两者从来没有同步过。更致命的是 `filtered()` 是普通函数，
   *    `$derived(store.getState().filtered())` 里没有任何响应式依赖，
   *    结果只会在首次渲染时算一次 —— 于是输入什么都不影响列表，
   *    看起来就像「书签搜索完全没有关键字检索」。
   *    改为直接对本地 query 做推导，依赖链就完整了。
   */
  const visibleFlat = $derived(
    isSearching ? searchInTree(snapshot.flat, query) : snapshot.flat,
  );

  /** 搜索时直接平铺结果；否则按树展开 */
  function isExpanded(node: BookmarkNode): boolean {
    return expanded.has(node.id);
  }

  function toggle(node: BookmarkNode) {
    const next = new Set(expanded);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    expanded = next;
  }

  /** 该文件夹内（含子级）命中搜索的数量，用于展示 */
  function matchCount(node: BookmarkNode): number {
    if (!isSearching) return 0;
    const q = query.trim().toLowerCase();
    let n = 0;
    const walk = (list: BookmarkNode[]) => {
      for (const c of list) {
        if (
          c.url &&
          (c.title.toLowerCase().includes(q) || c.url.toLowerCase().includes(q))
        ) {
          n++;
        }
        if (c.children) walk(c.children);
      }
    };
    walk(node.children ?? []);
    return n;
  }

  // ── 导入 ──

  function toggleSelect(id: string) {
    uiStore.getState().toggleBookmarkSelection(id);
  }

  function isSelected(id: string): boolean {
    return selected.has(id);
  }

  /** 批量导入当前勾选的书签 */
  async function importSelected() {
    const ids = selected;
    if (ids.size === 0) return;

    // 从「当前可见的扁平列表」里挑出被勾选的，保证顺序与用户看到的列表一致
    const picked = visibleFlat.filter((n) => ids.has(n.id) && n.url);
    if (picked.length === 0) {
      // 勾选的可能在未展开的文件夹里，退回到全量扁平列表
      const all = snapshot.flat.filter((n) => ids.has(n.id) && n.url);
      picked.push(...all);
    }
    if (picked.length === 0) return;

    const sectionId = uiStore.getState().currentSectionId;
    const inputs = picked.map((n) => ({
      name: n.title || n.url || '',
      url: n.url ?? '',
      sectionId,
    }));
    const res = await shortcutsStore.getState().addMany(inputs);
    if (res.ok) {
      const { added, skipped } = res.value;
      uiStore
        .getState()
        .toast(
          `已导入 ${added} 项${skipped ? `，跳过 ${skipped} 项（重复或超限）` : ''}`,
          added ? 'success' : 'info',
          2600,
        );
      uiStore.getState().clearBookmarkSelection();
    }
  }

  /** 全选 / 取消全选当前列表 */
  function toggleSelectAll() {
    const all = visibleFlat.filter((n) => n.url).map((n) => n.id);
    if (all.length === 0) return;
    const allSelected = all.every((id) => selected.has(id));
    if (allSelected) uiStore.getState().clearBookmarkSelection();
    else uiStore.getState().setBookmarkSelection(all);
  }

  function openBookmark(node: BookmarkNode) {
    if (!node.url) return;
    navigateCurrentTab(node.url);
  }

  // ── 单个导入：先让用户确认 / 自定义名字 ──
  // 规格要求：「从收藏夹导入单个网址到快捷方式时，不要直接静默导入，
  //           弹出一个输入框让用户自定义名字，确认后再添加。」
  let pendingImport = $state<BookmarkNode | null>(null);
  let importName = $state('');
  let nameInputEl = $state<HTMLInputElement | undefined>(undefined);

  function requestImport(node: BookmarkNode) {
    if (!node.url) return;
    pendingImport = node;
    // 预填书签标题，用户可直接回车确认，也可改写
    importName = node.title || node.url;
    queueMicrotask(() => {
      nameInputEl?.focus();
      nameInputEl?.select();
    });
  }

  async function confirmImport() {
    const node = pendingImport;
    if (!node || !node.url) return;
    const name = importName.trim();
    pendingImport = null;
    importingId = node.id;
    const res = await shortcutsStore
      .getState()
      .add({
        name: name || node.title || node.url,
        url: node.url,
        sectionId: uiStore.getState().currentSectionId,
      });
    importingId = null;
    if (res.ok) {
      uiStore
        .getState()
        .toast(`已添加「${name || node.title}」到快捷方式`, 'success', 1800);
    } else {
      uiStore.getState().toast(res.error, 'error');
    }
  }

  function cancelImport() {
    pendingImport = null;
    importName = '';
  }

  // ── 右键菜单（收藏夹内部）──
  // 文件夹 → 「全部导入为快捷方式」；单个书签 → 「导入为快捷方式」
  let rowMenu = $state<
    { x: number; y: number; node: BookmarkNode; isFolder: boolean } | null
  >(null);

  function openRowMenu(event: MouseEvent, node: BookmarkNode) {
    event.preventDefault();
    event.stopPropagation();
    rowMenu = {
      x: event.clientX,
      y: event.clientY,
      node,
      isFolder: !node.url,
    };
  }

  /** 收集某个文件夹下（含子级）的全部可跳转书签 */
  function collectUrls(node: BookmarkNode): { name: string; url: string }[] {
    const out: { name: string; url: string }[] = [];
    const walk = (list: BookmarkNode[]) => {
      for (const c of list) {
        if (c.url) out.push({ name: c.title || c.url, url: c.url });
        if (c.children) walk(c.children);
      }
    };
    if (node.url) out.push({ name: node.title || node.url, url: node.url });
    walk(node.children ?? []);
    return out;
  }

  /** 文件夹：全部导入为快捷方式（一次性 addMany） */
  async function importFolder(node: BookmarkNode) {
    rowMenu = null;
    const sectionId = uiStore.getState().currentSectionId;
    const inputs = collectUrls(node)
      .slice(0, SHORTCUT_LIMITS.max)
      .map((i) => ({ ...i, sectionId }));
    if (inputs.length === 0) {
      uiStore.getState().toast('这个文件夹里没有可导入的书签', 'info', 1800);
      return;
    }
    const res = await shortcutsStore.getState().addMany(inputs);
    if (res.ok) {
      const { added, skipped } = res.value;
      uiStore
        .getState()
        .toast(
          `已导入 ${added} 项${skipped ? `，跳过 ${skipped} 项（重复或超限）` : ''}`,
          added ? 'success' : 'info',
          2600,
        );
    }
  }

  // ── 网格视图：像起始页「快捷方式」那样的方块格子 ──
  // ── 网格视图：像文件管理器一样一层层进 ──
  // 每个格子 = 网站 logo 在上 + 名字在下，与起始页快捷方式同一套视觉。
  // 文件夹**有自己的层级**：点文件夹格子进入它，面包屑可回到任意上级。
  // 搜索时退化为「平铺结果」，因为命中结果本来就可能来自不同层级。

  /** 当前所在的文件夹；null = 最顶层（收藏夹栏 / 其它书签这一层） */
  let curFolderId = $state<string | null>(null);

  /** 按 id 找出节点（含全部层级）—— 面包屑与「进入」都要用 */
  function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const hit = findNode(node.children, id);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * 当前文件夹的「祖先链」（含它自己），用于面包屑。
   * 刻意自己 DFS 而不是读 parentId —— 演示数据里 parentId 未必齐全，
   * 从树里走一遍路径永远是对的。
   */
  function pathTo(
    nodes: BookmarkNode[],
    id: string,
    trail: BookmarkNode[] = [],
  ): BookmarkNode[] | null {
    for (const node of nodes) {
      const next = [...trail, node];
      if (node.id === id) return next;
      if (node.children) {
        const hit = pathTo(node.children, id, next);
        if (hit) return hit;
      }
    }
    return null;
  }

  const gridFolder = $derived(
    curFolderId ? findNode(snapshot.tree, curFolderId) : null,
  );

  /** 面包屑：根（虚拟）→ … → 当前文件夹 */
  const gridTrail = $derived(
    curFolderId ? (pathTo(snapshot.tree, curFolderId) ?? []) : [],
  );

  /** 当前层要显示的内容：null 时是最顶层的两个根节点 */
  const gridNodes = $derived(gridFolder ? (gridFolder.children ?? []) : snapshot.tree);

  /** 文件夹排在前面 —— 和文件管理器一致 */
  const gridSubfolders = $derived(gridNodes.filter((n) => !n.url));
  const gridBookmarks = $derived(gridNodes.filter((n) => Boolean(n.url)));

  /** 搜索时用的平铺结果：只要能跳转的书签 */
  const gridItems = $derived(visibleFlat.filter((n) => Boolean(n.url)));

  function enterFolder(id: string) {
    curFolderId = id;
    // 进入新的一层后把内容区滚回顶部，否则会停在上一层的滚动位置
    bodyEl?.scrollTo({ top: 0 });
  }

  function goUp() {
    // 面包屑倒数第二项就是父级；只有一层时回到顶层
    curFolderId = gridTrail.length > 1 ? (gridTrail[gridTrail.length - 2]?.id ?? null) : null;
  }

  const totalCount = $derived(snapshot.count);
  const atLimit = $derived(
    shortcutsStore.getState().shortcuts.length >= SHORTCUT_LIMITS.max,
  );

  // 默认展开根节点的直接子级，让弹窗一打开就有内容可看
  $effect(() => {
    if (expanded.size > 0) return;
    const ids = new Set<string>();
    for (const root of snapshot.tree) {
      if (root.children?.length) ids.add(root.id);
    }
    if (ids.size) expanded = ids;
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- 遮罩：点击关闭 -->
<div class="overlay" role="presentation" onclick={close}></div>

<div
  bind:this={panelEl}
  class="dialog glass"
  role="dialog"
  aria-modal="true"
  aria-labelledby="bm-title"
  aria-describedby="bm-status"
>
  <!-- ── 顶部：标题 + 搜索 + 关闭 ── -->
  <header class="dialog__head">
    <h2 class="dialog__title" id="bm-title">
      <SvgIcon name="star" size={16} />
      <span>收藏夹</span>
    </h2>

    <div class="dialog__search">
      <SvgIcon name="search" size={14} class="dialog__search-icon" />
      <input
        bind:this={searchEl}
        class="dialog__search-input"
        type="text"
        bind:value={query}
        placeholder="搜索书签"
        aria-label="搜索书签"
        autocomplete="off"
      />
      {#if query}
        <button
          class="dialog__search-clear"
          type="button"
          aria-label="清空搜索"
          onclick={() => (query = '')}
        >
          <SvgIcon name="close" size={12} />
        </button>
      {/if}
    </div>

    <!--
      视图切换：列表 / 网格。
      每个按钮直达自己的目标值（显式传参），不再从 data-* 里读；
      并且带上了可见文字标签 —— 状态变化一眼可辨，不需要靠图标明暗去猜。
    -->
    <div class="view-toggle" role="group" aria-label="视图方式">
      <button
        class="view-toggle__btn"
        class:view-toggle__btn--on={view === 'list'}
        type="button"
        aria-pressed={view === 'list'}
        title="列表视图"
        onpointerdown={toList}
        onclick={toList}
      >
        <SvgIcon name="list" size={14} />
        <span class="view-toggle__label">列表</span>
      </button>
      <button
        class="view-toggle__btn"
        class:view-toggle__btn--on={view === 'grid'}
        type="button"
        aria-pressed={view === 'grid'}
        title="网格视图"
        onpointerdown={toGrid}
        onclick={toGrid}
      >
        <SvgIcon name="grid" size={14} />
        <span class="view-toggle__label">网格</span>
      </button>
    </div>

    <button
      class="btn btn--ghost btn--icon"
      type="button"
      aria-label="关闭收藏夹"
      onclick={close}
    >
      <SvgIcon name="close" size={16} />
    </button>
  </header>

  <!-- ── 中部：内容区独立滚动 ── -->
  <div bind:this={bodyEl} class="dialog__body scroll-area">
    {#if loading}
      <div class="state">
        <p class="state__text">正在读取收藏夹…</p>
      </div>
    {:else if snapshot.state === 'denied' && !usingDemo}
      <!-- 权限被拒 -->
      <div class="state">
        <span class="state__ic"><SvgIcon name="warning" size={26} /></span>
        <h3 class="state__title">无法访问收藏夹</h3>
        <p class="state__text">
          扩展需要「读取收藏夹」权限才能显示书签。<br />
          请在扩展详情页重新授权后返回。
        </p>
        <button class="btn btn--primary" type="button" onclick={openPermissionPage}>
          前往授权
        </button>
      </div>
    {:else if totalCount === 0}
      <!-- 空状态 -->
      <div class="state">
        <span class="state__ic"><SvgIcon name="bookmark-plus" size={26} /></span>
        <h3 class="state__title">收藏夹是空的</h3>
        <p class="state__text">
          在浏览器里收藏一些网页，它们会自动出现在这里，<br />
          然后就可以一键导入为快捷方式。
        </p>
      </div>
    {:else if isSearching}
      <!-- 搜索结果：平铺 -->
      {#if visibleFlat.length === 0}
        <div class="state">
          <p class="state__text">没有匹配「{query}」的书签</p>
        </div>
      {:else}
        <p class="dialog__count">找到 {gridItems.length} 个书签</p>
        {#if view === 'grid'}
          {@render bookmarkGrid(gridItems)}
        {:else}
          <ul class="list">
            {#each visibleFlat as node (node.id)}
              {@render bookmarkRow(node, 0, false)}
            {/each}
          </ul>
        {/if}
      {/if}
    {:else if view === 'grid'}
      <!-- 网格视图：文件夹层级（面包屑 + 进入），格子和起始页快捷方式同一套视觉 -->
      <nav class="bm-nav" aria-label="收藏夹路径">
        <button
          class="bm-nav__crumb"
          class:bm-nav__crumb--root={gridTrail.length === 0}
          type="button"
          onclick={() => (curFolderId = null)}
          title="回到最顶层"
        >
          <SvgIcon name="star" size={13} />
          <span>全部书签</span>
        </button>

        {#each gridTrail as node, i (node.id)}
          <span class="bm-nav__sep" aria-hidden="true">/</span>
          <button
            class="bm-nav__crumb"
            class:bm-nav__crumb--on={i === gridTrail.length - 1}
            type="button"
            onclick={() => (curFolderId = node.id)}
            title={node.title}
          >
            <span>{node.title || '收藏夹'}</span>
          </button>
        {/each}

        {#if gridTrail.length > 0}
          <button class="bm-nav__up" type="button" onclick={goUp} title="返回上级">
            <SvgIcon name="arrow-up" size={13} />
            <span>上级</span>
          </button>
        {/if}
      </nav>

      {#if gridNodes.length === 0}
        <div class="state">
          <p class="state__text">这个文件夹是空的</p>
        </div>
      {:else}
        <p class="dialog__count">
          {gridSubfolders.length} 个文件夹 · {gridBookmarks.length} 个书签
        </p>
        <div class="bm-grid">
          {#each gridSubfolders as node (node.id)}
            {@render folderCard(node)}
          {/each}
          {#each gridBookmarks as node (node.id)}
            {@render bookmarkCard(node)}
          {/each}
        </div>
      {/if}
    {:else}
      <!-- 书签树：多级展开 / 折叠 -->
      <ul class="list list--tree" role="tree" aria-label="书签列表">
        {#each snapshot.tree as root (root.id)}
          {@render treeNode(root, 0)}
        {/each}
      </ul>
    {/if}
  </div>

  <!-- ── 底部：状态栏 ── -->
  <footer class="dialog__foot" id="bm-status">
    <span class="dialog__status">
      {#if usingDemo}
        <SvgIcon name="info" size={13} />
        <span>当前为演示数据 · 授权后显示真实收藏夹</span>
      {:else if selected.size > 0}
        <SvgIcon name="check" size={13} />
        <span>已选 {selected.size} 个</span>
      {:else}
        <SvgIcon name="bookmark-plus" size={13} />
        <span>{totalCount} 个书签</span>
      {/if}
    </span>

    <span class="dialog__actions">
      <!-- 撤回：只在有历史时出现，紧挨着操作按钮组 -->
      <UndoButton />

      {#if atLimit}
        <span class="dialog__limit">快捷方式已达上限</span>
      {:else}
        <!-- 多选开关：默认开启，「点一行 = 勾选」 -->
        <label class="dialog__multi" class:dialog__multi--on={multiMode}>
          <input
            type="checkbox"
            checked={multiMode}
            onchange={(e) => {
              multiMode = (e.currentTarget as HTMLInputElement).checked;
              if (!multiMode) uiStore.getState().clearBookmarkSelection();
            }}
          />
          <span>多选</span>
        </label>

        {#if multiMode && visibleFlat.length > 0}
          <button
            class="btn btn--ghost"
            type="button"
            onclick={toggleSelectAll}
            title="全选 / 取消全选当前列表"
          >
            {visibleFlat.every((n) => selected.has(n.id)) ? '取消全选' : '全选'}
          </button>
        {/if}

        {#if selected.size > 0}
          <button
            class="btn btn--primary btn--import"
            type="button"
            onclick={importSelected}
          >
            <span class="btn__badge" aria-hidden="true">
              <SvgIcon name="bookmark-plus" size={14} />
            </span>
            导入为快捷方式（{selected.size}）
          </button>
        {/if}
      {/if}
      <button class="btn" type="button" onclick={close}>关闭</button>
    </span>
  </footer>
</div>

<!-- ── 收藏夹内的右键菜单 ── -->
{#if rowMenu}
  {#if rowMenu.isFolder}
    <ContextMenu
      x={rowMenu.x}
      y={rowMenu.y}
      items={[
        { id: 'import-folder', label: '全部导入为快捷方式', icon: 'bookmark-plus' },
      ]}
      onselect={(id) => {
        const node = rowMenu?.node;
        rowMenu = null;
        if (node && id === 'import-folder') void importFolder(node);
      }}
      onclose={() => (rowMenu = null)}
    />
  {:else}
    <ContextMenu
      x={rowMenu.x}
      y={rowMenu.y}
      items={[
        { id: 'open', label: '打开', icon: 'external-link' },
        { id: 'import-one', label: '导入为快捷方式', icon: 'bookmark-plus' },
      ]}
      onselect={(id) => {
        const node = rowMenu?.node;
        rowMenu = null;
        if (!node) return;
        if (id === 'open') openBookmark(node);
        if (id === 'import-one') requestImport(node);
      }}
      onclose={() => (rowMenu = null)}
    />
  {/if}
{/if}

<!-- ── 单个导入：自定义名字 ── -->
{#if pendingImport}
  <div
    class="name-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="自定义快捷方式名字"
  >
    <div class="name-dialog__panel glass">
      <h3 class="name-dialog__title">添加到快捷方式</h3>
      <p class="name-dialog__url">{pendingImport.url}</p>
      <label class="field__label" for="bm-import-name">名字</label>
      <input
        id="bm-import-name"
        bind:this={nameInputEl}
        class="input name-dialog__field"
        bind:value={importName}
        type="text"
        maxlength={32}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void confirmImport();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelImport();
          }
        }}
      />
      <div class="name-dialog__actions">
        <button class="btn" type="button" onclick={cancelImport}>取消</button>
        <button class="btn btn--primary" type="button" onclick={confirmImport}>
          添加
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── 模板片段 ── -->

{#snippet treeNode(node: BookmarkNode, depth: number)}
  {#if node.url}
    {@render bookmarkRow(node, depth, false)}
  {:else}
    {@const children = node.children ?? []}
    {#if children.length > 0}
      {@const count = matchCount(node)}
      <li
        class="node"
        role="treeitem"
        aria-expanded={isExpanded(node)}
        aria-selected={false}
      >
        <button
          class="row row--folder"
          type="button"
          style:--depth={depth}
          onclick={() => toggle(node)}
          oncontextmenu={(e) => openRowMenu(e, node)}
          aria-label={`${isExpanded(node) ? '折叠' : '展开'}文件夹 ${node.title}`}
        >
          <span class="row__caret" class:row__caret--open={isExpanded(node)}>
            <SvgIcon name="chevron-right" size={13} />
          </span>
          <span class="row__folder-icon"><SvgIcon name="folder" size={15} /></span>
          <span class="row__title">{node.title || '收藏夹'}</span>
          {#if count > 0}
            <span class="row__badge">{count}</span>
          {/if}
          <span class="row__meta">{children.length}</span>
        </button>

        {#if isExpanded(node)}
          <ul class="list list--nested" role="group">
            {#each children as child (child.id)}
              {@render treeNode(child, depth + 1)}
            {/each}
          </ul>
        {/if}
      </li>
    {/if}
  {/if}
{/snippet}

{#snippet bookmarkRow(node: BookmarkNode, depth: number, _nested: boolean)}
  <li class="node" role="treeitem" aria-selected={isSelected(node.id)}>
    <div class="row row--bookmark" class:row--checked={isSelected(node.id)} style:--depth={depth}>
      {#if multiMode}
        <!-- 多选勾选框：点击整行即可勾选，不必精确点中小方块 -->
        <button
          class="row__check"
          class:row__check--on={isSelected(node.id)}
          type="button"
          role="checkbox"
          aria-checked={isSelected(node.id)}
          aria-label={`选择 ${node.title || node.url}`}
          onclick={() => toggleSelect(node.id)}
        >
          {#if isSelected(node.id)}
            <SvgIcon name="check" size={11} />
          {/if}
        </button>
      {/if}

      <button
        class="row__main"
        type="button"
        onclick={() => (multiMode ? toggleSelect(node.id) : openBookmark(node))}
        oncontextmenu={(e) => openRowMenu(e, node)}
        title={node.url}
      >
        <span class="row__dot" aria-hidden="true"></span>
        <span class="row__title">{node.title || node.url}</span>
        <span class="row__url">{node.url}</span>
      </button>

      <button
        class="row__import"
        type="button"
        aria-label={`把 ${node.title} 导入到快捷方式`}
        title="导入到快捷方式（可自定义名字）"
        disabled={importingId === node.id || atLimit}
        onclick={() => requestImport(node)}
      >
        {#if importingId === node.id}
          <span class="row__spinner" aria-hidden="true"></span>
        {:else}
          <SvgIcon name="plus" size={13} />
        {/if}
      </button>
    </div>
  </li>
{/snippet}

<!-- ── 网格视图片段 ──
     正方形格子：网站 logo 在上、名字在下，与起始页「快捷方式」同一套排版。 -->
{#snippet bookmarkGrid(items: BookmarkNode[])}
  {#if items.length === 0}
    <div class="state">
      <p class="state__text">没有可显示的书签</p>
    </div>
  {:else}
    <div class="bm-grid">
      {#each items as node (node.id)}
        {@render bookmarkCard(node)}
      {/each}
    </div>
  {/if}
{/snippet}

<!-- 文件夹格子：文件管理器里的「文件夹」—— 点一下进入下一层；
     右键 = 把整个文件夹一次性导入为快捷方式。 -->
{#snippet folderCard(node: BookmarkNode)}
  <button
    class="bm-card bm-card--folder"
    type="button"
    title={`打开文件夹：${node.title}`}
    aria-label={`文件夹 ${node.title}`}
    oncontextmenu={(e) => openRowMenu(e, node)}
    onclick={() => enterFolder(node.id)}
  >
    <span class="bm-card__ic bm-card__ic--folder" aria-hidden="true">
      <SvgIcon name="folder" size={22} />
    </span>
    <span class="bm-card__title">{node.title || '收藏夹'}</span>
  </button>
{/snippet}

{#snippet bookmarkCard(node: BookmarkNode)}
  <!-- ShortcutLogo 需要 Shortcut 形状的对象，这里按需合成一个只读的视图对象：
       只用到 name / url / icon / id 四个字段，其余给稳定的占位值即可。 -->
  {@const logo = {
    id: node.id,
    name: node.title || node.url || '',
    url: node.url ?? '',
    icon: 'auto',
    hideName: false,
    order: 0,
    createdAt: node.dateAdded ?? 0,
  }}
  <button
    class="bm-card"
    class:bm-card--on={isSelected(node.id)}
    type="button"
    title={node.url}
    aria-label={`${node.title || node.url}${isSelected(node.id) ? '（已选）' : ''}`}
    oncontextmenu={(e) => openRowMenu(e, node)}
    onclick={() => (multiMode ? toggleSelect(node.id) : requestImport(node))}
  >
    <!-- 图标位：格子里书签一律显示网站 logo（favicon），
         加载失败时 ShortcutLogo 会退化成域名首字母渐变块。
         尺寸与起始页快捷方式同量级（40px），一眼就能认出是哪个站。 -->
    <span class="bm-card__ic" aria-hidden="true">
      <ShortcutLogo shortcut={logo} size={40} />
    </span>
    <span class="bm-card__title">{node.title || node.url}</span>
    {#if isSelected(node.id)}
      <span class="bm-card__check" aria-hidden="true">
        <SvgIcon name="check" size={11} />
      </span>
    {/if}
  </button>
{/snippet}

<style>
  /* ── 弹窗尺寸：720×560，最高 80vh；窄屏 90vw×70vh ──
     玻璃材质（背景 / 透明度 / 描边 / blur / 顶部高光 / 底部收暗 / 圆角）
     全部来自全局 .glass，与快捷方式底板、搜索卡片**完全同款**。
     这里只补：模态定位 + 更重的一层外投影（弹窗悬浮层级更高，
     但投影只影响「浮多高」，不改变玻璃本身的材质观感）。 */
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: var(--z-dialog);
    display: flex;
    flex-direction: column;
    width: 720px;
    height: 560px;
    max-height: 80vh;
    /* 弹窗本身不滚动，滚动交给 .dialog__body */
    overflow: hidden;
    /* 只覆盖「外投影」这一段，三段 inset 高光/收暗继续沿用 .glass 的定义 */
    box-shadow:
      inset 0 1px 0 var(--glass-frost),
      inset 0 -1px 0 color-mix(in srgb, var(--shadow) 28%, transparent),
      0 32px 80px -20px var(--shadow);
    animation: dialog-in var(--dur-slow) var(--ease-out);
  }

  @keyframes dialog-in {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 12px)) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  @media (max-width: 780px) {
    .dialog {
      width: 90vw;
      height: 70vh;
      max-height: 70vh;
    }
  }

  /* ── 顶部 ── */
  .dialog__head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--glass-border);
    flex: none;
  }

  .dialog__title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
    white-space: nowrap;
    color: var(--text);
  }

  .dialog__title :global(svg) {
    color: var(--accent);
  }

  /* ── 视图切换（列表 / 网格）──
     这是弹窗里唯一切换视图的入口，必须永远可点、状态一眼可辨。
     特意做了几层保险：
       · position: relative + z-index —— 抬起层级，不被标题/搜索框盖住；
       · flex: none + flex-shrink: 0 —— 窄弹窗下也不会被搜索框挤没；
       · pointer-events: auto —— 显式声明可交互（防被祖先的 none 影响）；
       · 明确的 hover/active/焦点态 —— 即使 JS 未响应也能看出它是按钮。 */
  .view-toggle {
    position: relative;
    z-index: 5;
    display: flex;
    gap: 2px;
    padding: 2px;
    flex: none;
    flex-shrink: 0;
    pointer-events: auto;
    border-radius: var(--radius-md);
    border: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--text) 5%, transparent);
  }

  .view-toggle__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px;
    flex: none;
    /* 图标本身不参与命中测试，点击永远落在按钮上 */
    pointer-events: auto;
    border-radius: calc(var(--radius-md) - 3px);
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  /* 带可见文字标签：状态变化一眼可辨，不用靠图标明暗去猜 */
  .view-toggle__label {
    font-size: var(--fs-xs);
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
  }

  .view-toggle__btn :global(svg) {
    pointer-events: none;
  }

  .view-toggle__btn:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 9%, transparent);
  }

  .view-toggle__btn:active {
    transform: scale(0.94);
  }

  /* 选中态：强调色文字 + 强调色底，与未选中的灰色明确区分 */
  .view-toggle__btn--on,
  .view-toggle__btn--on:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .view-toggle__btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* ── 面包屑（网格视图的文件夹层级）──
     始终贴着内容区顶部：`全部书签 / 收藏夹栏 / …`，点任意一段回到那一层；
     右侧是「上级」，等价于文件管理器的返回键。 */
  .bm-nav {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 4px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 18%, transparent);
    margin-bottom: 10px;
  }

  .bm-nav__crumb {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 180px;
    padding: 3px 8px;
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: 999px;
    background: transparent;
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .bm-nav__crumb:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  /* 当前所在的那一层：强调色，一眼知道自己在哪 */
  .bm-nav__crumb--on,
  .bm-nav__crumb--on:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .bm-nav__crumb span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bm-nav__sep {
    color: var(--text-secondary);
    opacity: 0.5;
    font-size: var(--fs-xs);
  }

  .bm-nav__up {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 3px 9px;
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--line) 26%, transparent);
    background: color-mix(in srgb, var(--text) 4%, transparent);
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-soft),
      border-color var(--dur-fast) var(--ease-soft);
  }

  .bm-nav__up:hover {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }

  /* 文件夹格子：虚线描边 + 强调色图标，与「书签格子（网站 logo）」一眼区分 */
  .bm-card--folder {
    border-style: dashed;
    background: color-mix(in srgb, var(--text) 2.5%, transparent);
  }

  .bm-card--folder:hover {
    border-style: solid;
  }

  .bm-card__ic--folder {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  /* ── 网格视图：与起始页「快捷方式」同一套方块排版 ──
     一列多少个格子交给 auto-fill + minmax，列宽跟着弹窗宽度自适应；
     格子纵向堆叠：logo 在上、名字在下，圆角走 --shortcut-radius，
     于是设置里那根「圆角大小」滑块对收藏夹格子和起始页图标同样生效。 */
  .bm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: clamp(6px, 1vw, 12px);
    padding: 2px 2px 8px;
  }

  .bm-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding: 10px 6px 8px;
    text-align: center;
    border-radius: var(--radius-md);
    border: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--text) 4%, transparent);
    cursor: pointer;
    transition:
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft),
      transform var(--dur-fast) var(--ease-out);
  }

  .bm-card:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    transform: translateY(-1px);
  }

  .bm-card:active {
    transform: scale(0.97);
  }

  .bm-card--on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .bm-card__ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    /* logo 是彩色位图，底色保持中性，别让强调色染到 favicon 上 */
    border-radius: var(--shortcut-radius);
    background: color-mix(in srgb, var(--text) 6%, transparent);
    overflow: hidden;
  }

  .bm-card__title {
    width: 100%;
    font-size: var(--fs-xs);
    line-height: 1.25;
    color: var(--text);
    /* 名字最多两行，超出的用省略号 —— 方块里宽度有限，换行比截断更好认 */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    word-break: break-word;
  }

  .bm-card__check {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    color: #fff;
    background: var(--accent);
  }

  .dialog__search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
  }

  /* 类名通过组件 prop 透传，静态分析看不到，用 :global 明确作用域 */
  .dialog__search :global(.dialog__search-icon) {
    position: absolute;
    left: 10px;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .dialog__search-input {
    width: 100%;
    height: 32px;
    padding: 0 30px 0 32px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--text) 5%, transparent);
    font-size: var(--fs-base);
    transition:
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .dialog__search-input:focus {
    outline: none;
    border-color: var(--accent);
    background: transparent;
  }

  .dialog__search-clear {
    position: absolute;
    right: 8px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: var(--text-secondary);
  }

  .dialog__search-clear:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  /* ── 内容区：独立滚动 ── */
  .dialog__body {
    flex: 1;
    min-height: 0;
    padding: 8px;
  }

  .dialog__count {
    margin: 6px 10px 8px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  /* ── 底部 ── */
  .dialog__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid var(--glass-border);
    flex: none;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .dialog__status {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .dialog__status span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dialog__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .dialog__limit {
    color: var(--text-secondary);
    opacity: 0.8;
  }

  /* ── 导入按钮：文案强化 ──
     「导入为快捷方式」是本弹窗的主行动点（primary path），
     因此给它一个独立的高辨识度图标徽章，而不是塞在文字行里的小图标。 */
  .btn--import {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding-left: 7px;
    font-weight: 600;
  }

  .btn__badge {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    flex: none;
    border-radius: calc(var(--radius-sm) - 1px);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    box-shadow: inset 0 1px 0 var(--glass-frost);
  }

  /* primary 按钮自身是强调色底，徽章要反相才不会糊成一片 */
  .btn--primary .btn__badge {
    color: #fff;
    background: color-mix(in srgb, #fff 22%, transparent);
  }

  .btn--import :global(svg) {
    flex: none;
  }

  /* 多选开关：pill 形态，与操作按钮区分 */
  .dialog__multi {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    border: 1px solid var(--glass-border);
    background: var(--glass-bg);
    cursor: pointer;
    user-select: none;
    transition:
      color var(--dur-fast) var(--ease-soft),
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .dialog__multi:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .dialog__multi--on {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .dialog__multi input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  /* ── 列表 ── */
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .list--nested {
    margin-left: 14px;
    border-left: 1px solid var(--line);
    padding-left: 4px;
  }

  .node {
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    padding-left: calc(var(--depth, 0) * 2px);
    transition: background-color var(--dur-fast) var(--ease-soft);
  }

  .row:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .row--folder {
    width: 100%;
    gap: 7px;
    padding-top: 7px;
    padding-bottom: 7px;
    padding-right: 8px;
    text-align: left;
    color: var(--text);
  }

  .row__caret {
    display: grid;
    place-items: center;
    width: 14px;
    flex: none;
    color: var(--text-secondary);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .row__caret--open {
    transform: rotate(90deg);
  }

  .row__folder-icon {
    display: grid;
    place-items: center;
    flex: none;
    color: var(--accent);
    opacity: 0.85;
  }

  .row__title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-base);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row__badge {
    flex: none;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .row__meta {
    flex: none;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    opacity: 0.7;
    min-width: 18px;
    text-align: right;
  }

  /* 书签行 */
  .row--bookmark {
    gap: 6px;
    padding-top: 5px;
    padding-bottom: 5px;
    padding-right: 6px;
  }

  .row__main {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    text-align: left;
  }

  .row__dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex: none;
    background: var(--text-secondary);
    opacity: 0.5;
  }

  .row__url {
    flex: 0 1 auto;
    max-width: 45%;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.75;
  }

  /* 导入按钮：默认淡出，hover / focus 时显现，避免视觉噪音 */
  .row__import {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-soft),
      color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .row:hover .row__import,
  .row__import:focus-visible {
    opacity: 1;
  }

  .row__import:hover:not(:disabled) {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .row__import:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }

  /* 批量导入用的勾选框 */
  .row__check {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: 5px;
    border: 1.5px solid color-mix(in srgb, var(--text) 30%, transparent);
    background: transparent;
    cursor: pointer;
    transition:
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .row__check:hover {
    border-color: var(--accent);
  }

  .row__check--on {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }

  .row--checked {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .row--checked:hover {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  /* ── 命名弹层（单条导入时先问名字）──
     这是一层「弹窗里的弹窗」，必须盖住收藏夹弹窗本身，
     因此用 position: fixed 铺满视口 + --z-nested（高于 --z-dialog）。
     之前写的是 position: absolute + z-index: 30，低于弹窗的 100，
     结果整块被压在下面点不到 —— 这正是需求里要修的那个 bug。 */
  .name-dialog {
    position: fixed;
    inset: 0;
    z-index: var(--z-nested);
    display: grid;
    place-items: center;
    background: color-mix(in srgb, #000 42%, transparent);
    backdrop-filter: blur(3px);
  }

  /* 命名弹层的内面板：走统一毛玻璃材质与圆角（跟随全局圆角滑块） */
  .name-dialog__panel {
    width: min(360px, calc(100% - 48px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    border-radius: var(--radius-xl);
    background: var(--glass-surface);
    border: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
    box-shadow:
      inset 0 1px 0 var(--glass-frost),
      0 18px 48px color-mix(in srgb, #000 45%, transparent);
  }

  .name-dialog__title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text);
  }

  .name-dialog__url {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.75;
  }

  .name-dialog__field {
    width: 100%;
    padding: 9px 11px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-base);
    color: var(--text);
    background: color-mix(in srgb, var(--text) 7%, transparent);
    border: 1px solid var(--glass-border);
    outline: none;
  }

  .name-dialog__field:focus {
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .name-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .row__spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--line);
    border-top-color: var(--accent);
    animation: spin 640ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── 状态页 ── */
  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 260px;
    padding: 32px 24px;
    text-align: center;
  }

  .state__ic {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .state__title {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .state__text {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.7;
    color: var(--text-secondary);
  }
</style>
