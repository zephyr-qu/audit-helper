import { createApp } from 'vue';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { browser } from 'wxt/browser';
import AuditPanel from '@/components/AuditPanel.vue';
import { copyText } from '@/utils/clipboard';
import { Highlighter, compileRules, rulesFingerprint } from '@/utils/highlighter';
import {
  MSG,
  type ContentMessage,
  type FrameStatsMessage,
  type GotoDirection,
  type GotoMessage,
} from '@/utils/messages';
import { applyPageStyles, hideTip, showTip } from '@/utils/page-styles';
import { panelActions, panelState } from '@/utils/panel-state';
import { getSettings, isSiteEnabled, normalizeSettings, settingsStorage } from '@/utils/settings';
import type { Settings } from '@/utils/types';
import { buildReportText, computeVerdict } from '@/utils/verdict';

/** 动态内容增量扫描的防抖时间下限，避免设为 0 时退化为每次变更都立即扫描 */
const MIN_FLUSH_DELAY = 50;

/**
 * 续扫批次之间让出主线程：优先用空闲回调，不支持时退化为定时器。
 * 不需要取消 API——调用方用 scanToken 判定这一批是否已作废。
 */
function scheduleIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout: 1000 });
    return;
  }
  window.setTimeout(callback, 200);
}

/** 浮出提示卡宽度，用于定位 */
const TOAST_WIDTH = 268;

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  async main(ctx) {
    if (!document.body) return;

    /** iframe 内只做高亮和提示卡，不显示面板，避免同时出现多个面板 */
    const isTopFrame = window.top === window;

    let settings: Settings = await getSettings();
    let fingerprint = rulesFingerprint(settings);
    let siteActive = isSiteEnabled(settings, location.href);
    let panelHidden = false;
    let panelMounted = false;
    let truncated = false;
    /** 每次整页扫描自增，用于作废上一轮还没跑完的续扫批次 */
    let scanToken = 0;
    let ruleErrors: string[] = [];
    let cursor = -1;
    let observer: MutationObserver | null = null;
    let flushTimer: number | undefined;
    let toastTimer: number | undefined;
    const pendingNodes = new Set<Node>();

    const highlighter = new Highlighter();

    // ── 面板（Shadow DOM 隔离）─────────────────────────────────────────────
    const ui = await createShadowRootUi(ctx, {
      name: 'kwa-panel',
      position: 'overlay',
      alignment: 'top-right',
      anchor: 'body',
      zIndex: 2147483600,
      onMount(container) {
        const app = createApp(AuditPanel);
        app.mount(container);
        return app;
      },
      onRemove(app) {
        app?.unmount();
      },
    });

    function isActive(): boolean {
      // 排除 iframe：在嵌入的子框架内不激活审查（仍可在顶层页面运行）
      const frameAllowed = isTopFrame || !settings.skipIframes;
      return settings.enabled && siteActive && frameAllowed;
    }

    /** UI 容器在生效期间保持挂载（浮出提示卡需要），卡片是否显示由 panelState.visible 控制 */
    function syncPanel(): void {
      panelState.visible = isTopFrame && settings.panel.show && !panelHidden;
      const shouldMount = isActive();
      if (shouldMount && !panelMounted) {
        ui.mount();
        panelMounted = true;
      } else if (!shouldMount && panelMounted) {
        ui.remove();
        panelMounted = false;
      }
    }

    // ── 扫描与统计 ────────────────────────────────────────────────────────
    function syncStats(): void {
      panelState.active = isActive();
      panelState.stats = highlighter.stats(settings, location.href, truncated, ruleErrors);
      panelState.verdict = computeVerdict(panelState.stats);
      panelState.cursorTotal = highlighter.visibleCount(panelState.activeLevelIds);
      if (panelState.cursorTotal === 0) cursor = -1;
      panelState.cursor = cursor < 0 ? 0 : Math.min(cursor + 1, panelState.cursorTotal);
      reportStats();
    }

    function reportStats(): void {
      browser.runtime
        .sendMessage({ type: MSG.STATS, stats: panelState.stats })
        .catch(() => {
          /* 没有接收方（如后台未就绪）时忽略 */
        });
    }

    function rescan(): void {
      highlighter.clear();
      scanToken += 1;
      const rules = compileRules(settings);
      highlighter.setRules(rules);
      highlighter.setIgnoreHidden(settings.ignoreHidden);
      ruleErrors = rules?.errors ?? [];
      truncated = false;
      cursor = -1;
      const result = highlighter.startFullScan(
        document.body,
        settings.limits.maxNodes,
        settings.viewportOnly,
      );
      truncated = result.truncated;
      highlighter.applyLevelFilter(panelState.activeLevelIds);
      syncStats();
      if (truncated) scheduleContinuation(scanToken);
    }

    /**
     * 触达单批节点上限时，在空闲时间把剩余节点接着扫完，避免长页面被静默截断。
     * 新一轮扫描（scanToken 变化）、页面失活或已扫完时自动停止。
     */
    function scheduleContinuation(token: number): void {
      scheduleIdle(() => {
        if (token !== scanToken || !truncated || !isActive()) return;
        const skippedBefore = highlighter.skippedCount;
        const result = highlighter.continueScan(settings.limits.maxNodes, settings.viewportOnly);
        truncated = result.truncated;
        if (result.added > 0) highlighter.applyLevelFilter(panelState.activeLevelIds);
        if (result.added > 0 || highlighter.skippedCount !== skippedBefore || !truncated) {
          syncStats();
        }
        // processed 为 0 说明已经没有剩余节点，避免空转
        if (truncated && result.processed > 0) scheduleContinuation(token);
      });
    }

    // ── 动态内容 ──────────────────────────────────────────────────────────
    function isOwnNode(node: Node): boolean {
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (!element) return false;
      if (element.tagName === 'KWA-PANEL') return true;
      return element.closest('[data-kwa-mark], kwa-panel') !== null;
    }

    function flushPending(): void {
      flushTimer = undefined;
      if (!isActive()) {
        pendingNodes.clear();
        return;
      }
      const skippedBefore = highlighter.skippedCount;
      let touched = false;
      for (const node of pendingNodes) {
        if (!node.isConnected || isOwnNode(node)) continue;
        const result = highlighter.scan(node, settings.limits.maxNodes, settings.viewportOnly);
        if (result.truncated) truncated = true;
        if (result.added > 0) touched = true;
      }
      pendingNodes.clear();
      // 跳过的隐藏命中也要刷新面板，否则「未计入」的提示不会出现
      if (touched || truncated || highlighter.skippedCount !== skippedBefore) syncStats();
    }

    function scheduleFlush(): void {
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      const delay = Math.max(settings.limits.flushDelay, MIN_FLUSH_DELAY);
      flushTimer = window.setTimeout(flushPending, delay);
    }

    function startObserver(): void {
      if (observer) return;
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => pendingNodes.add(node));
        }
        if (pendingNodes.size > 0) scheduleFlush();
      });
      observer.observe(document.body!, { childList: true, subtree: true });
    }

    function stopObserver(): void {
      observer?.disconnect();
      observer = null;
      pendingNodes.clear();
      if (flushTimer !== undefined) {
        window.clearTimeout(flushTimer);
        flushTimer = undefined;
      }
    }

    // ── 定位跳转 ──────────────────────────────────────────────────────────
    /** cursor 为 -1 表示「尚未定位」，此时面板显示 0 / 总数 */
    function updateCursor(): void {
      const total = highlighter.visibleCount(panelState.activeLevelIds);
      panelState.cursorTotal = total;
      if (total === 0) {
        cursor = -1;
        panelState.cursor = 0;
        return;
      }
      if (cursor >= total) cursor = total - 1;
      panelState.cursor = cursor + 1;
    }

    function goto(direction: GotoDirection): void {
      const total = highlighter.visibleCount(panelState.activeLevelIds);
      panelState.cursorTotal = total;
      if (total === 0) return;

      if (direction === 'first') cursor = 0;
      // 首次点击「下一条」应落在第一个命中，而不是跳过它
      else if (direction === 'next') cursor = cursor < 0 ? 0 : (cursor + 1) % total;
      else cursor = cursor <= 0 ? total - 1 : cursor - 1;

      if (!highlighter.focus(cursor, panelState.activeLevelIds)) {
        console.debug('[合规审查助手] 没有可跳转的命中项');
      }
      updateCursor();
    }

    function toggleLevel(levelId: string): void {
      const current = panelState.activeLevelIds;
      const allLevelIds = settings.levels.map((level) => level.id);
      let next: string[];
      if (current.length === 0) {
        next = [levelId];
      } else if (current.includes(levelId)) {
        next = current.filter((id) => id !== levelId);
      } else {
        next = [...current, levelId];
        if (next.length >= allLevelIds.length) next = [];
      }
      panelState.activeLevelIds = next;
      highlighter.applyLevelFilter(next);
      cursor = -1;
      updateCursor();
    }

    function focusGroup(groupId: string): void {
      const index = highlighter.indexOfGroup(groupId, panelState.activeLevelIds);
      if (index < 0) return;
      cursor = index;
      highlighter.focus(index, panelState.activeLevelIds);
      updateCursor();
    }

    function focusHit(keyword: string, groupId: string): void {
      const index = highlighter.indexOfHit(keyword, groupId, panelState.activeLevelIds);
      if (index < 0) return;
      cursor = index;
      highlighter.focus(index, panelState.activeLevelIds);
      updateCursor();
    }

    async function copyReport(): Promise<void> {
      const verdict = panelState.verdict ?? computeVerdict(panelState.stats);
      const ok = await copyText(buildReportText(settings, panelState.stats, verdict));
      panelState.copyState = ok ? 'ok' : 'fail';
      window.setTimeout(() => {
        panelState.copyState = '';
      }, 2200);
      if (ok) dismissToast();
    }

    function dismissToast(): void {
      panelState.toast.visible = false;
      if (toastTimer !== undefined) {
        window.clearTimeout(toastTimer);
        toastTimer = undefined;
      }
    }

    Object.assign(panelActions, {
      goto,
      rescan,
      toggleLevel,
      focusGroup,
      focusHit,
      copyReport,
      dismissToast,
      toggleCollapse() {
        panelState.collapsed = !panelState.collapsed;
      },
      hide() {
        panelHidden = true;
        dismissToast();
        syncPanel();
      },
    });

    // ── 命中项交互 ────────────────────────────────────────────────────────
    ctx.addEventListener(
      document,
      'mouseover',
      (event) => {
        const mark = (event.target as HTMLElement | null)?.closest?.(
          '[data-kwa-mark]',
        ) as HTMLElement | null;
        if (!mark) return;
        const level = settings.levels.find((item) => item.id === mark.dataset.kwaLevel);
        showTip(
          mark,
          mark.dataset.kwaKeyword ?? mark.textContent ?? '',
          level?.name ?? '',
          level?.color ?? '#64748b',
        );
      },
      true,
    );

    ctx.addEventListener(document, 'mouseout', () => hideTip(), true);
    ctx.addEventListener(
      document,
      'click',
      (event) => {
        const mark = (event.target as HTMLElement | null)?.closest?.(
          '[data-kwa-mark]',
        ) as HTMLElement | null;
        if (!mark) return;
        const index = highlighter.indexOf(mark, panelState.activeLevelIds);
        if (index < 0) return;
        cursor = index;
        updateCursor();
      },
      true,
    );

    // 页面滚动时气泡位置会失效，直接收起
    ctx.addEventListener(window, 'scroll', () => hideTip(), true);

    // 视口懒扫描：滚动 / 缩放时用 rAF 节流补扫进入视口的节点
    let vpScheduled = false;
    function scheduleViewportScan(): void {
      if (vpScheduled) return;
      vpScheduled = true;
      requestAnimationFrame(() => {
        vpScheduled = false;
        if (settings.viewportOnly && settings.scanMode === 'auto' && isActive()) {
          if (highlighter.scanViewport() > 0) syncStats();
        }
      });
    }
    ctx.addEventListener(window, 'scroll', scheduleViewportScan, true);
    ctx.addEventListener(window, 'resize', scheduleViewportScan, true);

    // ── 点击发布/驳回类按钮时的提示卡（只提示，不阻止原操作）──────────────
    function showTriggerToast(anchor: HTMLElement): void {
      const verdict = panelState.verdict;
      if (!verdict || panelState.stats.total === 0) return;

      const hits = panelState.stats.hits;
      const lines = hits
        .slice(0, 5)
        .map(
          (hit) =>
            `${hit.groupName} · ${hit.keyword}${hit.clause ? `（依据 ${hit.clause}）` : ''}`,
        );
      if (hits.length > 5) lines.push(`…另有 ${hits.length - 5} 类问题`);

      const rect = anchor.getBoundingClientRect();
      const x = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - TOAST_WIDTH - 8),
      );
      const estimatedHeight = 130 + lines.length * 22;
      const below = rect.bottom + 8;
      const y =
        below + estimatedHeight <= window.innerHeight
          ? below
          : Math.max(8, rect.top - estimatedHeight - 8);

      panelState.toast = {
        visible: true,
        x,
        y,
        title: `${verdict.title}（命中 ${panelState.stats.total} 处）`,
        lines,
      };

      if (toastTimer !== undefined) window.clearTimeout(toastTimer);
      if (settings.trigger.duration > 0) {
        toastTimer = window.setTimeout(() => {
          panelState.toast.visible = false;
        }, settings.trigger.duration);
      }
    }

    function onPossibleTrigger(event: Event): void {
      if (!settings.trigger.enabled || !isActive()) return;
      const target = event.target as HTMLElement | null;
      const button = target?.closest?.(
        'button, [role="button"], a, input[type="submit"], input[type="button"]',
      ) as HTMLElement | null;
      if (!button) return;

      const text =
        (button.textContent ?? '').trim() || (button as HTMLInputElement).value || '';
      if (!text) return;
      if (!settings.trigger.buttonTexts.some((item) => text.includes(item))) return;

      // 刻意不调用 preventDefault：仅提示，不干预平台操作
      showTriggerToast(button);
    }

    ctx.addEventListener(document, 'click', (event) => onPossibleTrigger(event), true);

    // ── 应用设置 ──────────────────────────────────────────────────────────
    function applySettings(next: Settings, forceRescan = false): void {
      const rulesChanged = forceRescan || rulesFingerprint(next) !== fingerprint;
      const viewportChanged = next.viewportOnly !== settings.viewportOnly;
      settings = next;
      fingerprint = rulesFingerprint(next);
      siteActive = isSiteEnabled(settings, location.href);
      panelState.collapsed = settings.panel.collapsed;
      panelState.corner = settings.panel.corner;
      applyPageStyles(settings);
      syncPanel();

      if (!isActive()) {
        highlighter.clear();
        stopObserver();
        syncStats();
        return;
      }

      // 视口懒扫描开关变化时需重新扫描：开启只扫可见区、其余入队；
      // 关闭则把之前跳过的节点一次性补扫出来
      if (viewportChanged) {
        if (next.viewportOnly) rescan();
        else {
          highlighter.flushViewportAll();
          syncStats();
        }
        if (settings.scanMode === 'auto' && settings.dynamic) startObserver();
        else stopObserver();
        return;
      }

      if (rulesChanged) {
        // 仅手动模式：不在规则变更时自动扫描，等用户点「重扫」
        if (settings.scanMode === 'auto') rescan();
        else {
          highlighter.clear();
          scanToken += 1;
          syncStats();
        }
      } else {
        highlighter.applyLevelFilter(panelState.activeLevelIds);
        syncStats();
      }

      // 仅手动模式不启用动态监听，避免自动跟踪 DOM 变化
      if (settings.scanMode === 'auto' && settings.dynamic) startObserver();
      else stopObserver();
    }

    // 设置变更（popup / 右键加词）即时生效
    const unwatch = settingsStorage().watch((newValue) => {
      applySettings(normalizeSettings(newValue));
    });
    ctx.onInvalidated(unwatch);

    // popup 消息
    // 注意：wxt 的 browser 在 Chrome 上是原生 chrome API，onMessage 监听器
    // 「返回 Promise」不会把结果回传给 popup（会以「端口关闭」reject），
    // 必须用 sendResponse 显式回传；下面的处理都是同步的，直接同步响应即可。
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      // 面板与统计只归顶层 frame：子框架不应答，避免抢答导致 popup 拿到 iframe 的空统计
      if (!isTopFrame) return;
      if (!message || typeof message !== 'object') return;
      const type = (message as ContentMessage | FrameStatsMessage).type;
      switch (type) {
        case MSG.FRAME_STATS:
          // 后台推送的跨 frame 汇总：用于提示「另有 N 处在 iframe 内」
          panelState.frames = (message as FrameStatsMessage).summary;
          // 显式应答，否则后台那边的 sendMessage 会以「端口提前关闭」告终
          sendResponse(null);
          return;
        case MSG.GET_STATS:
          break;
        case MSG.RESCAN:
          rescan();
          break;
        case MSG.GOTO:
          goto((message as GotoMessage).direction);
          break;
        default:
          return;
      }
      sendResponse(panelState.stats);
    });

    applySettings(settings, true);
  },
});
