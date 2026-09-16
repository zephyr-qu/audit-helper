<script lang="ts" setup>
import { computed } from 'vue';
import { panelActions, panelState } from '@/utils/panel-state';
import { ACTION_LABEL } from '@/utils/types';
import { VERDICT_STYLE, type VerdictLevel } from '@/utils/verdict';

const stats = computed(() => panelState.stats);
const levels = computed(() => stats.value.levels.filter((level) => level.count > 0));
const hits = computed(() => stats.value.hits);
const verdict = computed(() => panelState.verdict);
const toast = computed(() => panelState.toast);
const hasFilter = computed(() => panelState.activeLevelIds.length > 0);

const verdictStyle = computed(() =>
  verdict.value ? VERDICT_STYLE[verdict.value.level] : VERDICT_STYLE.clean,
);

/** 结论图标（内联 SVG，替代 emoji，跨平台一致） */
const ICON_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const VERDICT_ICONS: Record<VerdictLevel, string> = {
  reject: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6 18.4 18.4"/></svg>`,
  revise: `<svg ${ICON_ATTRS}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  verify: `<svg ${ICON_ATTRS}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  qualify: `<svg ${ICON_ATTRS}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`,
  warn: `<svg ${ICON_ATTRS}><path d="M12 3.5 21 20H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>`,
  hint: `<svg ${ICON_ATTRS}><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1.1 2h4.8c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/></svg>`,
  clean: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/></svg>`,
  limited: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><path d="M12 7.5h.01"/><path d="M11 11h1v6h1"/></svg>`,
};

const verdictIcon = computed(() => VERDICT_ICONS[verdict.value?.level ?? 'clean']);
const toastIcon = computed(() => VERDICT_ICONS[panelState.verdict?.level ?? 'clean']);
const toastColor = computed(() =>
  panelState.verdict ? VERDICT_STYLE[panelState.verdict.level].color : VERDICT_STYLE.clean.color,
);

const toastStyle = computed(() => ({
  left: `${toast.value.x}px`,
  top: `${toast.value.y}px`,
}));

function isLevelOn(levelId: string): boolean {
  return !hasFilter.value || panelState.activeLevelIds.includes(levelId);
}

function levelColor(levelId: string): string {
  return stats.value.levels.find((level) => level.id === levelId)?.color ?? '#94a3b8';
}

function hitTitle(keyword: string, groupName: string, advice?: string, clause?: string): string {
  const parts = [`${groupName} · ${keyword}`];
  if (clause) parts.push(`依据 ${clause}`);
  if (advice) parts.push(`建议：${advice}`);
  return parts.join('\n');
}
</script>

<template>
  <div class="kwa-root" :class="panelState.corner">
    <!-- 点击发布/驳回类按钮时浮出的提示卡：只提示，不阻止原操作 -->
    <div v-if="toast.visible" class="kwa-toast" :style="toastStyle">
      <div class="kwa-toast-head">
        <span class="kwa-toast-title">
          <span class="kwa-toast-icon" :style="{ color: toastColor }" v-html="toastIcon" />
          {{ toast.title }}
        </span>
        <button class="kwa-icon" type="button" title="关闭" @click="panelActions.dismissToast()">
          &times;
        </button>
      </div>
      <ul class="kwa-toast-list">
        <li v-for="(line, index) in toast.lines" :key="index">{{ line }}</li>
      </ul>
      <button class="kwa-toast-btn" type="button" @click="panelActions.copyReport()">
        复制审核意见
      </button>
    </div>

    <button
      v-if="panelState.visible && panelState.collapsed"
      class="kwa-fab"
      type="button"
      :title="`关键字审查：命中 ${stats.total} 处，点击展开`"
      @click="panelActions.toggleCollapse()"
    >
      {{ stats.total }}
    </button>

    <section v-else-if="panelState.visible" class="kwa-card">
      <header class="kwa-head">
        <span class="kwa-title">合规审查</span>
        <span class="kwa-head-actions">
          <button class="kwa-icon" type="button" title="折叠" @click="panelActions.toggleCollapse()">
            &minus;
          </button>
          <button class="kwa-icon" type="button" title="关闭（本页）" @click="panelActions.hide()">
            &times;
          </button>
        </span>
      </header>

      <div v-if="!panelState.active" class="kwa-hint">当前站点未启用合规审查</div>

      <template v-else>
        <div
          v-if="verdict"
          class="kwa-verdict"
          :style="{ '--kwa-verdict-color': verdictStyle.color }"
        >
          <span class="kwa-verdict-icon" :style="{ color: verdictStyle.color }" v-html="verdictIcon" />
          <span class="kwa-verdict-text">
            <span class="kwa-verdict-title">{{ verdict.title }}</span>
            <span class="kwa-verdict-detail">{{ verdict.detail }}</span>
          </span>
        </div>

        <div class="kwa-total">
          <span class="kwa-total-num">{{ stats.total }}</span>
          <span class="kwa-total-label">处命中</span>
          <span v-if="panelState.cursorTotal > 0" class="kwa-cursor">
            {{ panelState.cursor }} / {{ panelState.cursorTotal }}
          </span>
        </div>

        <div v-if="levels.length" class="kwa-levels">
          <button
            v-for="level in levels"
            :key="level.id"
            class="kwa-level"
            :class="{ off: !isLevelOn(level.id), on: hasFilter && isLevelOn(level.id) }"
            :style="{ '--kwa-level-color': level.color }"
            type="button"
            :title="`${ACTION_LABEL[level.action]} · ${hasFilter && isLevelOn(level.id) ? '取消该档位过滤' : '只看该档位'}`"
            @click="panelActions.toggleLevel(level.id)"
          >
            <i class="kwa-dot" :style="{ background: level.color }" />
            <span class="kwa-level-name">{{ level.name }}</span>
            <span class="kwa-level-count">{{ level.count }}</span>
          </button>
        </div>

        <ul v-if="hits.length" class="kwa-hits">
          <li
            v-for="hit in hits"
            :key="hit.groupId + hit.keyword"
            class="kwa-hit"
            :title="hitTitle(hit.sample || hit.keyword, hit.groupName, hit.advice, hit.clause)"
            @click="panelActions.focusHit(hit.keyword, hit.groupId)"
          >
            <i class="kwa-hit-dot" :style="{ background: levelColor(hit.levelId) }" />
            <span class="kwa-hit-keyword">{{ hit.sample || hit.keyword }}</span>
            <span v-if="hit.count > 1" class="kwa-hit-count">×{{ hit.count }}</span>
            <span class="kwa-hit-group">{{ hit.groupName }}</span>
            <span v-if="hit.clause" class="kwa-hit-clause">{{ hit.clause }}</span>
          </li>
        </ul>

        <p v-if="panelState.frames.otherTotal > 0" class="kwa-note">
          iframe 内另有 {{ panelState.frames.otherTotal }} 处命中（已计入扩展角标）
        </p>
        <p v-if="stats.hiddenSkipped > 0" class="kwa-note">
          另有 {{ stats.hiddenSkipped }} 处命中在隐藏内容里，未计入
        </p>
        <p v-if="stats.truncated" class="kwa-warn">页面内容过多，扫描未跑完，结果可能不完整</p>
        <p v-if="stats.ruleErrors.length" class="kwa-warn">
          {{ stats.ruleErrors.length }} 条规则无法编译，请检查正则写法
        </p>

        <footer class="kwa-foot">
          <button class="kwa-btn ghost" type="button" title="上一条" @click="panelActions.goto('prev')">
            ↑
          </button>
          <button class="kwa-btn ghost" type="button" title="下一条" @click="panelActions.goto('next')">
            ↓
          </button>
          <button class="kwa-btn" type="button" @click="panelActions.rescan()">重新扫描</button>
          <button
            class="kwa-btn copy"
            type="button"
            title="复制审核意见"
            @click="panelActions.copyReport()"
          >
            {{ panelState.copyState === 'ok' ? '已复制' : panelState.copyState === 'fail' ? '复制失败' : '复制意见' }}
          </button>
        </footer>
      </template>
    </section>
  </div>
</template>

<style>
/* 颜色全部走变量，深/浅主题各自成套 */
.kwa-root {
  --kwa-fg: #f1f3f7;
  --kwa-fg-2: #cbd2dc;
  --kwa-fg-3: #aab2c0;
  --kwa-bg: #191c22;
  --kwa-border: rgba(148, 163, 184, 0.26);
  --kwa-hover: rgba(148, 163, 184, 0.16);
  --kwa-chip: rgba(148, 163, 184, 0.16);
  --kwa-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);

  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483600;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--kwa-fg);
  -webkit-font-smoothing: antialiased;
}

@media (prefers-color-scheme: light) {
  .kwa-root {
    --kwa-fg: #131722;
    --kwa-fg-2: #3d4453;
    --kwa-fg-3: #5c6472;
    --kwa-bg: #ffffff;
    --kwa-border: rgba(15, 23, 42, 0.14);
    --kwa-hover: rgba(15, 23, 42, 0.06);
    --kwa-chip: rgba(15, 23, 42, 0.06);
    --kwa-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  }
}

.kwa-root.bottom-right {
  top: auto;
  bottom: 16px;
}

.kwa-card {
  width: 258px;
  padding: 12px 13px 13px;
  border: 1px solid var(--kwa-border);
  border-radius: 10px;
  background: var(--kwa-bg);
  box-shadow: var(--kwa-shadow);
}

.kwa-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.kwa-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--kwa-fg-3);
}

.kwa-head-actions {
  display: flex;
  gap: 2px;
}

.kwa-icon {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--kwa-fg-3);
  font-size: 14px;
  line-height: 1;
  transition: color 0.15s ease, background 0.15s ease;
}

.kwa-icon:hover {
  color: var(--kwa-fg);
  background: var(--kwa-hover);
}

/* 结论卡 */
.kwa-verdict {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  margin-bottom: 10px;
  border: 1px solid color-mix(in srgb, var(--kwa-verdict-color) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--kwa-verdict-color) 12%, transparent);
}

.kwa-verdict-icon {
  display: inline-flex;
  flex: none;
  width: 15px;
  height: 15px;
  margin-top: 1px;
}

.kwa-verdict-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}

.kwa-verdict-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.kwa-verdict-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--kwa-verdict-color);
}

.kwa-verdict-detail {
  font-size: 11.5px;
  color: var(--kwa-fg-3);
}

.kwa-total {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 0 0 10px;
}

.kwa-total-num {
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
  color: var(--kwa-fg);
  font-variant-numeric: tabular-nums;
}

.kwa-total-label {
  font-size: 12px;
  color: var(--kwa-fg-3);
}

.kwa-cursor {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--kwa-chip);
  font-size: 12px;
  color: var(--kwa-fg-2);
  font-variant-numeric: tabular-nums;
}

.kwa-levels {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.kwa-level {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--kwa-fg);
  font-size: 12.5px;
  text-align: left;
  transition: background 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}

.kwa-level:hover {
  background: var(--kwa-hover);
}

/* 选中档位：左侧档位色条 + 同色淡底 + 名称加粗 + 尾部勾选，明显区别于未选中 */
.kwa-level.on {
  background: color-mix(in srgb, var(--kwa-level-color, var(--kwa-fg-3)) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--kwa-level-color, var(--kwa-fg-3));
}

.kwa-level.on:hover {
  background: color-mix(in srgb, var(--kwa-level-color, var(--kwa-fg-3)) 24%, transparent);
}

.kwa-level.on .kwa-level-name {
  font-weight: 700;
}

.kwa-level.on .kwa-level-count {
  color: var(--kwa-level-color, var(--kwa-fg-3));
}

.kwa-level.on::after {
  content: '✓';
  flex: none;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: var(--kwa-level-color, var(--kwa-fg-3));
}

.kwa-level.off {
  opacity: 0.45;
}

.kwa-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}

.kwa-level-name {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kwa-level-count {
  color: var(--kwa-fg-3);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* 问题清单 */
.kwa-hits {
  max-height: 186px;
  margin: 8px 0 0;
  padding: 8px 0 0;
  overflow: auto;
  border-top: 1px solid var(--kwa-border);
  list-style: none;
}

.kwa-hit {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.kwa-hit:hover {
  background: var(--kwa-hover);
}

.kwa-hit-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
}

.kwa-hit-keyword {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kwa-hit-count {
  color: var(--kwa-fg-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.kwa-hit-group {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--kwa-fg-3);
}

.kwa-hit-clause {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--kwa-chip);
  font-size: 10.5px;
  color: var(--kwa-fg-3);
}

.kwa-note {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--kwa-fg-3);
}

.kwa-warn {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: #d9932b;
}

@media (prefers-color-scheme: light) {
  .kwa-warn {
    color: #a8640a;
  }
}

.kwa-hint {
  padding: 6px 0 2px;
  font-size: 12px;
  color: var(--kwa-fg-3);
}

.kwa-foot {
  display: flex;
  gap: 4px;
  margin-top: 10px;
}

.kwa-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid var(--kwa-border);
  border-radius: 6px;
  background: transparent;
  color: var(--kwa-fg);
  font-size: 12px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.kwa-btn:hover {
  background: var(--kwa-hover);
}

.kwa-btn.ghost {
  flex: 0 0 32px;
  font-size: 13px;
}

.kwa-btn.copy {
  flex: 0 0 72px;
  color: var(--kwa-fg-2);
}

.kwa-fab {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--kwa-border);
  border-radius: 999px;
  background: var(--kwa-bg);
  color: var(--kwa-fg);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--kwa-shadow);
  font-variant-numeric: tabular-nums;
}

.kwa-fab:hover {
  background: var(--kwa-hover);
}

/* 浮出提示卡 */
.kwa-toast {
  position: fixed;
  z-index: 2147483601;
  width: 268px;
  padding: 10px 12px 11px;
  border: 1px solid var(--kwa-border);
  border-radius: 10px;
  background: var(--kwa-bg);
  box-shadow: var(--kwa-shadow);
}

.kwa-toast-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.kwa-toast-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--kwa-fg);
}

.kwa-toast-icon {
  display: inline-flex;
  flex: none;
  width: 14px;
  height: 14px;
}

.kwa-toast-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}

.kwa-toast-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 132px;
  overflow: auto;
}

.kwa-toast-list li {
  padding: 2px 0;
  font-size: 12px;
  color: var(--kwa-fg-2);
}

.kwa-toast-btn {
  width: 100%;
  margin-top: 8px;
  padding: 6px 0;
  border: 1px solid var(--kwa-border);
  border-radius: 6px;
  background: transparent;
  color: var(--kwa-fg);
  font-size: 12px;
  cursor: pointer;
}

.kwa-toast-btn:hover {
  background: var(--kwa-hover);
}
</style>
