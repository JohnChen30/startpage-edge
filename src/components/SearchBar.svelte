<!--
  搜索框 —— 项目的视觉核心

  当前方案（第四轮精修后）：
   · 输入区是一块毛玻璃圆角矩形，文字完全落在块内。
   · 不再有下方的「白线」（立体线条）—— 需求要求去掉，块底保持干净。
   · 输入到边界时输入框「向上生长」：内部是一个可换行的 textarea，
     内容变多时它按实际行数增高，而外层卡片以底部为锚点向上扩展，
     于是先输入的文字被顶到上面的行，视觉上像向上滚动。

  交互：
   · Enter  → 默认引擎搜索，当前页跳转（Shift+Enter 才换行）
   · 推荐下拉 ↑↓ 选择 / Enter 确认 / Esc 关闭
-->
<script lang="ts">
  import SuggestDropdown from './SuggestDropdown.svelte';
  import SvgIcon from './SvgIcon.svelte';
  import { settingsStore } from '../stores/settings';
  import { enginesStore } from '../stores/engines';
  import { bookmarksStore } from '../stores/bookmarks';
  import { uiStore } from '../stores/ui';
  import { buildSuggestions, debounce, looksLikeUrl } from '../lib/suggest';
  import { navigateCurrentTab, runSearch } from '../lib/platform';
  import type { SuggestItem } from '../types';

  interface Props {
    /**
     * 由父组件传入，仅作为「设置变更」的响应式信号；
     * 组件内部一律走 settingsStore.getState() 读取最新值，
     * 避免闭包只捕获初始值。
     */
    settings: import('../types').Settings;
  }

  let { settings: _settings }: Props = $props();

  // ── 输入状态 ──
  let query = $state('');
  let focused = $state(false);
  let suggestions = $state<SuggestItem[]>([]);
  let activeIndex = $state(-1);
  let dropdownOpen = $state(false);

  /** 用 textarea 承载输入：必须能换行，才能实现「向上生长」的多行效果 */
  let inputEl = $state<HTMLTextAreaElement | undefined>(undefined);
  /** 输入区实测行数（1 行起步），驱动外框高度与卡片向上生长 */
  let rows = $state(1);

  /** 单行行高（px），与 CSS 里的 line-height 保持一致，用于把 scrollHeight 换算成行数 */
  const LINE_HEIGHT = 36;
  /** 最多显示的行数，超过后输入区内部滚动（否则会无限长） */
  const MAX_ROWS = 5;

  /**
   * 重新按内容测量行数。
   * 先归零高度再读 scrollHeight，否则 textarea 只会「越长越高」不会回缩。
   */
  function autoGrow() {
    const el = inputEl;
    if (!el) return;
    el.style.height = 'auto';
    const needed = Math.ceil(el.scrollHeight / LINE_HEIGHT);
    rows = Math.min(MAX_ROWS, Math.max(1, needed));
    el.style.height = `${rows * LINE_HEIGHT}px`;
  }

  // 输入变化 / 窗口尺寸变化后重新测量
  $effect(() => {
    // 依赖 query 与 rows，任一变化都重算
    void query;
    void rows;
    autoGrow();
  });

  // ── 推荐计算（防抖 150–250ms） ──
  // 只推荐收藏夹内容：搜索词本身不再生成「用 X 搜索」的兜底项，
  // 因此没有匹配时列表为空，下拉自然不显示，不会盖住下方引擎栏。
  function computeSuggest(q: string) {
    const s = settingsStore.getState().settings;
    if (!s.suggestEnabled || !q.trim()) {
      suggestions = [];
      dropdownOpen = false;
      return;
    }
    const engines = enginesStore.getState().engines;
    const defaultEngine = engines.find((e) => e.id === s.defaultEngineId) ?? engines[0];

    const items = buildSuggestions({
      query: q,
      bookmarks: bookmarksStore.getState().snapshot.flat,
      shortcuts: [],
      engines,
      defaultEngineId: s.defaultEngineId,
      engineUrlTemplate: defaultEngine?.urlTemplate ?? '',
      // 只取收藏夹命中项，不带搜索引擎兜底
      bookmarkOnly: true,
    });

    suggestions = items;
    dropdownOpen = items.length > 0;
    activeIndex = items.length ? 0 : -1;
  }

  // 防抖实例跟随设置变化重建：直接读 prop 只会捕获初始值，
  // 用户在设置里改了防抖时长这里就永远不生效。
  const runSuggest = $derived(
    debounce(computeSuggest, settingsStore.getState().settings.suggestDebounce),
  );

  function onInput(event: Event) {
    query = (event.target as HTMLTextAreaElement).value;
    // 同步给 EngineBar：点引擎时要用同一个词发起搜索
    uiStore.getState().setSearchQuery(query);
    runSuggest(query);
  }

  // ── 执行搜索 / 跳转 ──

  /** 用指定引擎搜索；不传引擎则用默认引擎 */
  function search(overrideEngineId?: string) {
    const engines = enginesStore.getState().engines;
    const settingsNow = settingsStore.getState().settings;
    const engine =
      engines.find((e) => e.id === (overrideEngineId ?? settingsNow.defaultEngineId)) ??
      engines[0];
    // 网址识别与「拼搜索 URL」都在 runSearch 里统一处理，
    // 保证这里与 EngineBar 的行为完全一致
    runSearch(query, engine);
  }

  /** 选中推荐项 */
  function choose(item: SuggestItem) {
    if (item.kind === 'bookmark' && item.url) {
      navigateCurrentTab(item.url);
    } else if (item.kind === 'search') {
      search(item.engineId);
    }
    closeDropdown();
  }

  /** 清空输入，并同步给 EngineBar */
  function clearQuery() {
    query = '';
    suggestions = [];
    uiStore.getState().setSearchQuery('');
    closeDropdown();
    // 高度回落到单行（autoGrow 在 $effect 里跟随 query 变化自动触发）
  }

  function closeDropdown() {
    dropdownOpen = false;
    activeIndex = -1;
  }

  function onKeydown(event: KeyboardEvent) {
    // 下拉关闭时按下方向键应该打开它
    if (!dropdownOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (suggestions.length) {
        dropdownOpen = true;
        activeIndex = 0;
        event.preventDefault();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        // 下拉打开时才拦方向键；否则让光标在 textarea 内正常上下移动
        if (dropdownOpen) {
          event.preventDefault();
          activeIndex = (activeIndex + 1) % suggestions.length;
        }
        break;
      case 'ArrowUp':
        if (dropdownOpen) {
          event.preventDefault();
          activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
        }
        break;
      case 'Enter':
        // Shift+Enter 留给换行（textarea 的默认行为）；
        // 单独 Enter = 发起搜索。
        if (event.shiftKey) return;
        event.preventDefault();
        if (dropdownOpen && activeIndex >= 0 && suggestions[activeIndex]) {
          choose(suggestions[activeIndex]);
        } else {
          search();
        }
        break;
      case 'Escape':
        event.preventDefault();
        if (dropdownOpen) closeDropdown();
        else {
          clearQuery();
          inputEl?.blur();
        }
        break;
    }
  }

  function onFocus() {
    focused = true;
    if (suggestions.length && query.trim()) dropdownOpen = true;
  }

  function onBlur() {
    focused = false;
    // 延迟关闭，否则点击下拉项时 blur 先触发导致点不中
    setTimeout(() => closeDropdown(), 120);
  }

  // ── 对外暴露：供全局快捷键调用 ──
  export function focus() {
    inputEl?.focus();
    inputEl?.select();
  }

  export function clear() {
    clearQuery();
  }

  // 回车键在输入框里也要能触发（部分输入法场景）
  const engines = $derived(enginesStore.getState().engines);
  const defaultEngine = $derived(
    engines.find((e) => e.id === settingsStore.getState().settings.defaultEngineId) ??
      engines[0],
  );

  /**
   * 输入内容是否像网址（http:// / https:// / www. / xxx.com …）。
   * 需求 11：识别为网址时，输入文字用强调色（蓝色）显示，提示「这一按是直接打开」。
   * textarea 无法只给部分文字上色，所以整段变成强调色 —— 语义是「整条输入被当作地址」。
   */
  const isUrl = $derived(looksLikeUrl(query));

  /** 输入非空时才出现的两个右侧动作按钮 */
  const showActions = $derived(query.length > 0);
</script>

<div class="search">
  <!--
    输入区：一块毛玻璃圆角矩形，文字完全落在块内。
    用 textarea 而不是 input —— 只有 textarea 能在达到边界时换行，
    从而支撑「输入变多时向上生长」的多行效果。
    下方不再有任何「白线」装饰（需求要求去掉）。
  -->
  <div
    class="search__field"
    class:search__field--growing={rows > 1}
    class:search__field--actions={showActions}
    style:--rows={rows}
  >
    <label class="sr-only" for="sp-search">搜索或输入网址</label>

    <textarea
      id="sp-search"
      bind:this={inputEl}
      class="search__input"
      class:search__input--url={isUrl}
      rows="1"
      value={query}
      placeholder={focused ? '' : '搜索或输入网址'}
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      aria-label="搜索或输入网址"
      aria-expanded={dropdownOpen}
      aria-controls="sp-suggest"
      aria-autocomplete="list"
      role="combobox"
      oninput={onInput}
      onkeydown={onKeydown}
      onfocus={onFocus}
      onblur={onBlur}
    ></textarea>

    <!--
      需求 10：输入框右侧的搜索按钮 —— 用**默认引擎**检索当前文字。
      与回车完全等价（走同一个 search()），只是多一个明确的点击目标。
      文字像网址时按钮切到「直达」语义，图标换成外链，避免误导成「搜索这个网址」。
    -->
    {#if showActions}
      <button
        class="search__go"
        class:search__go--url={isUrl}
        type="button"
        aria-label={isUrl
          ? '直接打开这个网址'
          : `用 ${defaultEngine?.name ?? '默认引擎'} 搜索`}
        title={isUrl
          ? '直接打开这个网址'
          : `用 ${defaultEngine?.name ?? '默认引擎'} 搜索`}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => search()}
      >
        <SvgIcon name={isUrl ? 'external-link' : 'search'} size={16} />
      </button>
    {/if}

    <!-- 输入非空时的轻量清除按钮 -->
    {#if showActions}
      <button
        class="search__clear"
        type="button"
        aria-label="清空输入"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          clearQuery();
          inputEl?.focus();
        }}
      >
        <SvgIcon name="close" size={14} />
      </button>
    {/if}
  </div>

  <!-- 推荐下拉：只在有收藏夹命中项时才渲染 -->
  {#if dropdownOpen}
    <SuggestDropdown
      id="sp-suggest"
      items={suggestions}
      {activeIndex}
      onchoose={choose}
      onhover={(i) => (activeIndex = i)}
    />
  {/if}
</div>

<style>
  .search {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* 撑满父级（大玻璃块的内宽），不再自己算宽度 */
    width: 100%;
    min-width: 0;
  }

  /* ── 文字区 ──
     不再有内嵌浅槽：底色与内阴影都已去掉。
     毛玻璃材质统一由外层 .search-block 的 backdrop-filter + 那层白色渐变承担
     （配方与快捷方式图标底板一致，见 App.svelte），
     文字直接落在那层虚化区域上，这里不再自己铺第二层。
     聚焦反馈同样不在这里画描边（外层那条 .search-block:focus-within 已删除，见 App.svelte），
     只留强调色光标 + 占位符淡出。
     高度由 --rows（textarea 实测行数）驱动；因为整段搜索卡片是
     「居中 + 向上生长」的，所以内容变多时是先输入的文字上移，
     而不是卡片向下撑 —— 这就是需求要的「向上延伸」效果。 */
  .search__field {
    position: relative;
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 左右留出清除按钮的等宽内边距，保证文字视觉居中而不是被按钮挤偏 */
    padding: 10px 34px;
  }

  /* 右侧出现两个动作按钮时，左右内边距同时加大 ——
     对称才不会把居中的文字顶偏。 */
  .search__field--actions {
    padding: 10px 74px;
  }

  /* 网址识别：整段文字切到强调色（需求 11）。
     textarea 做不到「只给一部分文字上色」，所以整条输入一起变蓝，
     语义正好对应「这一整条被当成网址」。 */
  .search__input--url {
    color: var(--accent);
    font-weight: 500;
  }

  .search__input {
    /* textarea：可换行，才能向上生长。宽度撑满、按内容自动定高。 */
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    border: none;
    background: transparent;
    padding: 0;
    /* 与 JS 里的 LINE_HEIGHT 保持一致，否则换算出的行数会有偏差 */
    font-family: var(--font-ui);
    /* 字号用全局档位，和设置面板同一套字体规范（只是搜索框更大一号） */
    font-size: var(--fs-search);
    font-weight: 400;
    letter-spacing: 0.01em;
    line-height: 36px;
    /* 文字居中：空输入时占位符也落在中轴线上 */
    text-align: center;
    color: var(--text);
    caret-color: var(--accent);
    transition: color var(--dur-base) var(--ease-soft);
    /* 换行 + 超过最大行数后内部纵向滚动（保持光标可见即可） */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow-y: auto;
    resize: none;
    scrollbar-width: none;
    /* 高度由 autoGrow() 直接写 style.height，这里只兜一个初始值 */
    height: 36px;
  }

  .search__input::-webkit-scrollbar {
    display: none;
  }

  .search__input:focus {
    outline: none;
  }

  .search__input::placeholder {
    color: var(--text-secondary);
    opacity: 0.52;
    transition: opacity var(--dur-base) var(--ease-soft);
  }

  .search__input:focus::placeholder {
    opacity: 0;
  }

  .search__clear {
    position: absolute;
    right: 12px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: var(--text-secondary);
    opacity: 0.7;
    transition:
      opacity var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  .search__clear:hover {
    opacity: 1;
    background: var(--glass-bg);
  }

  /* ── 右侧「搜索 / 直达」按钮（需求 10）──
     最右是主行动点（跳转），清除按钮退到它左边，避免误点。 */
  .search__go {
    position: absolute;
    right: 40px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text) 7%, transparent);
    transition:
      color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft),
      transform var(--dur-fast) var(--ease-out);
  }

  .search__go:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    transform: scale(1.06);
  }

  .search__go:active {
    transform: scale(0.94);
  }

  /* 识别为网址：按钮整体切成强调色实底，语义从「搜索」变「直接打开」 */
  .search__go--url {
    color: #fff;
    background: var(--accent);
  }

  .search__go--url:hover {
    color: #fff;
    background: color-mix(in srgb, var(--accent) 86%, #000);
  }

  /* ── 输入区底部不再压「白线」装饰 ──
     第四轮需求 6：去掉搜索框下方那条白线。
     原先这里是一整套 Vision Pro 五层玻璃线条（毛玻璃过渡层 / 基座 /
     高光棱 / 主体线 / 投影）     + 聚焦强调层，现整块删除。
     玻璃质感统一由外层 .search-block 的 backdrop-filter 承担；
     内嵌浅槽的底色也已一并去掉（模块不要边框和底色），
     所以输入区现在完全透明，只剩文字与光标。 */

  @media (max-width: 640px) {
    .search__input {
      font-size: 17px;
    }
  }
</style>
