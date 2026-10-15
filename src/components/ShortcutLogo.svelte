<!--
  快捷方式图标

  图标链路（由 lib/favicon.ts 的 faviconCandidates 给出，按清晰度降序）：
     自定义图标(IndexedDB) → chrome://favicon@128 → chrome://favicon@64
       → 站点 /favicon.ico → 首字母高清占位

  清晰度策略（这是本组件存在的意义）：
   · 能拿到 32×32 以上的图标 → 原样等比显示，外面套一层圆角玻璃底座
   · 只能拿到 16×16 的小图标 → 用 image-rendering 做「像素清晰化」而不是
     让浏览器做双线性模糊拉伸；同时套上圆角底座，让放大后的观感
     像「有意设计的块状图标」而不是「糊掉的小图」
   · 完全拿不到 / 全部失败 → 渲染一颗由 URL 派生色相的高清首字母方块，
     它是矢量级的，任何尺寸都清晰

  不做热链、不加网络请求，严格遵守「不申请 host_permissions」的边界。
-->
<script lang="ts">
  import { getIcon } from '../lib/indexeddb';
  import { faviconCandidates, monogramHue, monogramOf } from '../lib/favicon';
  import type { Shortcut } from '../types';

  interface Props {
    shortcut: Shortcut;
    size: number;
  }

  let { shortcut, size }: Props = $props();

  /** 候选地址队列，逐个尝试直到加载成功 */
  let candidates = $state<string[]>([]);
  let cursor = $state(0);
  /** 已加载图标自身的原始像素宽度，用于决定要不要「像素化放大」 */
  let naturalSize = $state(0);

  const src = $derived(candidates[cursor] ?? '');
  const failed = $derived(cursor >= candidates.length);

  const letter = $derived(monogramOf(shortcut.name || shortcut.url));
  const hue = $derived(monogramHue(shortcut.url));

  /**
   * 小图标（≤ 24px）在放大到 56px+ 时会被浏览器插值成一片糊。
   * 对这类图标改用 pixelated 渲染：浏览器不做平滑，边缘保持锐利，
   * 观感从「模糊」变成「清晰的像素风」，反而更体面。
   */
  const upscaling = $derived(naturalSize > 0 && naturalSize <= 24);

  // 构建候选链
  $effect(() => {
    void shortcut.id;
    void shortcut.url;
    void shortcut.icon;

    let disposed = false;
    const created: string[] = [];

    void (async () => {
      const chain: string[] = [];

      // 1. 用户自定义图标（用户自己上传的，通常足够清晰，排最前）
      if (shortcut.icon && shortcut.icon !== 'auto') {
        try {
          const blob = await getIcon(shortcut.icon);
          if (blob) {
            const url = URL.createObjectURL(blob);
            created.push(url);
            chain.push(url);
          }
        } catch {
          /* 忽略，继续走自动链路 */
        }
      }

      // 2. 自动链路：128 → 64 → /favicon.ico
      chain.push(...faviconCandidates(shortcut.url));

      if (disposed) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      candidates = chain;
      cursor = 0;
      naturalSize = 0;
    })();

    return () => {
      disposed = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  });

  function onLoad(event: Event) {
    const img = event.currentTarget as HTMLImageElement;
    naturalSize = img.naturalWidth || 0;
  }

  function onError() {
    // 逐个降级，直到全部失败后显示首字母方块
    naturalSize = 0;
    cursor += 1;
  }
</script>

<span class="logo" style:--logo-size="{size}px" aria-hidden="true">
  <!-- 底座：玻璃拟态圆角方块，让任何来源的图标都被「装裱」得整齐。
       材质本身（渐变 / 描边 / 高光 / 投影 / blur）来自全局 .glass-tile ——
       那一个类就是「快捷方式小方块」的唯一配方，
       搜索卡片用的也是它，所以两处材质逐像素相同，且由同一根模糊滑块驱动。 -->
  <span class="logo__base glass-tile" class:logo__base--filled={failed}></span>

  {#if src && !failed}
    <img
      class="logo__img"
      class:logo__img--upscaled={upscaling}
      {src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
      onload={onLoad}
      onerror={onError}
    />
  {:else}
    <!-- 首字母兜底：矢量渲染，任何尺寸都清晰；色相由 URL 派生且稳定 -->
    <span class="logo__letter" style:--letter-bg={`hsl(${hue} 58% 46%)`}>{letter}</span>
  {/if}
</span>

<style>
  .logo {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--logo-size);
    height: var(--logo-size);
    flex: none;
  }

  /* 圆角玻璃底座 —— 图标「装了框」，放大的小图也不会显得突兀。
     圆角不再是写死的 0.24 比例，而是走全局 --shortcut-radius：
     它内部同样是 calc(基准 * var(--radius-scale))，
     因此设置里的「圆角大小」滑块一拖，快捷方式图标也跟着变。

     **材质不在这里写**（这是本轮的关键改动）：
     渐变 / 描边 / 顶部高光 / 外投影 / backdrop-filter 全部搬到全局 .glass-tile，
     搜索卡片用的就是同一个类 —— 两处材质只留一份定义，不可能再走样。
     （此前这里是全站第 3 处玻璃声明，与 .glass、.glass-milk 各写一份，
       改一处忘一处，「搜索框和快捷方式不是同一种材质」就是这么来的。）
     这里只留「摆在哪、多大、圆角多少」这些纯几何属性。 */
  .logo__base {
    position: absolute;
    inset: 4%;
    border-radius: var(--shortcut-radius);
    transition:
      border-radius var(--dur-base) var(--ease-soft),
      border-color var(--dur-base) var(--ease-soft),
      box-shadow var(--dur-base) var(--ease-soft);
  }

  /* 首字母兜底时底座不显示（字母自己就是完整色块） */
  .logo__base--filled {
    opacity: 0;
  }

  .logo__img {
    position: relative;
    width: 68%;
    height: 68%;
    object-fit: contain;
    /* 高清图标：交给浏览器平滑缩放 */
    image-rendering: auto;
    user-select: none;
    -webkit-user-drag: none;
  }

  /* 小图标放大：禁用平滑，边缘保持锐利，避免一片糊 */
  .logo__img--upscaled {
    image-rendering: pixelated;
    -webkit-image-rendering: pixelated;
    /* 略微放大占比，补偿像素化后视觉上的「变小」 */
    width: 74%;
    height: 74%;
  }

  .logo__letter {
    position: relative;
    display: grid;
    place-items: center;
    width: 68%;
    height: 68%;
    border-radius: var(--shortcut-radius);
    font-size: calc(var(--logo-size) * 0.29);
    font-weight: 650;
    letter-spacing: 0.01em;
    color: #fff;
    background: linear-gradient(
      155deg,
      color-mix(in srgb, var(--letter-bg) 88%, #fff) 0%,
      var(--letter-bg) 100%
    );
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.34),
      0 2px 8px -3px var(--shadow);
    user-select: none;
  }
</style>
