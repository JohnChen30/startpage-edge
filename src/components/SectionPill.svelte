<!--
  快捷方式分区胶囊指示器

  挂在屏幕底部正中的玻璃材质胶囊（参考 iOS Home Indicator + 分页圆点）：
  · 每个分区对应一颗圆点，当前分区高亮（拉长 + 强调色）；
  · 点击圆点切换到对应分区；
  · 右键圆点弹出菜单：重命名 / 删除分区（默认分区两项置灰，不可删改名）；
  · 右侧「+」按钮直接新建分区并切换过去（用默认名，不再拦一道起名）；
  · 分区过多时圆点行横向滚动，优先显示前若干颗；
  · 材质与全局毛玻璃统一（.glass-tile），圆角跟随「圆角大小」滑块。
-->
<script lang="ts">
  import SvgIcon from './SvgIcon.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { sectionsStore } from '../stores/sections';
  import { uiStore } from '../stores/ui';
  import { DEFAULT_SECTION_ID } from '../lib/defaults';

  let sections = $state(sectionsStore.getState().sections);
  let ready = $state(sectionsStore.getState().ready);
  let currentSectionId = $state(uiStore.getState().currentSectionId);

  $effect(() => {
    const offs = [
      sectionsStore.subscribe((s) => {
        sections = s.sections;
        ready = s.ready;
      }),
      uiStore.subscribe((s) => {
        currentSectionId = s.currentSectionId;
      }),
    ];
    return () => offs.forEach((o) => o());
  });

  /** 圆点行最多展示多少颗；超出则横向滚动 */
  const MAX_VISIBLE = 10;

  /**
   * 圆点展示顺序：与切换手势的方向保持一致 —— 手指向左滑露出的是「右侧相邻分区」，
   * 因此靠右的圆点对应更靠后的分区。这里把sections 反序渲染，使第 0 个分区落在最右。
   */
  const dotsSections = $derived([...sections].reverse());

  function select(id: string) {
    if (id === currentSectionId) return;
    // 按相对位置决定动画方向：目标在右侧（索引更大）则「下一页」，否则「上一页」
    const order = sections.map((s) => s.id);
    const ci = order.indexOf(currentSectionId);
    const ti = order.indexOf(id);
    const dir = ti > ci ? 'next' : 'prev';
    uiStore.getState().setCurrentSection(id, dir);
  }

  // ── 新建分区 ──
  // 点「+」直接建，不再拦一道起名输入：add() 不传 name 时
  // sectionsStore 会用 DEFAULT_SECTION_NAME 兜底。
  // 想改名字 afterwards 右键该圆点 → 「重命名」即可。
  async function addSection() {
    const res = await sectionsStore.getState().add();
    if (res.ok) {
      uiStore.getState().setCurrentSection(res.value.id);
    } else {
      uiStore.getState().toast(res.error, 'error');
    }
  }

  // ── 右键圆点：重命名 / 删除 ──
  // 删除与重命名都直接走 sectionsStore 里的现成方法，
  // 默认分区的「不可删/ 不可改名」由 store 自己兜住（返回错误 → toast 提示）。
  let dotMenu = $state<{ x: number; y: number; id: string; name: string } | null>(
    null,
  );
  let renaming = $state(false);
  let renameName = $state('');
  /**
   * 重命名目标 id 单独存一份：菜单收起时 dotMenu 已被置空，
   * 若靠 dotMenu 取id，commitRename 永远拿到 null、重命名会静默失败。
   */
  let renameTargetId = $state('');

  function openDotMenu(event: MouseEvent, id: string, name: string) {
    event.preventDefault();
    event.stopPropagation();
    dotMenu = { x: event.clientX, y: event.clientY, id, name };
  }

  function startRename() {
    if (!dotMenu) return;
    renameTargetId = dotMenu.id;
    renameName = dotMenu.name;
    renaming = true;
    dotMenu = null;
  }

  async function commitRename() {
    if (!renaming) return;
    const id = renameTargetId;
    const name = renameName.trim();
    cancelRename();
    if (!id || !name) return;
    const res = await sectionsStore.getState().rename(id, name);
    if (!res.ok) uiStore.getState().toast(res.error, 'error');
  }

  function cancelRename() {
    renaming = false;
    renameName = '';
    renameTargetId = '';
  }

  async function removeSection(id: string) {
    const res = await sectionsStore.getState().remove(id);
    if (!res.ok) {
      uiStore.getState().toast(res.error, 'error');
      return;
    }
    // 删掉的正是当前分区时，把视图切回默认分区（默认分区必然还在）
    if (uiStore.getState().currentSectionId === id) {
      uiStore.getState().setCurrentSection(DEFAULT_SECTION_ID);
    }
  }
</script>

<div class="pill glass-tile" role="tablist" aria-label="快捷方式分区">
  <div class="pill__dots" style:--max-visible={MAX_VISIBLE}>
    {#each dotsSections as s (s.id)}
      <button
        class="pill__dot"
        class:pill__dot--active={s.id === currentSectionId}
        type="button"
        role="tab"
        aria-selected={s.id === currentSectionId}
        title={`${s.name}（右键可重命名 / 删除）`}
        aria-label={s.name}
        onclick={() => select(s.id)}
        oncontextmenu={(e) => openDotMenu(e, s.id, s.name)}
      ></button>
    {/each}
  </div>

  <button
    class="pill__add"
    type="button"
    title="新建分区"
    aria-label="新建分区"
    onclick={addSection}
  >
    <SvgIcon name="plus" size={17} />
  </button>
</div>

<!--
  右键菜单与重命名弹层**必须放在 .pill 外面**：
  .pill 为了水平居中带了 transform: translateX(-50%)，
  而 transform 会为 position: fixed 的后代建立包含块 ——
  菜单若挂在胶囊内，会被「困」在胶囊的尺寸里并随胶囊一起偏移，
  结果就是弹出来一小块、或干脆被裁掉。
  挪到胶囊外（同一层兄弟节点）才能按视口坐标正常定位。
-->
{#if dotMenu}
  <ContextMenu
    x={dotMenu.x}
    y={dotMenu.y}
    items={[
      {
        id: 'rename',
        label: '重命名',
        icon: 'edit',
        disabled: dotMenu.id === DEFAULT_SECTION_ID,
      },
      {
        id: 'remove',
        label: '删除分区',
        icon: 'trash',
        danger: true,
        disabled: dotMenu.id === DEFAULT_SECTION_ID,
      },
    ]}
    onselect={(id) => {
      if (id === 'rename') startRename();
      else if (id === 'remove') {
        const target = dotMenu;
        dotMenu = null;
        if (target) void removeSection(target.id);
      }
    }}
    onclose={() => (dotMenu = null)}
  />
{/if}

<!-- 重命名输入弹层：固定在胶囊正上方，菜单收起后才出现，避免两个浮层叠在一起 -->
{#if renaming}
  <div class="pill__rename-pop glass" role="dialog" aria-label="重命名分区">
    <input
      class="pill__add-input"
      bind:value={renameName}
      type="text"
      placeholder="分区名称"
      maxlength="32"
      autofocus
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commitRename();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelRename();
        }
      }}
    />
    <button class="pill__add-confirm" type="button" onclick={commitRename}>确定</button>
  </div>
{/if}

<style>
  .pill {
    position: fixed;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    /* 高于页面内容，低于遮罩(70)/抽屉(80)/弹窗(100)，避免遮挡设置等浮层 */
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    /* 圆角跟随全局「圆角大小」滑块（与搜索卡片、快捷方式同套变量） */
    border-radius: var(--radius-xl);
    max-width: calc(100vw - 32px);
    /* 仅胶囊自身响应指针，不拦截其下方内容（pointer-events 默认 auto 即可，
       因为胶囊是独立浮层，下面没有需要点到的同位置元素） */
  }

  .pill__dots {
    display: flex;
    align-items: center;
    gap: 11px;
    overflow-x: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
    /* 优先展示前 --max-visible 颗；超出则本行内部横向滚动 */
    max-width: min(62vw, 440px);
  }

  .pill__dots::-webkit-scrollbar {
    display: none;
  }

  .pill__dot {
    width: 11px;
    height: 11px;
    flex: none;
    padding: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 26%, transparent);
    transition:
      width var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-soft),
      transform var(--dur-base) var(--ease-out);
  }

  /* 当前分区：拉长 + 强调色，像 iOS 分页指示器的「当前页」 */
  .pill__dot--active {
    width: 30px;
    background: var(--accent);
  }

  .pill__dot:hover {
    background: color-mix(in srgb, var(--text) 46%, transparent);
  }

  .pill__dot--active:hover {
    background: var(--accent);
  }

  .pill__add {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 999px;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text) 8%, transparent);
    transition:
      background-color var(--dur-fast) var(--ease-soft),
      color var(--dur-fast) var(--ease-soft),
      transform var(--dur-fast) var(--ease-out);
  }

  .pill__add:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 16%, transparent);
  }

  .pill__add:active {
    transform: scale(0.94);
  }

  /* ── 弹层入场动画（重命名弹层复用） ── */
  @keyframes pill-pop-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* 重命名弹层：在胶囊之外（见模板注释），故自行按视口定位到胶囊正上方 */
  .pill__rename-pop {
    position: fixed;
    left: 50%;
    bottom: 74px;
    transform: translateX(-50%);
    z-index: var(--z-nested);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: var(--radius-md);
    box-shadow: 0 12px 36px -18px var(--shadow);
    animation: pill-pop-in var(--dur-base) var(--ease-out);
  }

  .pill__add-input {
    width: 140px;
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--line);
    font-size: var(--fs-base);
  }

  .pill__add-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .pill__add-confirm {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: var(--fs-base);
    font-weight: 500;
    white-space: nowrap;
  }

  .pill__add-confirm:hover {
    filter: brightness(1.08);
  }

  .pill__add-confirm:active {
    transform: scale(0.97);
  }
</style>
