<!--
  右键上下文菜单

  实现要点：
   · 用 fixed 定位跟随鼠标，自动避让视口边界
   · 点击空白、Esc、滚动、窗口失焦都会关闭
   · 键盘 ↑↓ 移动、Enter 确认
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';

  export interface MenuItem {
    id: string;
    label: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
  }

  export type MenuEntry = MenuItem | { type: 'separator' };

  interface Props {
    x: number;
    y: number;
    items: MenuEntry[];
    onselect: (id: string) => void;
    onclose: () => void;
  }

  let { x, y, items, onselect, onclose }: Props = $props();

  let panelEl: HTMLDivElement | undefined;
  // 用 $derived 而非 $state({left:x,...}) —— 直接读取 props 会被当成
  // 「只捕获初始值」，菜单后续重开时位置不会跟随新的 x/y。
  let pos = $derived({ left: x, top: y });
  let activeIndex = $state(-1);

  const actionable = $derived(
    items.filter((it): it is MenuItem => !('type' in it) && !it.disabled),
  );

  // 视口边界避让：先按鼠标位置渲染，量到尺寸后再夹正
  let adjusted = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    if (!panelEl) return;
    const rect = panelEl.getBoundingClientRect();
    const pad = 8;
    const left = Math.min(x, window.innerWidth - rect.width - pad);
    const top = Math.min(y, window.innerHeight - rect.height - pad);
    adjusted = { left: Math.max(pad, left), top: Math.max(pad, top) };
  });

  // 首次渲染用原始坐标（尺寸未知），量到后再用夹正后的坐标
  const style = $derived(
    `left:${adjusted?.left ?? pos.left}px;top:${adjusted?.top ?? pos.top}px;`,
  );

  $effect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      if (panelEl && !panelEl.contains(e.target as Node)) onclose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onclose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % actionable.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + actionable.length) % actionable.length;
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        const item = actionable[activeIndex];
        if (item) {
          onselect(item.id);
          onclose();
        }
      }
    };
    const onScrollOrBlur = () => onclose();

    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onScrollOrBlur);
    window.addEventListener('resize', onScrollOrBlur);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onScrollOrBlur);
      window.removeEventListener('resize', onScrollOrBlur);
    };
  });

  function isActive(id: string): boolean {
    return activeIndex >= 0 && actionable[activeIndex]?.id === id;
  }
</script>

<div
  bind:this={panelEl}
  class="ctx glass"
  role="menu"
  aria-orientation="vertical"
  {style}
>
  {#each items as entry, i (i)}
    {#if 'type' in entry && entry.type === 'separator'}
      <div class="ctx__sep" role="separator"></div>
    {:else}
      {@const item = entry as MenuItem}
      <button
        class="ctx__item"
        class:ctx__item--danger={item.danger}
        class:ctx__item--active={isActive(item.id)}
        type="button"
        role="menuitem"
        disabled={item.disabled}
        onmouseenter={() => {
          const idx = actionable.findIndex((a) => a.id === item.id);
          if (idx >= 0) activeIndex = idx;
        }}
        onclick={() => {
          if (item.disabled) return;
          onselect(item.id);
          onclose();
        }}
      >
        {#if item.icon}
          <span class="ctx__icon" aria-hidden="true">
            <SvgIcon name={item.icon} size={14} />
          </span>
        {/if}
        <span class="ctx__label">{item.label}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .ctx {
    position: fixed;
    z-index: var(--z-dialog);
    min-width: 178px;
    padding: 5px;
    border-radius: var(--radius-lg);
    box-shadow:
      0 14px 38px -10px var(--shadow),
      0 3px 10px -3px var(--shadow);
    animation: ctx-in var(--dur-fast) var(--ease-out);
    transform-origin: top left;
  }

  @keyframes ctx-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .ctx__item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 7px 9px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    text-align: left;
    color: var(--text);
    transition: background-color var(--dur-fast) var(--ease-soft);
  }

  .ctx__item--active {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .ctx__item--danger {
    color: #e5484d;
  }

  .ctx__item--danger.ctx__item--active {
    background: color-mix(in srgb, #e5484d 14%, transparent);
  }

  .ctx__item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ctx__icon {
    display: grid;
    place-items: center;
    width: 15px;
    flex: none;
    color: currentColor;
    opacity: 0.75;
  }

  .ctx__label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ctx__sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--line);
  }
</style>
