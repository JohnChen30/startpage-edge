<!--
  壁纸操作按钮 —— 固定在左下角

  按当前壁纸类型给不同的动作（需求 14 / 15）：
   · 必应每日壁纸 → 「换一张」：随机从最近 8 天里切一张（避开当前这张）
   · 自定义图片   → 「更换照片」：唤起本地图片选择，等价于设置面板里的入口
   · 纯色底       → 不渲染（没有任何有意义的动作可做）

  按钮上**只有图标**（40×40 圆形，与右下角设置齿轮对称），动作含义交给
  title / aria-label；加载期间图标持续转圈，时长对齐 Wallpaper 的
  「新图解码完成」那一刻，所以转多久都是真的在等，不多不少。

  层级与遮挡（需求 19）：
   z-index 用 --z-editor(60)：高于页面内容，低于遮罩(70) / 抽屉(80) / 弹窗(100)。
   于是打开设置或收藏夹时它会被正常盖住，不会浮在弹窗之上抢点击。
   与右下角的设置齿轮分居两侧，互不干扰。
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';
  import { settingsStore } from '../stores/settings';
  import { uiStore } from '../stores/ui';
  import { applyWallpaperFile } from '../lib/wallpaper';
  import { getBingStatus } from '../lib/bing';

  let settings = $state(settingsStore.getState().settings);
  let busy = $state(false);
  /** Wallpaper 写入的「图片正在加载」—— 换图的下载 + 解码才是大头，只靠 busy 不够 */
  let loading = $state(uiStore.getState().wallpaperLoading);
  /** bind:this 会写回该变量，必须声明为 $state 才能触发响应式更新 */
  let fileInput = $state<HTMLInputElement | undefined>(undefined);

  $effect(() => {
    const off = settingsStore.subscribe((s) => {
      settings = s.settings;
    });
    return off;
  });

  $effect(() => {
    const off = uiStore.subscribe((s) => {
      loading = s.wallpaperLoading;
    });
    return off;
  });

  const type = $derived(settings.wallpaper.type);

  /**
   * 转圈条件 = 「正在取列表」或「图片正在下载 / 解码」。
   * 只用 busy 的话，图标会在列表刚拿到、图还没下完时就停转，
   * 那段最长的等待反而没有反馈 —— 用户会以为点了没反应。
   */
  const spinning = $derived(busy || loading);

  async function shuffle() {
    if (busy) return;
    busy = true;
    try {
      const ok = await settingsStore.getState().shuffleBingWallpaper();
      if (!ok) {
        // 走到这里说明连内置快照都没能兜住。把 lib/bing.ts 记下的真实原因
        // 带出来，而不是笼统地说「请检查网络」——否则用户无从判断该改什么。
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
      busy = false;
    }
  }

  function pickPhoto() {
    fileInput?.click();
  }

  async function onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    busy = true;
    try {
      const res = await applyWallpaperFile(file, settings.wallpaper.imageRef);
      if (!res.ok) {
        uiStore.getState().toast(res.error, 'error', 3400);
        return;
      }
      const { id, width, height, bytes } = res.value;
      await settingsStore
        .getState()
        .patchWallpaper({ type: 'image', imageRef: id });
      uiStore
        .getState()
        .toast(
          `壁纸已应用（${width}×${height}，${Math.round(bytes / 1024)}KB）`,
          'success',
          2200,
        );
    } finally {
      busy = false;
    }
  }
</script>

{#if type === 'bing'}
  <button
    class="wallpaper-action glass"
    class:wallpaper-action--spinning={spinning}
    type="button"
    title="随机切换到最近 8 天里的另一张必应壁纸"
    aria-label="换一张必应壁纸"
    aria-busy={spinning}
    disabled={spinning}
    onclick={shuffle}
  >
    <SvgIcon name="refresh" size={18} class="wallpaper-action__icon" />
  </button>
{:else if type === 'image'}
  <button
    class="wallpaper-action glass"
    class:wallpaper-action--spinning={spinning}
    type="button"
    title="重新选择一张本地图片作为壁纸"
    aria-label="更换壁纸照片"
    aria-busy={spinning}
    disabled={spinning}
    onclick={pickPhoto}
  >
    <SvgIcon name="image" size={18} class="wallpaper-action__icon" />
  </button>

  <input
    bind:this={fileInput}
    class="sr-only"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    aria-hidden="true"
    tabindex="-1"
    onchange={onFileChosen}
  />
{/if}

<style>
  .wallpaper-action {
    position: fixed;
    left: 18px;
    bottom: 18px;
    /* 高于内容，低于遮罩(70)/抽屉(80)/弹窗(100)，因此不会被挡住也绝不抢焦点 */
    z-index: var(--z-editor);
    /* 只留图标：40×40 圆形，与右下角的设置齿轮同尺寸同圆角，两侧对称。
       动作含义靠 title / aria-label 说明，不再在按钮上摆文字。 */
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    /* 材质完全沿用全局 .glass，只调透明度让它比设置齿轮更「轻」一点 */
    color: var(--text-secondary);
    opacity: 0.78;
    cursor: pointer;
    touch-action: manipulation;
    box-shadow:
      0 4px 14px -4px var(--shadow),
      inset 0 1px 0 var(--line-highlight);
    transition:
      opacity var(--dur-base) var(--ease-soft),
      color var(--dur-base) var(--ease-soft),
      transform var(--dur-base) var(--ease-out);
  }

  .wallpaper-action:hover:not(:disabled) {
    opacity: 1;
    color: var(--text);
    transform: translateY(-1px);
  }

  .wallpaper-action:active:not(:disabled) {
    transform: translateY(0) scale(0.97);
  }

  .wallpaper-action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .wallpaper-action:disabled {
    cursor: progress;
    opacity: 0.5;
  }

  /* 加载中：默认 disabled 的 0.5 太淡，转圈的箭头几乎看不清，
     所以这里把亮度提回来 —— 提示必须看得见才有意义。 */
  .wallpaper-action:disabled.wallpaper-action--spinning {
    opacity: 0.85;
  }

  /* ── 加载提示：图标持续转圈 ──
     覆盖「取列表 → 下载图片 → 解码」整段时间（Wallpaper 写入
     uiStore.wallpaperLoading，到新图解码完成才置回 false）。
     disabled 期间 :active 那条 rotate(-120deg) 不会命中，两者不打架。 */
  @keyframes wallpaper-action-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .wallpaper-action--spinning :global(.wallpaper-action__icon) {
    animation: wallpaper-action-spin 900ms linear infinite;
  }

  /* 「点了一下」的即时反馈：松手后图标补转一小段 */
  .wallpaper-action:active:not(:disabled) :global(.wallpaper-action__icon) {
    transform: rotate(-120deg);
  }

  .wallpaper-action :global(.wallpaper-action__icon) {
    transition: transform var(--dur-slow) var(--ease-out);
  }
</style>
