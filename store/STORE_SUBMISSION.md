# 上架 Microsoft Edge 加载项商店 · 提交套件

> 扩展：**JohnChen聚合搜索起始页** ｜ 版本：`0.1.0` ｜ 商店包：`store/startpage-edge-0.1.0.zip`

---

## 0. 先看结论（30 秒）

- **Edge 加载项商店没有公开的提交 API**，发布只能在 **Microsoft Partner Center** 网页后台手动完成，必须用**你自己的微软账号**登录。
- 注册 Partner Center（Edge 计划）**免费**。
- 本 `store/` 目录已备好：**商店包 zip、300×300 Logo、推荐图**；下面的**文案可直接复制粘贴**。
- 剩下只有 **3 件只能你本人做的事**：
  1. 注册并登录 Partner Center；
  2. 补 **≥1 张真实截图**（1280×800 或 640×480）；
  3. 把 `store/` 推到 GitHub 后，用 `PRIVACY.md` 的链接作为**隐私政策 URL**。

---

## 1. 资产清单

| 项目 | 位置 | 状态 | 要求 |
|---|---|---|---|
| 扩展包 | `store/startpage-edge-0.1.0.zip` | ✅ 已生成 | manifest 在压缩包根目录 |
| manifest 合规 | `.output/edge-mv3/manifest.json` | ✅ MV3 / CSP `script-src 'self'` / 无远程代码 | — |
| 128 图标 | `public/icon/128.png` | ✅ | 已在 manifest 声明 |
| 商店 Logo | `store/logo-300.png` | ✅ | 300×300 PNG |
| 小推荐图（可选） | `store/tile-440x280.png` | ✅ | 440×280 |
| 大推荐图（可选） | `store/tile-1400x560.png` | ✅ | 1400×560 |
| 截图 | — | ❌ **待你截取** | ≥1 张，1280×800 或 640×480，PNG/JPG |
| 隐私政策 URL | `store/PRIVACY.md` | ⏳ 推送后可用 | 需公网可访问 |
| 支持 / 官网 | — | ✅ | `https://github.com/JohnChen30/startpage-edge` |
| 开发者账号 | Partner Center | ❌ **需你注册** | 微软账号，免费 |

---

## 2. 操作步骤（Partner Center）

### 2.1 先完成开发者注册（报 "Account not found" 就是卡在这）

> ⚠️ **Edge 计划只接受 Microsoft 账户（MSA：Outlook.com / Live.com / Hotmail.com）。工作/学校账号（公司邮箱、Entra ID）无法注册**——用工作账号登录就会看到 `Account not found / 找不到账户`。

1. 打开 **Edge 专用登录入口**：<https://partner.microsoft.com/dashboard/microsoftedge/public/login>
2. 用 **MSA** 登录。若浏览器自动登进了工作账号：用 InPrivate/无痕窗口，或先退出再手动用 MSA 登录。
3. 登录后 **Edge 开发人员注册表单通常会直接弹出**；若没有，打开 <https://partner.microsoft.com/dashboard/account/v3/settings/programs>，在 **Microsoft Edge** 卡片点 **「入门 / Get started」**。
4. 填写注册表单：
   - **账户国家/地区**：选居住地 —— **注册后不可更改**
   - **账户类型**：选 **个人 / Individual**（验证快，只核对发布者显示名称；公司类型要几天到几周，还可能接到验证电话）—— **注册后不可更改**
   - **发布者显示名称**：建议 `JohnChen` 或 `JohnChen30`（≤50 字符，需未被占用）
   - **联系人信息**：填可收确认邮件的邮箱
   - 勾选接受 **Microsoft 应用商店应用开发人员协议** → 点 **完成 / Finish**
5. 注册**免费**。完成后收到确认邮件，等待账号验证（验证期间可继续准备扩展）。

> **没有 MSA？** 去 <https://account.microsoft.com/account> 点「创建 Microsoft 账户」；或用你的 GitHub 账号登录 Partner Center，系统会自动创建并关联一个 MSA。

### 2.2 提交扩展

1. 注册验证通过后，进 Partner Center → **Microsoft Edge** → **新建扩展**。
2. 上传 `store/startpage-edge-0.1.0.zip`（名称/版本自动读取 manifest）。
3. 按第 3 节填 Store listing，上传 `store/logo-300.png` 与 ≥1 张真实截图。
4. 按第 4 节填权限与数据声明。
5. 提交审核（一般 **1–7 个工作日**）。

> 界面文字可能随版本微调，以上字段名以后台实际为准。

---

## 3. 逐字段文案（直接复制）

### 3.1 中文（主）

- **Extension name / 名称**
  ```
  JohnChen聚合搜索起始页
  ```
- **Short description / 简短描述**（≤132 字符）
  ```
  极简多引擎聚合搜索起始页：本地搜索推荐、快捷方式与收藏夹，数据只存本地，无追踪。
  ```
- **Detailed description / 详细描述**
  ```
  把新标签页变成你的高效搜索入口。

  JohnChen 聚合搜索起始页会把 Edge 的新标签页替换成干净利落的搜索起始页，集多引擎搜索、本地搜索推荐、快捷方式与收藏夹于一体，打开新标签页即可开始工作。

  功能亮点：
  • 多引擎聚合搜索 —— 必应、谷歌、百度、DeepSeek、通义千问、哔哩哔哩、YouTube、小红书等，一键切换，回车即搜。
  • 本地搜索推荐 —— 输入时在本地给出建议，不把输入内容发往第三方建议接口。
  • 快捷方式网格 —— 自定义常用网站，支持拖拽排序、分区管理，图标自动获取。
  • 收藏夹弹窗 —— 只读展示 Edge 书签，快速跳转，绝不修改或上传。
  • 每日壁纸 —— 自动同步必应每日壁纸，可调模糊 / 亮度 / 遮罩。
  • 深色 / 浅色主题、可调快捷方式尺寸、数据导入导出。

  隐私优先：
  • 所有设置、快捷方式、分区、壁纸都只存在你的设备本地。
  • 不收集、不上传任何个人数据；无遥测、无广告、无分析 SDK。
  • 书签仅本地只读展示，绝不修改或上传。
  • 仅在获取必应壁纸与搜索引擎图标时发起必要的网络请求。
  ```
- **Category / 分类**：`Search tools`（搜索工具）；备选 `Productivity`（生产力）
- **Search terms / 搜索关键词**
  ```
  起始页, 新标签页, 搜索, 聚合搜索, 快捷方式, 收藏夹, new tab, start page, search, homepage
  ```
- **Support URL / 支持链接**
  ```
  https://github.com/JohnChen30/startpage-edge/issues
  ```
- **Website URL / 官网**
  ```
  https://github.com/JohnChen30/startpage-edge
  ```
- **Privacy policy URL / 隐私政策**（推送 `store/` 到 GitHub 后使用）
  ```
  https://github.com/JohnChen30/startpage-edge/blob/main/store/PRIVACY.md
  ```

### 3.2 English（备用 / 面向国际用户）

- **Name**: `JohnChen Aggregated Search Start Page`
- **Short description**:
  ```
  A clean multi-engine search start page with local suggestions, shortcuts and bookmarks. All data stays on your device.
  ```
- **Detailed description**:
  ```
  Turn your new tab into a fast, focused search hub.

  This extension replaces the Edge new tab with a clean start page that combines multi-engine search, local search suggestions, shortcut tiles and a bookmark popup. Open a new tab and start working immediately.

  Highlights:
  • Multi-engine search — Bing, Google, Baidu, DeepSeek, Qwen, Bilibili, YouTube, Xiaohongshu and more. Switch with one click, press Enter to search.
  • Local suggestions — suggestions are generated locally; your keystrokes are not sent to any third-party suggestion API.
  • Shortcut grid — add your favorite sites, drag to reorder, organize into sections; icons are fetched automatically.
  • Bookmark popup — read-only access to your Edge bookmarks for quick navigation. Never modified, never uploaded.
  • Daily wallpaper — syncs Bing's daily wallpaper, with adjustable blur, brightness and mask.
  • Dark/light themes, adjustable shortcut size, data import/export.

  Privacy first:
  • All settings, shortcuts, sections and wallpapers stay on your device.
  • No personal data is collected or uploaded. No telemetry, ads or analytics SDKs.
  • Bookmarks are displayed locally and read-only — never modified or uploaded.
  • Network requests are made only to fetch Bing wallpaper and search-engine icons.
  ```
- **Category**: `Search tools`
- **Search terms**: `start page, new tab, search, homepage, bookmarks, shortcuts, aggregated search`

---

## 4. 权限与合规说明（审核会重点看）

| 权限 | 用途 | 是否读取用户数据 |
|---|---|---|
| `bookmarks` | 自绘收藏夹弹窗，**只读**展示书签 | 否，且不上传 |
| `storage` | 保存设置、快捷方式、分区 | 仅本地 |
| `favicon` | 通过 `chrome-extension://<id>/_favicon/` 显示站点图标（本地接口） | 否 |
| `https://www.bing.com/*` | 获取必应每日壁纸列表 | 否 |
| `https://cn.bing.com/*` | 同上（国内镜像入口） | 否 |

- **Single purpose / 单一用途**：
  ```
  将新标签页替换为聚合搜索起始页，提供多引擎搜索、本地搜索推荐、快捷方式与书签快速访问。
  ```
- **Remote code / 远程代码**：**No**。CSP 为 `script-src 'self'`，所有 JS 随包分发，不加载、不执行远程代码。
- **Data usage / 数据使用**：不收集、不传输任何个人信息；无遥测、无广告、无第三方分析。
- **第三方服务说明**（如审核问询可直接回复）：
  ```
  扩展仅为显示搜索引擎 Logo 向 a.favicon.im 请求图标，仅发送引擎域名（如 bing.com），不发送任何用户数据、搜索内容或标识符。
  ```

---

## 5. 截图（你必须自己截）

要求：**≥1 张**，尺寸 **1280×800** 或 **640×480**，PNG/JPG，内容需真实反映界面（不要用合成图冒充，否则易被拒）。

建议截 3 张：① 搜索主界面（含多引擎栏）② 快捷方式/分区网格 ③ 设置面板。

步骤：
1. Edge 打开 `edge://extensions` → 开启**开发人员模式** → **加载解压的扩展** → 选择 `.output/edge-mv3` 目录。
2. 打开新标签页。
3. 把窗口调到 1280×800（`Win + Shift + S` 截图，或开发者工具设备模拟）。
4. 保存 PNG，依次上传。

---

## 6. 审核风险与规避

| 风险点 | 说明 | 建议 |
|---|---|---|
| `a.favicon.im` 第三方请求 | 审核可能追问为何访问第三方 | 用第 4 节的说明回复：仅取引擎图标、只传域名、无用户数据 |
| `bookmarks` 属敏感权限 | 可能要求说明必要性 | 强调**只读、不上传**，并已在 UI 中说明 |
| 替换新标签页 | 正常用途但需明示 | 描述中已写明「替换新标签页」 |
| 名称含个人名 `JohnChen` | 部分商店偏好中性名称 | 如不需要，可改名后**同步改 manifest 并重新打包** |
| 隐私政策 | 必须公网可访问 | 推送后使用 GitHub 链接；确保页面可匿名打开 |
| 截图真实性 | 合成图易被拒 | 用真实扩展界面截图 |

---

## 7. 提交前 Checklist

- [ ] Partner Center 已注册并登录
- [ ] 上传 `store/startpage-edge-0.1.0.zip`
- [ ] Store listing 各字段已填（第 3 节）
- [ ] 上传 `store/logo-300.png` 与 ≥1 张真实截图
- [ ] 隐私政策 URL 可匿名访问
- [ ] 权限/数据声明已填（第 4 节）
- [ ] 点击提交，等待审核（1–7 工作日）
