# E2E 保留区（默认不运行）

这里的用例需要**真实扩展上下文**才能跑，依赖条件如下：

1. 有显示设备的 headed Chromium（旧 headless 不加载 MV3 的 service worker）
2. 可访问外网（跳转类用例断言真实搜索引擎 URL）

因此它们与 `pnpm test` / `pnpm build` 解耦，默认不执行。要跑的话：

```bash
pnpm build
npx playwright test tests/e2e/_manual/newtab.spec.ts.txt --config playwright.local.ts
```

`newtab.spec.ts.txt` 里的选择器与断言都是按真实 DOM 写的，
恢复成 `.spec.ts` 即可使用；如需在无外网环境跑，
把内置引擎的 `urlTemplate` 换成 `playwright.config.ts` 里的 `baseURL` 即可。

已在此验证过的关键结论：

- MV3 扩展在旧 `headless: true` 下 **不会注册 service worker**，必须 headed
- 扩展页 `chrome-extension://` 上的 `<script>` 受 `script-src 'self'` 约束，
  **内联脚本会被拦截** —— 防闪白脚本因此改为 `public/theme-init.js`
- `window.location.replace` / `location.href` / `chrome.tabs.update`
  三种跳转方式在扩展页上均可用
