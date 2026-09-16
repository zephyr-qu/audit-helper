import { browser } from 'wxt/browser';
import { MSG, type BackgroundMessage, type TabStatsSummary } from '@/utils/messages';
import { getSettings, parseSelectionKeywords, settingsStorage, updateSettings } from '@/utils/settings';
import { actionKind } from '@/utils/types';
import type { StatsSnapshot } from '@/utils/types';

const MENU_ROOT = 'kwa-add-root';
const GROUP_PREFIX = 'kwa-add-group-';

export default defineBackground(() => {
  /** 菜单结构指纹：只有会影响菜单结构的设置变化才需要重建 */
  let menuFingerprint = '';

  /** 按当前分组重建右键菜单；force 用于安装/启动后菜单必然不存在的情况 */
  async function rebuildMenus(force = false): Promise<void> {
    try {
      const settings = await getSettings();
      const groups = settings.groups.filter((group) => group.enabled);
      const fingerprint = JSON.stringify(groups.map((group) => [group.id, group.name]));
      if (!force && fingerprint === menuFingerprint) return;
      menuFingerprint = fingerprint;

      await browser.contextMenus.removeAll();
      if (groups.length === 0) return;

      browser.contextMenus.create({
        id: MENU_ROOT,
        title: '添加选中文字为关键词',
        contexts: ['selection'],
      });
      for (const [index, group] of groups.entries()) {
        browser.contextMenus.create({
          id: `${GROUP_PREFIX}${group.id}`,
          parentId: MENU_ROOT,
          title: group.name || `分组 ${index + 1}`,
          contexts: ['selection'],
        });
      }
    } catch (error) {
      // 失败后清掉指纹，下次设置变化时再试
      menuFingerprint = '';
      console.warn('[合规审查助手] 右键菜单创建失败', error);
    }
  }

  /** 每个 tab 下各 frame 的统计，iframe 内的命中也要计入 badge */
  const frameStats = new Map<string, StatsSnapshot>();

  function clearTab(tabId: number): void {
    for (const key of [...frameStats.keys()]) {
      if (key.startsWith(`${tabId}:`)) frameStats.delete(key);
    }
  }

  /** 汇总该 tab 下所有 frame 的统计（与 badge 同一数据源） */
  function summarize(tabId: number): TabStatsSummary {
    let total = 0;
    let frameCount = 0;
    for (const [key, stats] of frameStats) {
      if (!key.startsWith(`${tabId}:`)) continue;
      total += stats.total;
      frameCount += 1;
    }
    const topTotal = frameStats.get(`${tabId}:0`)?.total ?? 0;
    return { frameCount, total, otherTotal: Math.max(0, total - topTotal) };
  }

  /** 把汇总推给顶层 frame，让页内面板与角标口径一致 */
  async function pushSummary(tabId: number): Promise<void> {
    try {
      await browser.tabs.sendMessage(
        tabId,
        { type: MSG.FRAME_STATS, summary: summarize(tabId) },
        { frameId: 0 },
      );
    } catch {
      /* 顶层没有 content script（商店页、chrome:// 页等）时忽略 */
    }
  }

  /** badge 取「建议驳回」档位的命中数（跨 frame 汇总），为 0 时降级显示总数 */
  async function applyBadge(tabId: number): Promise<void> {
    let total = 0;
    let rejectCount = 0;
    let rejectColor = '#64748b';

    for (const [key, stats] of frameStats) {
      if (!key.startsWith(`${tabId}:`)) continue;
      total += stats.total;
      for (const level of stats.levels) {
        if (actionKind(level.action) !== 'block' || level.count === 0) continue;
        rejectCount += level.count;
        rejectColor = level.color;
        break;
      }
    }

    const topCount = rejectCount;
    const topColor = rejectColor;
    const value = topCount > 0 ? topCount : total;
    const text = value === 0 ? '' : value > 99 ? '99+' : String(value);
    try {
      await browser.action.setBadgeText({ tabId, text });
      if (text) {
        await browser.action.setBadgeBackgroundColor({
          tabId,
          color: topCount > 0 ? topColor : '#64748b',
        });
      }
    } catch {
      /* 标签页已关闭，忽略 */
    }
  }

  browser.runtime.onInstalled.addListener(() => void rebuildMenus(true));
  browser.runtime.onStartup.addListener(() => void rebuildMenus(true));
  settingsStorage().watch(() => void rebuildMenus());

  browser.contextMenus.onClicked.addListener((info) => {
    const menuItemId = String(info.menuItemId ?? '');
    if (!menuItemId.startsWith(GROUP_PREFIX)) return;
    const groupId = menuItemId.slice(GROUP_PREFIX.length);
    const words = parseSelectionKeywords(info.selectionText ?? '');
    if (words.length === 0) return;

    void updateSettings((settings) => {
      const group = settings.groups.find((item) => item.id === groupId);
      if (!group) return settings;
      const merged = new Set(group.keywords);
      for (const word of words) merged.add(word);
      group.keywords = [...merged];
      return settings;
    });
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;
    const payload = message as BackgroundMessage;

    // popup 不在 tab 内，靠消息里带上的 tabId 查汇总
    if (payload.type === MSG.TAB_STATS) {
      const targetTab = sender.tab?.id ?? payload.tabId;
      sendResponse(targetTab == null ? null : summarize(targetTab));
      return;
    }

    if (payload.type !== MSG.STATS) return;
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    frameStats.set(`${tabId}:${sender.frameId ?? 0}`, payload.stats);
    void applyBadge(tabId);
    void pushSummary(tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => clearTab(tabId));
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'loading') return;
    // 导航后旧 frame 的统计作废，顺带把清零后的汇总推给新一轮的顶层 frame
    clearTab(tabId);
    void pushSummary(tabId);
  });

  void rebuildMenus(true);
});
