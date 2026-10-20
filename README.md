# 极简聚合搜索起始页（Edge / Chromium 扩展）

液态玻璃的构建设计，主要的功能是可以再输入检索词之后通过一次点击直接跳转特定搜索引擎搜索
支持选择性导入浏览器的收藏标签作为快捷方式，可以构建多个快捷方式页面，壁纸支持必应壁纸和本地导入

支持的内置搜索引擎：**必应、谷歌、百度、DeepSeek、千问、B站、油管、小红书、知乎、豆瓣、有道词典**。

<img width="2864" height="1536" alt="image" src="https://github.com/user-attachments/assets/044af5bf-149c-463e-9a58-730d6718a1ef" />

技术栈：**WXT + Svelte 5（runes）+ TypeScript + Vite + Zustand + 原生 CSS**，
构建目标为 **Manifest V3**，适配 Edge / Chromium。

---

## 快速开始

```bash
pnpm install
pnpm dev          # 启动开发模式，自动打开装载了扩展的 Edge
```

构建与打包：

```bash
pnpm build        # 产出 .output/edge-mv3/
pnpm zip          # 产出可提交到应用商店的 zip
```

### 手动装载到浏览器

1. 执行 `pnpm build`
2. 打开 `edge://extensions/`（Chromium 为 `chrome://extensions/`）
3. 打开右上角「开发人员模式」
4. 点击「加载解压缩的扩展」，选择 `.output/edge-mv3/` 目录
5. 新建标签页即可看到起始页

---

## 项目结构

```
src/
├── entrypoints/
│   ├── background.ts          # MV3 service worker：存储初始化 + 书签变更广播
│   └── newtab/
│       ├── index.html         # 起始页骨架
│       ├── main.ts            # 挂载入口、主题应用、首屏性能打点
│       └── App.svelte         # 应用外壳：模块装配 + 全局快捷键
├── components/                # 14 个 Svelte 组件
│   ├── SearchBar.svelte       # ★ 立体基线搜索框
│   ├── SuggestDropdown.svelte # 纯本地推荐下拉（最多 5 项）
│   ├── EngineBar.svelte       # 搜索引擎切换栏
│   ├── ShortcutGrid.svelte    # 快捷方式网格（拖拽 / 右键菜单）
│   ├── ShortcutLogo.svelte    # favicon 降级链 + 首字母兜底
│   ├── BookmarkDialog.svelte  # 收藏夹模态弹窗（720×560）
│   ├── SettingsPanel.svelte   # 右侧滑出设置抽屉（6 个标签页）
│   ├── ContextMenu.svelte     # 右键上下文菜单
│   ├── Wallpaper.svelte       # 壁纸层（懒加载）
│   ├── SettingsButton.svelte  # 右下角固定齿轮
│   ├── ToastHost.svelte、SvgIcon.svelte
├── lib/
│   ├── storage.ts             # chrome.storage 封装（含内存回退）
│   ├── validate.ts            # 类型守卫 + 数据归一化
│   ├── indexeddb.ts           # 壁纸与自定义图标（idb）
│   ├── bookmarks.ts           # 书签树读取、搜索、变更监听
│   ├── favicon.ts             # favicon 候选链与首字母色相
│   ├── suggest.ts             # 推荐排序、防抖、URL 识别
│   ├── layout.ts              # 12 栅格、预设布局、撤销重做
│   ├── drag.ts                # Pointer Events 拖拽、落点计算
│   ├── io.ts                  # 配置导入导出、重置
│   ├── theme.ts               # 配色变量与主题切换
│   ├── defaults.ts            # 内置引擎、模块、预设、各类上限
│   ├── icons.ts               # 内联 SVG 图标表
│   ├── platform.ts            # 环境探测与跨环境适配
│   └── zoo.ts                 # Zustand ↔ Svelte 5 桥
├── stores/                    # 8 个 Zustand vanilla store
│   ├── settings.ts（含 modules）、engines.ts、shortcuts.ts
│   ├── layout.ts、ui.ts、bookmarks.ts、bridge.ts、index.ts（boot 编排）
└── types/index.ts             # 全部接口 + SCHEMA_VERSION

public/theme-init.js           # 防闪白脚本（必须独立文件，见下文）
tests/unit/                    # 133 个 Vitest 用例
tests/e2e/_manual/             # 真实扩展 E2E（默认不跑）
```

---

## 关键设计决策

### 搜索框为什么不用 `<input>` 的边框

基线由四层叠成：`.search__line`（主线）、`.search__highlight`（顶部高光）、
`.search__shadow`（底部投影）与 `.search__accent`（聚焦时点亮的强调段）。
四层都是 1px 级别的绝对定位元素，宽度由 `--line-length` 驱动，
输入时以 150–250ms `ease-out` 过渡 —— 只动 `width`/`transform`/`opacity`，
不触发重排。

### 防闪白脚本必须是「外部 + 同步」

`public/theme-init.js` 有三条硬约束，改动前务必确认：

1. **不能内联** —— MV3 的 CSP 是 `script-src 'self'`，内联脚本会被直接拦截
2. **不能是 `type="module"`** —— module 天然 defer，跑在样式表之后就没有意义
3. **不能写成 `.ts`** —— 它不走打包，没有转译步骤

### 存储层带内存回退

`lib/storage.ts` 在没有 `chrome.storage` 的环境（Vitest / 纯网页预览）下
自动降级为内存 Map，且仍然派发变更事件。因此同一套业务代码在
**扩展 / 测试 / 预览** 三种环境都能跑，测试也能覆盖「无 API」这条分支。

### `assignOrder` 与 `reindexOrder` 不可混用

两者都是给 `order` 字段赋值，但语义相反：

- `reindexOrder(list)` —— **按现有 `order` 重排数组**。用于从存储读回数据后归一化。
- `assignOrder(list)` —— **按当前数组下标重写 `order`**。用于拖拽排序、上移下移。

拖拽后如果误用 `reindexOrder`，它会按旧的 `order` 把顺序排回去，
表现为「拖了没反应」。`stores/shortcuts.ts`、`engines.ts`、`settings.ts`
的写入路径都必须用 `assignOrder`。

### 合规边界

| 项 | 结论 |
| --- | --- |
| 申请权限 | 仅 `bookmarks`、`storage`、`favicon` |
| `host_permissions` | **空数组**，不申请任何主机权限 |
| 推荐服务 | **纯本地**，不调用任何外部联想接口 |
| 搜索词 | 不上传、不落盘、不统计 |
| 书签 | 仅本地读取与展示，不上传 |
| 图标 | 全部内联 SVG，不热链第三方 CDN |

因为不申请主机权限，`favicon` 候选链里「抓取 manifest / apple-touch-icon /
og:image」这几步在运行时拿不到跨域响应，代码中已标注为不可用分支并保留为空实现；
实际生效的是 `chrome://favicon` → `/favicon.ico` → 首字母兜底。

### Service worker 不做保活

MV3 的 service worker 会被空闲回收，因此 `background.ts` 里没有 `setInterval`。
书签变更用 `chrome.bookmarks` 的事件监听，配合 200ms 合并窗口再广播给
已打开的起始页，避免一次导入触发上百条消息。

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发模式（自动装载扩展） |
| `pnpm build` | 生产构建 |
| `pnpm zip` | 打包 zip |
| `pnpm test` | 运行单元测试（133 个） |
| `pnpm lint` | ESLint 检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm compile` | svelte-check 组件类型检查 |
| `pnpm typecheck` | tsc 纯类型检查 |

---

## 已知边界

- **E2E 用例默认不运行**：真实扩展 E2E 需要 headed 浏览器（MV3 的
  service worker 在旧 headless 下不注册）且多数用例依赖外网，
  因此隔离在 `tests/e2e/_manual/`，说明见该目录下 README。
- **`pnpm typecheck` 尚有严格空值报错**：`src/lib/` 下若干通过
  `split()` / `exec()` 取值的分支未做 `undefined` 收窄。这些位置
  在运行时是安全的（前面已有长度判断），但尚未补齐类型收窄。
  生产构建与 `svelte-check` 均不受影响。
