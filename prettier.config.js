/**
 * Prettier 配置
 *
 * 与 Svelte 官方插件配合，保证 .svelte 文件里的 <style>/<script> 也能被格式化。
 */
export default {
  printWidth: 88,
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  arrowParens: 'always',
  bracketSameLine: false,
  plugins: ['prettier-plugin-svelte'],
  overrides: [
    {
      files: '*.svelte',
      options: { parser: 'svelte' },
    },
  ],
};
