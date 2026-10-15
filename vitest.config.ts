import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/stores/**/*.ts'],
      exclude: ['src/lib/zoo.ts'],
    },
  },
  resolve: {
    alias: {
      // 让测试能直接 import '~/lib/xxx'
      '~': new URL('./src', import.meta.url).pathname,
    },
  },
});
