<!--
  Toast 宿主 —— 右下角上方堆叠的轻量提示
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';
  import { uiStore } from '../stores/ui';

  let toasts = $state(uiStore.getState().toasts);

  $effect(() => {
    const off = uiStore.subscribe((s) => {
      toasts = s.toasts;
    });
    return off;
  });

  const ICONS = {
    info: 'info',
    success: 'check',
    error: 'warning',
  } as const;
</script>

<div class="toast-host" role="status" aria-live="polite" aria-atomic="false">
  {#each toasts as toast (toast.id)}
    <div class="toast glass toast--{toast.kind}">
      <span class="toast__ic" aria-hidden="true">
        <SvgIcon name={ICONS[toast.kind]} size={14} />
      </span>
      <span class="toast__msg">{toast.message}</span>
      <button
        class="toast__close"
        type="button"
        aria-label="关闭提示"
        onclick={() => uiStore.getState().dismissToast(toast.id)}
      >
        <SvgIcon name="close" size={12} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    /* 右下角，但要避开设置齿轮按钮 */
    right: 18px;
    bottom: 76px;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
    max-width: min(380px, calc(100vw - 36px));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 10px 10px 10px 12px;
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 28px -8px var(--shadow);
    font-size: 13px;
    pointer-events: auto;
    animation: toast-in var(--dur-base) var(--ease-out);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .toast__ic {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: 50%;
    margin-top: 1px;
  }

  .toast--info .toast__ic {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .toast--success .toast__ic {
    color: #30a46c;
    background: color-mix(in srgb, #30a46c 18%, transparent);
  }

  .toast--error .toast__ic {
    color: #e5484d;
    background: color-mix(in srgb, #e5484d 18%, transparent);
  }

  .toast__msg {
    flex: 1;
    min-width: 0;
    line-height: 1.55;
    word-break: break-word;
  }

  .toast__close {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: 50%;
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .toast__close:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }
</style>
