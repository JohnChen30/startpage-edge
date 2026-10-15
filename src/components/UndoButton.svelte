<!--
  撤回按钮 —— 只在收藏夹弹窗底部工具条里出现

  「撤回」针对的是快捷方式数据（添加 / 删除 / 导入 / 清空），
  而这些操作几乎都从收藏夹弹窗发起，所以撤回入口也放在这里，
  而不是漂在主界面右下角 —— 否则用户在主界面看到它能回退什么会很困惑。

  行为：
   · 只有存在可撤回的操作时才出现（无历史则完全不占位）
   · 点击撤回最近一次的添加 / 删除 / 导入 / 清空
   · 悬停显示最近一步操作的名字，让用户知道会撤回什么
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';
  import { shortcutsStore } from '../stores/shortcuts';
  import { uiStore } from '../stores/ui';

  let history = $state(shortcutsStore.getState().history);

  $effect(() => {
    return shortcutsStore.subscribe((s) => (history = s.history));
  });

  /** 最近一步操作的名字，用作 tooltip；无历史时为 null */
  const lastLabel = $derived(history.length ? history[history.length - 1].label : null);

  async function undo() {
    const res = await shortcutsStore.getState().undo();
    if (res.ok) {
      uiStore.getState().toast(`已撤回：${res.value}`, 'success', 2000);
    } else {
      uiStore.getState().toast(res.error, 'info', 1600);
    }
  }
</script>

{#if lastLabel}
  <button
    class="undo"
    type="button"
    aria-label={`撤回上次操作：${lastLabel}`}
    title={`撤回：${lastLabel}`}
    onclick={undo}
  >
    <SvgIcon name="undo" size={14} class="undo__icon" />
    <span>撤回</span>
  </button>
{/if}

<style>
  /* 行内按钮：与收藏夹底部其它 .btn 排在同一行，风格保持克制，
     只有 hover 时才点亮强调色，避免抢走「导入为快捷方式」的注意力。 */
  .undo {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-md);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    border: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--text) 5%, transparent);
    cursor: pointer;
    touch-action: manipulation;
    animation: undo-in var(--dur-base) var(--ease-out);
    transition:
      color var(--dur-fast) var(--ease-soft),
      border-color var(--dur-fast) var(--ease-soft),
      background-color var(--dur-fast) var(--ease-soft);
  }

  @keyframes undo-in {
    from {
      opacity: 0;
      transform: translateX(4px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .undo:hover {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  /* 类名通过组件 prop 透传给 SvgIcon，静态分析看不到，用 :global 明确作用域 */
  .undo :global(.undo__icon) {
    transition: transform var(--dur-slow) var(--ease-out);
  }

  /* 回退的方向感：hover 时逆时针转半圈 */
  .undo:hover :global(.undo__icon) {
    transform: rotate(-180deg);
  }
</style>
