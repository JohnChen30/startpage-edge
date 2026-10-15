/**
 * 收藏夹 —— chrome.bookmarks 只读封装
 *
 * 合规边界：
 *   · 扩展无法嵌入浏览器原生收藏夹 UI，必须用 API 自绘
 *   · P0 只读 + 导入到快捷方式，不直接编辑浏览器书签
 *   · 书签数据不上传、不同步、不写 chrome.storage
 *
 * 降级策略：
 *   · 权限被拒 → 返回 denied，UI 显示重新授权引导
 *   · 环境不支持（测试 / 预览）→ 返回 demo 演示数据，保证弹窗可验收
 */
import type {
  BookmarkNode,
  BookmarksSnapshot,
  BookmarkPermissionState,
} from '../types';

/** 演示数据：仅在无法访问真实书签时使用，方便预览弹窗完整形态 */
const DEMO_TREE: BookmarkNode[] = [
  {
    id: 'demo-root-1',
    title: '收藏夹栏',
    children: [
      {
        id: 'demo-1',
        parentId: 'demo-root-1',
        title: 'GitHub',
        url: 'https://github.com',
        dateAdded: Date.now() - 86400000 * 30,
      },
      {
        id: 'demo-2',
        parentId: 'demo-root-1',
        title: 'MDN Web Docs',
        url: 'https://developer.mozilla.org/zh-CN/',
        dateAdded: Date.now() - 86400000 * 20,
      },
      {
        id: 'demo-folder-1',
        parentId: 'demo-root-1',
        title: '开发工具',
        children: [
          {
            id: 'demo-3',
            parentId: 'demo-folder-1',
            title: 'WXT 文档',
            url: 'https://wxt.dev',
            dateAdded: Date.now() - 86400000 * 10,
          },
          {
            id: 'demo-4',
            parentId: 'demo-folder-1',
            title: 'Svelte 5 文档',
            url: 'https://svelte.dev/docs/svelte/overview',
            dateAdded: Date.now() - 86400000 * 9,
          },
          {
            id: 'demo-folder-2',
            parentId: 'demo-folder-1',
            title: '图标资源',
            children: [
              {
                id: 'demo-5',
                parentId: 'demo-folder-2',
                title: 'Lucide Icons',
                url: 'https://lucide.dev',
                dateAdded: Date.now() - 86400000 * 8,
              },
              {
                id: 'demo-6',
                parentId: 'demo-folder-2',
                title: 'Simple Icons',
                url: 'https://simpleicons.org',
                dateAdded: Date.now() - 86400000 * 7,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'demo-root-2',
    title: '其它书签',
    children: [
      {
        id: 'demo-7',
        parentId: 'demo-root-2',
        title: 'Vite',
        url: 'https://vitejs.dev',
        dateAdded: Date.now() - 86400000 * 5,
      },
      {
        id: 'demo-8',
        parentId: 'demo-root-2',
        title: 'TypeScript',
        url: 'https://www.typescriptlang.org/docs/',
        dateAdded: Date.now() - 86400000 * 4,
      },
      {
        id: 'demo-9',
        parentId: 'demo-root-2',
        title: 'Zustand',
        url: 'https://zustand.docs.pmnd.rs',
        dateAdded: Date.now() - 86400000 * 3,
      },
    ],
  },
];

export interface BookmarksApi {
  getTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  getSubTree(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  search(query: string): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
}

function api(): BookmarksApi | null {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) return null;
  return {
    getTree: () => chrome.bookmarks.getTree(),
    getSubTree: (id) => chrome.bookmarks.getSubTree(id),
    search: (q) => chrome.bookmarks.search(q),
  };
}

/** 当前是否具备真实书签能力 */
export function hasBookmarksApi(): boolean {
  return api() !== null;
}

// ── 权限探测 ────────────────────────────────────────────────

export async function probePermission(): Promise<BookmarkPermissionState> {
  if (!hasBookmarksApi()) return 'denied';
  // manifest 里已声明 bookmarks，安装即授予；真正的拒绝场景是用户手动关掉权限
  try {
    await chrome.bookmarks.getTree();
    return 'granted';
  } catch {
    return 'denied';
  }
}

/** 引导用户回到扩展详情页重新授权 */
export function openPermissionPage(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  const url = `edge://extensions/?id=${chrome.runtime.id}`;
  // 新标签页里无法直接开 edge:// 时退回 chrome://
  const target = navigator.userAgent.includes('Edg/')
    ? url
    : `chrome://extensions/?id=${chrome.runtime.id}`;
  window.open(target, '_blank');
}

// ── 转换与扁平化 ────────────────────────────────────────────

function toNode(raw: chrome.bookmarks.BookmarkTreeNode): BookmarkNode {
  const node: BookmarkNode = {
    id: raw.id,
    parentId: raw.parentId,
    // 无标题的**文件夹**只有一个来源：Chrome / Edge 书签树最外层那个虚拟根节点
    // （getTree() 返回的第一层，它只是容器，title 永远是空字符串）。
    // 它出现在网格第一层时显示成「收藏夹」最贴切 —— 以前显示「未命名」，读起来像坏了。
    title: raw.title || (raw.url ? raw.url : '收藏夹'),
    url: raw.url,
    dateAdded: raw.dateAdded,
  };
  if (raw.children?.length) {
    node.children = raw.children.map(toNode);
  }
  return node;
}

/** 深度优先展开为可搜索的扁平列表 */
export function flatten(nodes: BookmarkNode[]): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  const walk = (list: BookmarkNode[]) => {
    for (const n of list) {
      if (n.url) out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function makeSnapshot(
  state: BookmarkPermissionState,
  tree: BookmarkNode[],
): BookmarksSnapshot {
  const flat = flatten(tree);
  return { state, tree, flat, count: flat.length };
}

const EMPTY: BookmarksSnapshot = makeSnapshot('empty', []);

export function demoSnapshot(): BookmarksSnapshot {
  return makeSnapshot('granted', DEMO_TREE);
}

// ── 读取 ────────────────────────────────────────────────────

/**
 * 读取收藏夹快照。
 * @param useDemoFallback 无 API 或权限被拒时是否返回演示数据（默认 true）
 */
export async function loadBookmarks(
  useDemoFallback = true,
): Promise<BookmarksSnapshot> {
  const client = api();
  if (!client) {
    return useDemoFallback ? demoSnapshot() : EMPTY;
  }
  try {
    const raw = await client.getTree();
    const tree = raw.map(toNode);
    const snap = makeSnapshot('granted', tree);
    if (snap.count === 0) {
      return useDemoFallback ? { ...demoSnapshot(), state: 'empty' } : EMPTY;
    }
    return snap;
  } catch (err) {
    console.warn('[bookmarks] 读取失败', err);
    return useDemoFallback ? demoSnapshot() : makeSnapshot('denied', []);
  }
}

/** 用 API 原生搜索，比内存过滤快得多（书签量大时） */
export async function searchBookmarks(query: string): Promise<BookmarkNode[]> {
  const client = api();
  if (!client) return searchInTree(demoSnapshot().flat, query);
  try {
    const raw = await client.search(query);
    return raw.filter((n) => n.url).map(toNode);
  } catch {
    return [];
  }
}

/** 本地过滤：弹窗内搜索用，避免频繁打 API */
export function searchInTree(flat: BookmarkNode[], query: string): BookmarkNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return flat;
  return flat.filter(
    (n) => n.title.toLowerCase().includes(q) || (n.url ?? '').toLowerCase().includes(q),
  );
}

// ── 变化监听 ────────────────────────────────────────────────

export type BookmarkChangeHandler = (snapshot: BookmarksSnapshot) => void;

/**
 * 订阅收藏夹变化。
 * 事件可能短时间密集触发（如批量导入），做 200ms 合并再重新拉取。
 */
export function watchBookmarks(onChange: BookmarkChangeHandler): () => void {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      onChange(await loadBookmarks());
    }, 200);
  };

  const events: chrome.events.Event<(...args: unknown[]) => void>[] = [
    chrome.bookmarks.onCreated as never,
    chrome.bookmarks.onRemoved as never,
    chrome.bookmarks.onChanged as never,
    chrome.bookmarks.onMoved as never,
    chrome.bookmarks.onImportEnded as never,
  ];

  for (const ev of events) {
    ev?.addListener?.(schedule);
  }

  return () => {
    if (timer) clearTimeout(timer);
    for (const ev of events) ev?.removeListener?.(schedule);
  };
}

// ── 导入到快捷方式 ──────────────────────────────────────────

export interface BookmarkToShortcutInput {
  title: string;
  url: string;
}

export function bookmarkToShortcutInput(
  node: BookmarkNode,
): BookmarkToShortcutInput | null {
  if (!node.url) return null;
  return { title: node.title || node.url, url: node.url };
}
