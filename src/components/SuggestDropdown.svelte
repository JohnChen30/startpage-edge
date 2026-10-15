<!--
  搜索推荐下拉

  规格：
   · 只推荐收藏夹命中项（由 lib/suggest.ts 的 bookmarkOnly 决定）
   · 无命中项时根本不渲染 —— 由 SearchBar 的 {#if dropdownOpen} 保证，
     所以绝不会出现一个空下拉挡住下方引擎栏
   · 匹配优先级由 lib/suggest.ts 决定，这里只负责渲染
   · 键盘 ↑↓ / Enter / Esc 由 SearchBar 统一处理，这里只做高亮与点击
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';
  import { splitHighlight } from '../lib/suggest';
  import type { SuggestItem } from '../types';

  interface Props {
    id?: string;
    items: SuggestItem[];
    activeIndex: number;
    onchoose: (item: SuggestItem) => void;
    onhover: (index: number) => void;
  }

  let { id, items, activeIndex, onchoose, onhover }: Props = $props();

  let listEl: HTMLUListElement | undefined;

  // 键盘移动时把选中项滚进视野
  $effect(() => {
    const idx = activeIndex;
    if (idx < 0 || !listEl) return;
    const el = listEl.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  });
</script>

<ul {id} bind:this={listEl} class="suggest glass" role="listbox" aria-label="收藏夹推荐">
  {#each items as item, i (item.id)}
    <li
      class="suggest__item"
      class:suggest__item--active={i === activeIndex}
      role="option"
      aria-selected={i === activeIndex}
      tabindex="-1"
      onmouseenter={() => onhover(i)}
      onmousedown={(e) => {
        // 用 mousedown 抢在 input blur 之前触发，避免点击丢失
        e.preventDefault();
        onchoose(item);
      }}
    >
      <span class="suggest__icon" aria-hidden="true">
        <SvgIcon name="bookmark-plus" size={14} />
      </span>

      <span class="suggest__body">
        <span class="suggest__title">
          {#if item.matchRange}
            {@const [before, hit, after] = splitHighlight(item.title, item.matchRange)}
            <span>{before}</span><mark class="suggest__hit">{hit}</mark><span
              >{after}</span
            >
          {:else}
            {item.title}
          {/if}
        </span>
        {#if item.subtitle}
          <span class="suggest__subtitle">{item.subtitle}</span>
        {/if}
      </span>

      <span class="suggest__action" aria-hidden="true">
        <SvgIcon name="external-link" size={13} />
      </span>
    </li>
  {/each}
</ul>

<style>
  .suggest {
    position: absolute;
    /* 挂在输入区下方。锚点是 .search（flex column），它随卡片一起向上生长，
       所以这里用 top: calc(100% + 6px) 依然始终贴着输入区的下边缘。 */
    top: calc(100% + 6px);
    left: 0;
    z-index: 40;
    width: 100%;
    min-width: 280px;
    padding: 6px;
    border-radius: var(--radius-lg);
    /* 下拉悬在大玻璃块之上，所以自己必须够「实」，不能被下面的内容透出来。
       材质同样走全局统一参数（比底板更实一档的 --glass-surface + glass-blur）。 */
    background: var(--glass-surface);
    border: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
    box-shadow:
      0 18px 44px -12px var(--shadow),
      0 4px 12px -4px var(--shadow),
      inset 0 1px 0 var(--glass-frost);
    animation: suggest-in var(--dur-base) var(--ease-out);
    max-height: 340px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  @keyframes suggest-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .suggest__item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-soft),
      transform var(--dur-fast) var(--ease-out);
    user-select: none;
  }

  .suggest__item--active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .suggest__icon {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .suggest__item--active .suggest__icon {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .suggest__body {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .suggest__title {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
  }

  .suggest__hit {
    background: transparent;
    color: var(--accent);
    font-weight: 600;
  }

  .suggest__subtitle {
    font-size: 11.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
    opacity: 0.85;
  }

  .suggest__action {
    display: grid;
    place-items: center;
    flex: none;
    width: 20px;
    height: 20px;
    color: var(--text-secondary);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-soft);
  }

  .suggest__item--active .suggest__action {
    opacity: 0.9;
  }
</style>
