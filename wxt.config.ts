import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  // assets/ 下是手工另存的页面快照（含浏览器下载残留的 *.下载 文件，常被系统锁住），
  // FSWatcher 撞上 EBUSY 会直接崩掉 dev 进程、构建中断，这里排除监听。
  vite: () => ({
    server: {
      watch: {
        ignored: (path: string) => /[\\/]assets[\\/]/.test(path),
      },
    },
  }),
  // Chrome 137+ 已收紧自动加载扩展的能力，dev 时只启动 dev server，
  // 浏览器中手动加载 .output/chrome-mv3-dev 即可（需自动打开时删掉这段）。
  webExt: {
    disabled: true,
  },
  manifest: {
    name: '合规审查助手',
    description: '在审核页面自动高亮违规关键词，按处置档位分类审查，辅助快速识别合规风险。',
    permissions: ['storage', 'contextMenus', 'activeTab'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '合规审查助手',
    },
  },
});
