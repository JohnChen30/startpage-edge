<!--
  壁纸层

  三种来源：
   · solid —— 纯色底（CSS 变量 --bg）
   · image —— 用户导入的本地图片（IndexedDB blob）
   · bing  —— 必应每日壁纸（远程 URL，见 lib/bing.ts）

  关键性能约束：新标签页必须秒开，不能等壁纸解码完才显示。
  做法：图片一解码完成就淡入，整个过程不阻塞主渲染。

  换壁纸时**不许黑屏**（本轮的重点）：
  以前只有一层 img，store 里的 URL 一变 src 就跟着变，浏览器立刻清掉旧图，
  而新图还没下载完 —— 中间那一瞬整层透出下面的纯色底（深色主题就是一片黑）。
  现在是**两层 img 交叉淡入**：底层一直显示着已经解码好的旧壁纸，
  顶层载新图、解码完成后用 0.5s 淡入覆盖上去，底图再悄悄换成同一张。
  新图没加载出来之前，看到的始终是旧壁纸。

  统一用 <img> 承载图片而不是 background-image：
   · <img> 的 onload 就是最准的「解码完成」信号，淡入时机可控；
   · <img> 不受 CORS 限制 —— 这是必应图能稳定显示的前提（接口本身没有 CORS 头）。
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { settingsStore } from '../stores/settings';
  import { uiStore } from '../stores/ui';
  import { wallpaperObjectUrl } from '../lib/indexeddb';
  import { RUNTIME_VARS } from '../lib/theme';

  /**
   * 新旧壁纸交叉淡入的时长（ms）。
   *
   * 全站只有这一个真值：顶层的 transition-duration 由它内联写下去，
   * 「淡入跑完再把底层换掉」的延时也由它算 ——
   * 不会出现「CSS 写 0.5s、JS 只等 0.3s」这种错位导致的闪一下。
   */
  const FADE_MS = 500;

  let settings = $state(settingsStore.getState().settings);
  let objectUrl = $state<string | null>(null);

  /**
   * 两层 <img> 交叉淡入 —— 「换壁纸时中间黑一下」的解法。
   *
   * 以前只有一层 img：store 里的 URL 一变，src 立刻跟着变，
   * 浏览器会马上把旧图清掉，而新图此时还没下载完 →
   * 整层透出下面那块纯色底（深色主题下就是一片黑），
   * 等新图解码完再「啪」地整块出现。用户看到的就是「黑一下」。
   *
   * 现在分两层：
   *   · shownUrl —— 底层，**已经解码完成**的那一张，全程 opacity 1、不参与动画；
   *   · fadeUrl  —— 顶层，新图。初始 opacity 0，只有 onload 之后才开始淡入。
   * 于是「新图还没加载出来」的整段时间里，用户看到的始终是旧壁纸；
   * 新图一解码完就叠在上面用 0.5s 淡入 —— 观感是平滑过渡，不是闪一下。
   *
   * 淡入跑完才把底层 src 换成新图（commitFade）：那一刻顶层已经完全不透明地
   * 盖在上面，底层换 src 谁也看不见。等底层自己的 onload 到了再把顶层撤掉 ——
   * 两层这时是同一张图，撤掉哪一层都看不出来。
   */
  let shownUrl = $state<string | null>(null);
  let fadeUrl = $state<string | null>(null);
  /** 顶层是否已解码完成 —— 为 true 才开始那 0.5s 淡入 */
  let fadeShown = $state(false);

  let commitTimer: number | undefined;
  let sweepTimer: number | undefined;

  function clearTimers() {
    if (commitTimer !== undefined) window.clearTimeout(commitTimer);
    if (sweepTimer !== undefined) window.clearTimeout(sweepTimer);
    commitTimer = undefined;
    sweepTimer = undefined;
  }

  /** 顶层解码完成 → 开始淡入；淡入跑完再把底层换掉 */
  function onFadeLoad() {
    fadeShown = true;
    uiStore.getState().setWallpaperLoading(false);
    clearTimers();
    commitTimer = window.setTimeout(commitFade, FADE_MS + 60);
  }

  /**
   * 顶层加载失败 —— 放弃这次切换，**原封不动继续显示旧壁纸**。
   * 这正是「没加载出来就先保持原壁纸」要求的落点：
   * 网络断了 / URL 失效时不能把用户的壁纸换成一片纯色。
   */
  function onFadeError() {
    clearTimers();
    fadeUrl = null;
    fadeShown = false;
    uiStore.getState().setWallpaperLoading(false);
  }

  /** 把底层换成新图（此刻顶层正盖着，这一下不可见） */
  function commitFade() {
    commitTimer = undefined;
    if (!fadeUrl) return;
    shownUrl = fadeUrl;
    // 兜底：底层若始终不触发 load，也要把顶层收掉，别让状态卡住
    sweepTimer = window.setTimeout(() => {
      sweepTimer = undefined;
      fadeUrl = null;
      fadeShown = false;
    }, 1500);
  }

  /** 底层解码完成 → 顶层功成身退 */
  function onShownLoad() {
    if (fadeUrl && fadeUrl === shownUrl) {
      clearTimers();
      fadeUrl = null;
      fadeShown = false;
    }
  }

  $effect(() => {
    const off = settingsStore.subscribe((s) => {
      settings = s.settings;
    });
    return off;
  });

  const wallpaper = $derived(settings.wallpaper);

  /**
   * 当前真正要渲染的图片地址。
   * 必应走远程 URL，本地图片走 IndexedDB 取出的 blob URL。
   */
  const imageUrl = $derived(
    wallpaper.type === 'bing'
      ? (wallpaper.bingUrl ?? null)
      : wallpaper.type === 'image'
        ? objectUrl
        : null,
  );

  // 本地图片：取 blob URL；旧的必须 revoke，否则内存泄漏
  //
  // 关键：**只有新 blob 真的拿到之后才写 objectUrl**。
  // 以前这里一进来就先 `objectUrl = null`，于是换照片的瞬间壁纸会先消失一下、
  // 露出纯色底 —— 和「换必应壁纸黑一下」是同一个毛病。
  // 保持旧值不动，旧照片就能一直撑到新照片解码完成、淡入结束。
  $effect(() => {
    const wp = wallpaper;
    if (wp.type !== 'image' || !wp.imageRef) {
      objectUrl = null;
      return;
    }

    let disposed = false;
    let created: string | null = null;

    void (async () => {
      try {
        const url = await wallpaperObjectUrl(wp.imageRef!);
        if (disposed) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        created = url;
        objectUrl = url;
      } catch (err) {
        // 壁纸丢失（IndexedDB 被清空）时不报错，静默回退纯色
        console.warn('[wallpaper] 图片读取失败，回退纯色', err);
      }
    })();

    return () => {
      disposed = true;
      // 延迟释放：上一张此刻可能还在底层显示着（换照片时旧图要撑到新图淡入完），
      // 立刻 revoke 有把它一起弄没的风险。晚几秒释放对内存没有实际影响。
      if (created) {
        const stale = created;
        setTimeout(() => URL.revokeObjectURL(stale), 3000);
      }
    };
  });

  // ── 壁纸切换：新图解码完成前，一律保持旧壁纸 ──
  $effect(() => {
    const url = imageUrl;

    // untrack：本 effect 只应该由「目标 URL 变了」触发。
    // 若让 shownUrl / fadeUrl 也进依赖，下面写它们会让 effect 自激重跑。
    const shown = untrack(() => shownUrl);
    const fading = untrack(() => fadeUrl);

    if (!url) {
      // 没有正在加载的图了 → 转圈必须停，否则按钮会一直转下去
      uiStore.getState().setWallpaperLoading(false);

      // 但只有「确实不该有图」时才撤掉两层：
      //   · 纯色底 → 撤，露出纯色；
      //   · 本地图的 blob 还在读 → **不撤**，旧壁纸继续撑着，不闪纯色底。
      const empty =
        wallpaper.type === 'solid' ||
        (wallpaper.type === 'image' && !wallpaper.imageRef);
      if (!empty) return;

      clearTimers();
      shownUrl = null;
      fadeUrl = null;
      fadeShown = false;
      return;
    }

    // 已经在显示 / 已经在加载这张 → 什么都不做
    if (url === shown || url === fading) return;

    clearTimers();
    fadeUrl = url;
    fadeShown = false;
    uiStore.getState().setWallpaperLoading(true);
  });

  // 必应类型的首次落地：列表里挑出当前这张并写回设置
  // 用普通变量做一次性闸门（不是 $state，因此不会造成 effect 自激）
  let bingResolved = false;
  $effect(() => {
    const wp = wallpaper;
    if (wp.type !== 'bing') {
      bingResolved = false;
      return;
    }
    if (bingResolved) return;
    bingResolved = true;
    void settingsStore.getState().ensureBingWallpaper();
  });

  // 同步 CSS 变量
  $effect(() => {
    const root = document.documentElement;
    root.style.setProperty(RUNTIME_VARS.wallpaperBlur, `${wallpaper.blur}px`);
    root.style.setProperty(
      RUNTIME_VARS.wallpaperBrightness,
      `${wallpaper.brightness}%`,
    );
    root.style.setProperty(
      RUNTIME_VARS.wallpaperMask,
      String(wallpaper.maskOpacity / 100),
    );
    if (wallpaper.type === 'solid' && wallpaper.color) {
      root.style.setProperty('--bg', wallpaper.color);
    }
  });
</script>

<!-- 纯色底：始终存在，作为图片加载前的兜底 -->
<div
  class="wallpaper-base"
  style:background-color={wallpaper.type === 'solid' ? wallpaper.color : undefined}
  aria-hidden="true"
></div>

{#if shownUrl || fadeUrl}
  <div class="wallpaper" aria-hidden="true">
    <!--
      两层 <img> 而不是 background-image：
      onload 就是「解码完成」的准确信号，淡入时机完全可控；
      <img> 不受 CORS 限制 —— 这是必应图能稳定显示的前提（接口本身没有 CORS 头）。

      DOM 顺序即层序：底层（.wallpaper__img，已显示的旧壁纸）在前，
      顶层（--fade，新壁纸）在后。顶层 opacity 到 1 之前完全不参与显示，
      所以「下载 + 解码」这整段时间里屏幕上始终是旧壁纸，不会黑一下。
    -->
    {#if shownUrl}
      <img
        class="wallpaper__img"
        src={shownUrl}
        alt=""
        decoding="async"
        draggable="false"
        onload={onShownLoad}
      />
    {/if}

    {#if fadeUrl}
      <img
        class="wallpaper__img wallpaper__img--fade"
        class:wallpaper__img--shown={fadeShown}
        src={fadeUrl}
        alt=""
        decoding="async"
        fetchpriority="high"
        draggable="false"
        style:transition-duration="{FADE_MS}ms"
        onload={onFadeLoad}
        onerror={onFadeError}
      />
    {/if}
  </div>
{/if}

<div class="wallpaper-mask" aria-hidden="true"></div>

<style>
  .wallpaper-base {
    position: fixed;
    inset: 0;
    z-index: var(--z-wallpaper);
    background-color: var(--bg);
    pointer-events: none;
  }

  /* 两层图片叠在同一个盒子里；外层 .wallpaper 负责模糊 / 亮度 / 缩放推进视口 */
  .wallpaper__img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
  }

  /* 新壁纸：解码完成前一直是 0 ——
     宁可什么都不显示（露出下面的旧壁纸），也绝不提前露出「半张图」或把背景透出来。
     transition-duration 由脚本内联写入（FADE_MS），JS 与 CSS 永远同一个值。 */
  .wallpaper__img--fade {
    opacity: 0;
    transition-property: opacity;
    transition-timing-function: var(--ease-soft);
  }

  /* 必须在 --fade 之后：两者特异性相同，靠源码顺序取胜 */
  .wallpaper__img--shown {
    opacity: 1;
  }
</style>
