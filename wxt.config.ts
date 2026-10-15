import { defineConfig } from 'wxt';

// 起始页扩展配置
// 目标平台：Edge / Chromium，Manifest V3
// 合规要点：只为「必应每日壁纸」申请 www.bing.com 这一个主机的读取权限，
//          不注入 content script，不读取任何页面内容，不调用第三方 suggest API。
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],

  manifest: {
    name: 'JohnChen聚合搜索起始页',
    short_name: 'JohnChen聚合搜索起始页',
    description:
      '极简立体搜索起始页：多引擎快捷搜索、本地搜索推荐、快捷方式与收藏夹弹窗。数据只存在本地。',
    version: '0.1.0',

    // —— 权限：均为功能性必需 ——
    // bookmarks : 自绘收藏夹弹窗（扩展无法嵌入原生书签 UI，必须用 API 自绘）
    // storage   : chrome.storage.sync / local 存配置
    // favicon   : 通过 chrome-extension://<id>/_favicon/ 读取站点原始 logo
    permissions: ['bookmarks', 'storage', 'favicon'],

    // 只为必应壁纸接口开一个口子。
    // 该接口（HPImageArchive.aspx）不返回 CORS 头，扩展页面属于普通网页上下文，
    // 没有主机权限就拿不到 images 列表；而图片本体走 <img> 加载，不需要权限。
    // 两个域名并列，运行时会依次重试（见 lib/bing.ts 的 BING_API_HOSTS）：
    //   · www.bing.com —— 官方主域
    //   · cn.bing.com  —— 同一套接口的国内入口，返回完全相同的 JSON
    // 刻意不加 <all_urls>，权限面精确到两个域名。
    host_permissions: ['https://www.bing.com/*', 'https://cn.bing.com/*'],

    // 替换新标签页
    chrome_url_overrides: { newtab: 'newtab.html' },

    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },

    // 禁止远程代码，保证审核通过
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },

    minimum_chrome_version: '114',
  },

  // 开发期默认启动 Edge
  webExt: {
    binaries: {
      edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    },
  },

  vite: () => ({
    build: {
      // 包体积预算 < 300KB gzip，这里按未压缩 chunk 给出提示阈值
      chunkSizeWarningLimit: 300,
      reportCompressedSize: true,
    },
  }),
});
