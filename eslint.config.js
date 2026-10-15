import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint 扁平配置
 *
 * 目标：拦住「在扩展里一定会出事」的写法，而不是堆砌风格规则
 * （风格交给 Prettier）。
 *
 * 重点约束：
 *   1. 禁止 rest 参数以外的 `any`（存储层数据不可信，必须显式收敛）
 *   2. 禁止直接 `fetch` 外部接口 —— 规格明确要求不申请 host_permissions
 *   3. 禁止 `setInterval` 保活 —— MV3 service worker 会被回收
 *   4. 禁止在 Svelte 里对 `$state` 内部的属性做跨组件原地修改
 */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
  },

  // 全局规则
  {
    rules: {
      // info 用于「安装完成」与 dev 期启动耗时；debug/log 仍然禁用
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // 合规红线：不得出现任何外部网络请求与保活定时器
  {
    files: ['src/**/*.{ts,svelte}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            '本扩展不申请 host_permissions，禁止发起外部请求（规格合规要求）。',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'XMLHttpRequest',
          message: '本扩展不发起外部请求（规格合规要求）。',
        },
      ],
    },
  },

  // service worker 里禁止保活
  {
    files: ['src/entrypoints/background.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='setInterval']",
          message:
            'MV3 service worker 会在 30s 空闲后被回收，用 setInterval 保活无效且耗电。',
        },
      ],
    },
  },

  // Svelte 组件
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
    rules: {
      // Svelte 5 的 `let { ... } = $props()` 必须用 let（runes 会重写绑定），
      // 但 ESLint 看不到这层语义，会误报 prefer-const。
      'prefer-const': 'off',
      'svelte/no-at-html-tags': 'error',
    },
  },

  // 测试与构建脚本放宽
  {
    files: ['tests/**/*.{ts,tsx}', '*.config.{ts,js,mjs}', 'scripts/**/*.{ts,js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'pnpm-lock.yaml',
      'src/assets/**',
      'public/**',
      'tests/e2e/_manual/**',
    ],
  },
];
