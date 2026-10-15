import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 配置（E2E 保留区）
 *
 * 只扫描 `tests/e2e/_manual/`，该目录默认不参与 CI。
 * 运行前提见 tests/e2e/_manual/README.md。
 *
 * ⚠️ 必须 headed：Chromium 的旧 headless 不加载 MV3 的 service worker。
 *    Linux CI 上用 `xvfb-run -a npx playwright test --config playwright.config.ts` 包一层。
 */
export default defineConfig({
  testDir: './tests/e2e/_manual',
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // 扩展测试共用同一个浏览器上下文，串行执行避免互相干扰
  workers: 1,
  retries: 0,
  reporter: [['list']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'edge-extension',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
