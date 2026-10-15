/**
 * 首屏防闪白（放在 public/ 下按原样拷贝，不经打包）
 *
 * 必须在任何样式表/模块脚本之前同步执行，因此：
 *   1. 用独立文件而不是内联 —— MV3 CSP 是 `script-src 'self'`，内联会被拦掉
 *   2. 不能用 type="module" —— module 天然 defer，起不到防闪白作用
 *   3. 不能写 TS —— 不走打包就没有转译步骤
 *
 * 职责：在样式表解析前把 data-theme / color-scheme / 底色写好，
 *      消除「先浅后深」的一次跳色。
 */
(function () {
  try {
    var stored = localStorage.getItem('sp:theme-cache');
    var mode = stored || 'system';
    var dark =
      mode === 'dark' ||
      (mode === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.style.backgroundColor = dark ? '#0d0f14' : '#f6f7f9';
  } catch (e) {
    /* 存储不可用时交给默认样式 */
  }
})();
