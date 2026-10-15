<!--
  SvgIcon —— 内联 SVG 图标组件

  不热链第三方：所有图标来自 lib/icons.ts 的内联路径。
  一律使用 currentColor，跟随父元素颜色。
-->
<script lang="ts">
  import { getSvgIcon } from '../lib/icons';

  interface Props {
    name: string;
    size?: number;
    /** 线条宽度覆盖，默认交给图标自身 */
    stroke?: number;
    class?: string;
  }

  let { name, size = 18, class: className = '' }: Props = $props();

  const icon = $derived(getSvgIcon(name));
</script>

{#if icon}
  <svg
    class="icon {className}"
    width={size}
    height={size}
    viewBox={icon.box}
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <!--
      安全性：icon.body 来自 lib/icons.ts 的编译期常量表，
      不含任何用户输入，因此不存在 XSS 面。若将来要支持
      「用户自定义 SVG」，必须先做白名单净化再渲染。
    -->
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html icon.body}
  </svg>
{:else}
  <!-- 图标名拼错时给一个可见但不刺眼的占位，避免布局塌陷 -->
  <svg
    class="icon {className}"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="4"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-dasharray="3 3"
      fill="none"
    />
  </svg>
{/if}

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
