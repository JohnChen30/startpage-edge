<!--
  设置齿轮按钮 —— 固定在右下角

  硬性要求：不可拖拽、不可移除、z-index 足够高。
  半透明毛玻璃质感，hover 时轻微放大以提示可点击。
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';
  import { uiStore } from '../stores/ui';
</script>

<button
  class="gear glass"
  type="button"
  aria-label="打开设置"
  title="设置"
  onclick={() => uiStore.getState().openSettings()}
>
  <SvgIcon name="settings" size={19} class="gear__icon" />
</button>

<style>
  .gear {
    position: fixed;
    right: 18px;
    bottom: 18px;
    /* 高于内容与编辑控件，低于弹窗与抽屉 */
    z-index: 70;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    color: var(--text-secondary);
    opacity: 0.72;
    box-shadow:
      0 4px 14px -4px var(--shadow),
      inset 0 1px 0 var(--line-highlight);
    /* 明确不可拖拽 */
    cursor: pointer;
    touch-action: manipulation;
    transition:
      opacity var(--dur-base) var(--ease-soft),
      color var(--dur-base) var(--ease-soft),
      transform var(--dur-base) var(--ease-out);
  }

  .gear:hover {
    opacity: 1;
    color: var(--text);
    transform: scale(1.06);
  }

  .gear:active {
    transform: scale(0.97) rotate(-12deg);
  }

  .gear :global(.gear__icon) {
    transition: transform var(--dur-slow) var(--ease-out);
  }

  .gear:hover :global(.gear__icon) {
    transform: rotate(52deg);
  }
</style>
