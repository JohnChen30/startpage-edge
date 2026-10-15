<!--
  搜索引擎栏

  行为规格：
   · 图标来源为内置 SVG / 本地资源，不热链第三方
   · 默认引擎用「填充圆角矩形」明显标记
   · 回车永远用默认引擎搜索（在 SearchBar 处理）
   · 输入框为空时，左键点击某个引擎 → 把它设为默认引擎
   · 输入框有内容时，左键点击某个引擎 → 立即用该引擎搜索，当前页跳转
   · 右键任意引擎 → 弹出菜单，可将其设为默认引擎 / 用该引擎搜索
   · 图标行居中排布，与上方输入文字共用同一条中轴
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { getSvgIcon } from '../lib/icons';
  import { enginesStore } from '../stores/engines';
  import { settingsStore } from '../stores/settings';
  import { uiStore } from '../stores/ui';
  import { runSearch } from '../lib/platform';
  import { getIcon } from '../lib/indexeddb';
  import { reorderIds, sortable } from '../lib/sortable';
  import type { SearchEngine } from '../types';

  let engines = $state(enginesStore.getState().engines);
  let defaultEngineId = $state(settingsStore.getState().settings.defaultEngineId);
  /** 自定义图标的 objectURL 缓存 */
  let iconUrls = $state<Record<string, string>>({});

  /** 引擎图标行容器：拖拽排序需要拿到它来枚举同级项 */
  let rootEl = $state<HTMLDivElement | undefined>(undefined);
  /** 拖拽进行中：用于给整行加 grabbing 光标 */
  let sorting = $state(false);

  /**
   * `icon` 是 http(s) 绝对地址时，直接用 <img> 远程加载
   * （目前 DeepSeek 走 favicon.im 取网站原图）。
   */
  function isRemoteIcon(icon: string): boolean {
    return /^https?:\/\//i.test(icon);
  }

  /**
   * 记录加载失败的图标引用。
   *
   * 键取 icon 本身而不是引擎 id：用户一旦换图标，键就变了，
   * 新地址天然获得一次重新尝试的机会，不会被旧的失败记录连累。
   */
  let failedIcons = $state<Record<string, true>>({});

  /** 图标最终以什么形式呈现 */
  type IconView =
    | { kind: 'remote'; src: string }
    | { kind: 'svg'; name: string }
    | { kind: 'memo'; text: string };

  /**
   * 搜索词从共享 store 读取。
   * 早先试图通过 props 从 SearchBar 传入，但 App.svelte 并没有接这条线，
   * 结果 EngineBar 拿到的永远是空串 —— 点任何引擎都只会去切换默认引擎，
   * 表现就是「点了没反应」。改为共享 store 后两边天然一致。
   */
  let query = $state(uiStore.getState().searchQuery);

  $effect(() => {
    const off1 = enginesStore.subscribe((s) => {
      engines = s.engines;
    });
    const off2 = settingsStore.subscribe((s) => {
      defaultEngineId = s.settings.defaultEngineId;
    });
    const off3 = uiStore.subscribe((s) => {
      query = s.searchQuery;
    });
    return () => {
      off1();
      off2();
      off3();
    };
  });

  const sorted = $derived([...engines].sort((a, b) => a.order - b.order));

  // 加载自定义图标（icon 字段为 IndexedDB ref 时）
  $effect(() => {
    const list = sorted;
    const known = new Set(Object.keys(iconUrls));
    void (async () => {
      for (const e of list) {
        // 判定「内置 SVG」直接查图标库，不再维护一份手写白名单 ——
        // 之前每次新增引擎都要记得同步改白名单，漏改就会退化成首字母。
        // 远程地址与内置引擎都无需查 IndexedDB，直接跳过。
        if (
          Boolean(e.builtin) ||
          isRemoteIcon(e.icon) ||
          getSvgIcon(e.icon) ||
          known.has(e.icon)
        ) {
          continue;
        }
        try {
          const blob = await getIcon(e.icon);
          if (!blob) continue;
          iconUrls = { ...iconUrls, [e.icon]: URL.createObjectURL(blob) };
        } catch {
          /* 读取失败则回退首字母，不打断渲染 */
        }
      }
    })();
  });

  function isDefault(e: SearchEngine): boolean {
    return e.id === defaultEngineId;
  }

  /** 设为默认引擎（右键菜单与设置面板共用同一条路径） */
  async function setAsDefault(engine: SearchEngine) {
    if (isDefault(engine)) {
      uiStore.getState().toast(`${engine.name} 已经是默认引擎`, 'info', 1600);
      return;
    }
    await enginesStore.getState().setDefault(engine.id);
    uiStore.getState().toast(`默认搜索引擎已切换为 ${engine.name}`, 'success', 1600);
  }

  /**
   * 左键点击引擎：
   *   · 输入框为空  → 把它设为默认引擎（不需要先打个字再去找菜单）
   *   · 输入框有内容 → 直接用这个引擎搜索，当前页跳转
   * 右键菜单里的「用 X 搜索」则永远走搜索分支，不受这条规则影响。
   */
  function activate(engine: SearchEngine) {
    if (!query.trim()) {
      void setAsDefault(engine);
      return;
    }
    runSearch(query, engine);
  }

  // ── 右键菜单：设为默认引擎 ──
  let menu = $state<{ x: number; y: number; engine: SearchEngine } | null>(null);

  function openMenu(event: MouseEvent, engine: SearchEngine) {
    event.preventDefault();
    event.stopPropagation();
    menu = { x: event.clientX, y: event.clientY, engine };
  }

  /** 内置图标名 → 首字母回退 */
  function monogram(engine: SearchEngine): string {
    return (engine.name.trim()[0] ?? '?').toUpperCase();
  }

  /**
   * 兜底层：与该引擎 id 同名的内置品牌图形 → 名称首字母。
   *
   * 只在「远程地址加载失败」时才尝试同名内置图形 —— 否则用户给某个内置引擎
   * 上传了自定义图标，会被同名内置图形抢走（绑定关系是 id，不是 icon）。
   * 例如 DeepSeek 远程 Logo 取不到时，这里会顶上内置的鲸鱼图形。
   */
  function fallbackView(engine: SearchEngine): IconView {
    if (isRemoteIcon(engine.icon) && getSvgIcon(engine.id)) {
      return { kind: 'svg', name: engine.id };
    }
    return { kind: 'memo', text: monogram(engine) };
  }

  /**
   * 解析某个引擎的图标该以什么形式渲染。
   *
   * 顺序：远程图 → 内置 SVG → IndexedDB 自定义图 → 兜底层。
   * 已经失败过的引用直接走兜底层，不会反复重试、也不会留破图。
   */
  function iconView(engine: SearchEngine): IconView {
    const ref = engine.icon;
    if (failedIcons[ref]) return fallbackView(engine);

    if (isRemoteIcon(ref)) return { kind: 'remote', src: ref };
    if (getSvgIcon(ref)) return { kind: 'svg', name: ref };

    const blobUrl = iconUrls[ref];
    if (blobUrl) return { kind: 'remote', src: blobUrl };

    return fallbackView(engine);
  }

  /** 标记某个图标引用加载失败，触发重渲染到兜底层 */
  function markIconFailed(ref: string) {
    if (failedIcons[ref]) return;
    failedIcons = { ...failedIcons, [ref]: true };
  }

  // ── 拖拽排序（需求 3 / 4 / 5）──
  // 与快捷方式共用 lib/sortable：同一个「跟手移动 + 弹性让位」的实现，
  // 两处的拖拽手感因此完全一致。
  const engineSortable = (node: HTMLElement, engine: SearchEngine) =>
    sortable(node, {
      root: () => rootEl,
      // 引擎图标比快捷方式小，阈值给大一点，避免「想点击却触发排序」
      threshold: 6,
      scale: 1.1,
      onDraggingChange: (v) => (sorting = v),
      onDrop: (fromIndex, toIndex) => {
        const ids = reorderIds(
          sorted.map((e) => e.id),
          fromIndex,
          toIndex,
        );
        void enginesStore.getState().reorder(ids);
      },
    });

</script>

<div class="engines-wrap">
  <div
    bind:this={rootEl}
    class="engines"
    class:engines--sorting={sorting}
    role="toolbar"
    aria-label="搜索引擎切换（按住可拖动排序）"
    data-sortable-root
  >
    {#each sorted as engine (engine.id)}
      {@const view = iconView(engine)}
      <button
        class="engine"
        class:engine--default={isDefault(engine)}
        type="button"
        data-sortable-item
        use:engineSortable={engine}
        title={isDefault(engine)
          ? `${engine.name}（默认搜索引擎）· 按住可拖动排序`
          : query.trim()
            ? `用 ${engine.name} 搜索`
            : `点击设为默认引擎：${engine.name}`}
        aria-label={isDefault(engine)
          ? `${engine.name}，当前默认引擎`
          : query.trim()
            ? `用 ${engine.name} 搜索`
            : `设为默认引擎：${engine.name}`}
        aria-pressed={isDefault(engine)}
        onclick={() => activate(engine)}
        oncontextmenu={(e) => openMenu(e, engine)}
      >
        <!-- 默认引擎的「圆角矩形填充」提示底 -->
        <span class="engine__plate" aria-hidden="true"></span>

        <span class="engine__icon">
          {#if view.kind === 'remote'}
            <!--
              远程 / 自定义 Logo。favicon.im 的 larger=true 会给到网站原图
              （最高 256px），渲染到 19px 属于超高分辨率下采样，HiDPI 屏上是锐的。
              onerror 写入 failedIcons → 立刻换兜底层，不留破图。
            -->
            <img
              src={view.src}
              alt=""
              width="19"
              height="19"
              loading="eager"
              decoding="async"
              referrerpolicy="no-referrer"
              onerror={() => markIconFailed(engine.icon)}
            />
          {:else if view.kind === 'svg'}
            <SvgIcon name={view.name} size={19} />
          {:else}
            <span class="engine__monogram">{view.text}</span>
          {/if}
        </span>

        <span class="engine__name">{engine.name}</span>

        {#if isDefault(engine)}
          <span class="engine__check" aria-hidden="true">
            <SvgIcon name="check" size={10} />
          </span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<!-- 右键菜单：设为默认引擎 -->
{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={[
      {
        id: 'set-default',
        label: isDefault(menu.engine)
          ? `${menu.engine.name}（已是默认）`
          : `设为默认引擎：${menu.engine.name}`,
        icon: 'check',
        disabled: isDefault(menu.engine),
      },
      { type: 'separator' },
      { id: 'search-now', label: `用 ${menu.engine.name} 搜索`, icon: 'search' },
    ]}
    onselect={(id) => {
      const target = menu?.engine;
      menu = null;
      if (!target) return;
      if (id === 'set-default') void setAsDefault(target);
      // 菜单里的「用 X 搜索」是显式搜索意图：即使输入为空也照搜不误
      // （空词搜索会打开该引擎首页），不再受「空输入点击=设默认」的规则约束。
      if (id === 'search-now') runSearch(query, target);
    }}
    onclose={() => (menu = null)}
  />
{/if}

<style>
  /* 包裹层：给右侧提示提供定位上下文。
     本身不参与排布，引擎行仍然是唯一的布局子元素。 */
  .engines-wrap {
    position: relative;
    width: 100%;
  }

  /* 引擎栏是搜索卡片的下半部分，不再自己画底板或内嵌浅槽 ——
     卡片外层已经把材质与内部分隔线都处理了，这里只负责排布。
     居中：与上方输入文字共用同一条中轴（需求：输入文字与引擎栏都居中）。 */
  .engines {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    max-width: 100%;
  }

  .engine {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 13px 0 10px;
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    /* 拖拽排序：抓取光标；touch-action: none 是让触摸拖拽不被页面滚动抢走 */
    cursor: grab;
    touch-action: none;
    transition:
      color var(--dur-fast) var(--ease-soft),
      transform var(--dur-fast) var(--ease-out);
  }

  /* 排序进行中：整行标记为抓取态 */
  .engines--sorting,
  .engines--sorting .engine {
    cursor: grabbing;
  }

  /* 被拖拽的那一个：抬起（缩放由 sortable 的 transform 负责，这里只补光影）
     .is-dragging 是运行时由 action 加上的，静态分析看不到，所以要 :global。 */
  .engine:global(.is-dragging) {
    background: var(--glass-bg);
    border-radius: var(--radius-md);
    box-shadow:
      0 10px 24px -8px var(--shadow),
      inset 0 1px 0 var(--glass-frost);
    opacity: 0.96;
    cursor: grabbing;
  }

  /* 拖拽中不要触发 hover 位移，否则会和跟手位移打架 */
  .engines--sorting .engine:hover {
    transform: none;
  }

  .engine:hover {
    color: var(--text);
    transform: translateY(-1px);
  }

  .engine:active {
    transform: translateY(0);
  }

  .engine:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* 默认引擎的填充底 —— 用圆角矩形明确区分 */
  .engine__plate {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-md);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    box-shadow:
      0 1px 2px color-mix(in srgb, var(--shadow) 60%, transparent),
      inset 0 1px 0 var(--glass-frost);
    opacity: 0;
    transform: scale(0.94);
    transition:
      opacity var(--dur-base) var(--ease-soft),
      transform var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-soft);
    pointer-events: none;
  }

  .engine:hover .engine__plate {
    opacity: 0.72;
    transform: scale(1);
  }

  /* 默认引擎：填充常驻 + 强调色描边 */
  .engine--default .engine__plate {
    opacity: 1;
    transform: scale(1);
    border-color: color-mix(in srgb, var(--accent) 46%, transparent);
    background: color-mix(in srgb, var(--accent) 14%, var(--glass-bg));
    box-shadow:
      0 1px 2px color-mix(in srgb, var(--shadow) 50%, transparent),
      inset 0 1px 0 var(--glass-frost),
      0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .engine--default {
    color: var(--text);
  }

  .engine__icon {
    position: relative;
    display: grid;
    place-items: center;
    width: 19px;
    height: 19px;
    flex: none;
  }

  .engine__icon img {
    border-radius: 3px;
    object-fit: contain;
  }

  .engine__monogram {
    display: grid;
    place-items: center;
    width: 19px;
    height: 19px;
    border-radius: 5px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: #fff;
    background: color-mix(in srgb, var(--accent) 78%, transparent);
  }

  .engine--default .engine__icon {
    color: var(--accent);
  }

  .engine__name {
    position: relative;
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
  }

  .engine__check {
    position: relative;
    display: grid;
    place-items: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    color: #fff;
    background: var(--accent);
    flex: none;
  }

  @media (max-width: 560px) {
    .engine__name {
      display: none;
    }

    .engine {
      padding: 0 10px;
      height: 32px;
    }

    .engines {
      padding: 5px;
    }
  }
</style>
