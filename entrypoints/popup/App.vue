<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import GroupList from '@/components/popup/GroupList.vue';
import LevelList from '@/components/popup/LevelList.vue';
import { MSG, type ContentMessage, type TabStatsSummary } from '@/utils/messages';
import { uid } from '@/utils/id';
import { createDefaultSettings, getSettings, matchSite, normalizeSettings, settingsStorage } from '@/utils/settings';
import type { Settings, StatsSnapshot } from '@/utils/types';

type TabKey = 'words' | 'rules' | 'sites';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'words', label: '词库' },
  { key: 'rules', label: '规则' },
  { key: 'sites', label: '站点' },
];

const settings = ref<Settings>(createDefaultSettings());
const loading = ref(true);
const activeTab = ref<TabKey>('words');
const pageUrl = ref('');
const pageStats = ref<StatsSnapshot | null>(null);
const pageTip = ref('正在读取当前页面…');
/** 跨 frame 汇总：后台按 tab 汇总，与扩展角标同一数据源 */
const framesSummary = ref<TabStatsSummary | null>(null);
const sitesText = ref('');
const excludedText = ref('');
const triggerText = ref('');

let internalUpdate = false;
let saveTimer: number | undefined;

/** 在普通页面预览时可以只渲染界面，不做任何扩展 API 调用 */
const isExtension = typeof browser !== 'undefined' && !!browser?.runtime?.id;

const host = computed(() => {
  try {
    return new URL(pageUrl.value).hostname;
  } catch {
    return '';
  }
});

/** 当前页命中按档位的占比，用于统计卡的分布条 */
const levelBars = computed(() => {
  const items = (pageStats.value?.levels ?? []).filter((level) => level.count > 0);
  const total = items.reduce((sum, level) => sum + level.count, 0) || 1;
  return items.map((level) => ({
    id: level.id,
    name: level.name,
    color: level.color,
    count: level.count,
    percent: Math.max((level.count / total) * 100, 4),
  }));
});

onMounted(async () => {
  if (!isExtension) {
    settings.value = createDefaultSettings();
    sitesText.value = settings.value.sites.join('\n');
    excludedText.value = settings.value.excludedSites.join('\n');
    triggerText.value = settings.value.trigger.buttonTexts.join('\n');
    loading.value = false;
    pageTip.value = '预览模式：未连接扩展环境';
    return;
  }

  settings.value = await getSettings();
  sitesText.value = settings.value.sites.join('\n');
  excludedText.value = settings.value.excludedSites.join('\n');
  triggerText.value = settings.value.trigger.buttonTexts.join('\n');
  loading.value = false;

  settingsStorage().watch((value) => {
    internalUpdate = true;
    settings.value = normalizeSettings(value);
    sitesText.value = settings.value.sites.join('\n');
    excludedText.value = settings.value.excludedSites.join('\n');
    triggerText.value = settings.value.trigger.buttonTexts.join('\n');
    void Promise.resolve().then(() => {
      internalUpdate = false;
    });
  });

  await refreshPageStats();
});

// 设置即时生效：本地改动防抖落盘，content script 通过 storage.watch 实时响应
watch(
  settings,
  () => {
    if (!isExtension || loading.value || internalUpdate) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void settingsStorage().setValue(normalizeSettings(settings.value));
    }, 250);
  },
  { deep: true },
);

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToPage(message: ContentMessage): Promise<StatsSnapshot | null> {
  if (!isExtension) return null;
  const tab = await getActiveTab();
  pageUrl.value = tab?.url ?? '';
  if (tab?.id == null) return null;
  // 只找顶层 frame（frameId 0）：content script 在所有 frame 都注入，
  // 不指定 frameId 时 Chrome 会把消息发遍所有 frame 并返回「最先应答」的那个，
  // 可能拿到某个 iframe 的空统计，导致与页面内面板不一致。
  const stats = await browser.tabs.sendMessage(tab.id, message, { frameId: 0 });
  return (stats as StatsSnapshot | undefined) ?? null;
}

/**
 * iframe 内的命中不在顶层 frame 的统计里，单独向后台查一次汇总，
 * 让弹窗与扩展角标对同一份数字给出一致的解释。
 */
async function refreshFrameSummary(): Promise<void> {
  if (!isExtension) return;
  try {
    const tab = await getActiveTab();
    if (tab?.id == null) {
      framesSummary.value = null;
      return;
    }
    framesSummary.value = (await browser.runtime.sendMessage({
      type: MSG.TAB_STATS,
      tabId: tab.id,
    })) as TabStatsSummary | null;
  } catch {
    framesSummary.value = null;
  }
}

async function refreshPageStats(): Promise<void> {
  try {
    const stats = await sendToPage({ type: MSG.GET_STATS });
    pageStats.value = stats;
    pageTip.value = stats ? '当前页未命中关键词' : '当前页面未启用或未注入脚本';
  } catch {
    pageStats.value = null;
    pageTip.value = '当前页面不支持（非普通网页或未注入）';
  }
  await refreshFrameSummary();
}

async function rescanPage(): Promise<void> {
  try {
    pageStats.value = await sendToPage({ type: MSG.RESCAN });
    pageTip.value = '';
  } catch {
    pageTip.value = '重新扫描失败';
  }
  await refreshFrameSummary();
}

function addGroup(): void {
  const levelId = settings.value.levels[0]?.id ?? '';
  settings.value.groups = [
    ...settings.value.groups,
    { id: uid('g'), name: `分组 ${settings.value.groups.length + 1}`, levelId, enabled: true, keywords: [] },
  ];
}

function removeGroup(id: string): void {
  settings.value.groups = settings.value.groups.filter((group) => group.id !== id);
}

function removeLevel(id: string): void {
  if (settings.value.levels.length <= 1) return;
  const fallback = settings.value.levels.find((level) => level.id !== id);
  if (!fallback) return;
  const affected = settings.value.groups.filter((group) => group.levelId === id);
  if (affected.length > 0) {
    const ok = window.confirm(
      `该档位下有 ${affected.length} 个分组，删除后这些分组会迁移到「${fallback.name}」。继续删除？`,
    );
    if (!ok) return;
  }
  settings.value.levels = settings.value.levels.filter((level) => level.id !== id);
  settings.value.groups = settings.value.groups.map((group) =>
    group.levelId === id ? { ...group, levelId: fallback.id } : group,
  );
}

function commitSites(): void {
  settings.value.sites = sitesText.value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function commitExcluded(): void {
  settings.value.excludedSites = excludedText.value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 当前页是否已落在对应清单里（按域名匹配，含子域名通配） */
const currentInSites = computed(() =>
  !!host.value && settings.value.sites.some((site) => matchSite(site, host.value)),
);
const currentInExcluded = computed(() =>
  !!host.value && settings.value.excludedSites.some((site) => matchSite(site, host.value)),
);

/** 把当前页加入生效清单（include 模式） */
function addCurrentToSites(): void {
  if (!host.value || currentInSites.value) return;
  settings.value.sites = [...settings.value.sites, host.value];
  sitesText.value = settings.value.sites.join('\n');
}

/** 把当前页加入排除清单（exclude 模式） */
function addCurrentToExcluded(): void {
  if (!host.value || currentInExcluded.value) return;
  settings.value.excludedSites = [...settings.value.excludedSites, host.value];
  excludedText.value = settings.value.excludedSites.join('\n');
}

/** 从排除清单移除当前页 */
function removeCurrentFromExcluded(): void {
  if (!host.value) return;
  settings.value.excludedSites = settings.value.excludedSites.filter(
    (site) => !matchSite(site, host.value),
  );
  excludedText.value = settings.value.excludedSites.join('\n');
}

/** 全部站点模式下，直接切到排除模式并把当前页加进去 */
function excludeCurrent(): void {
  if (!host.value) return;
  settings.value.siteMode = 'exclude';
  if (!currentInExcluded.value) addCurrentToExcluded();
}

function commitTriggerText(): void {
  const texts = triggerText.value
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  settings.value.trigger.buttonTexts = texts.length > 0 ? texts : ['发布', '驳回', '通过'];
}

</script>

<template>
  <div class="kw-app">
    <header class="kw-header">
      <div class="kw-brand">
        <div class="kw-brand-text">
          <div class="kw-brand-title">合规审查助手</div>
          <div class="kw-brand-sub">{{ host || '未识别页面' }}</div>
        </div>
      </div>
      <label class="kw-switch" :title="settings.enabled ? '已启用' : '已停用'">
        <input v-model="settings.enabled" type="checkbox" />
        <span class="kw-slider" />
      </label>
    </header>

    <section class="kw-page-card">
      <div class="kw-page-stats">
        <template v-if="levelBars.length > 0">
          <div class="kw-page-main">
            <span class="kw-page-total">{{ pageStats?.total ?? 0 }}</span>
            <span class="kw-page-label">处命中</span>
          </div>
          <div class="kw-bars">
            <i
              v-for="bar in levelBars"
              :key="bar.id"
              :style="{ width: `${bar.percent}%`, background: bar.color }"
            />
          </div>
          <div class="kw-chips">
            <span v-for="bar in levelBars" :key="bar.id" class="kw-chip">
              <i :style="{ background: bar.color }" />{{ bar.name }} {{ bar.count }}
            </span>
          </div>
        </template>
        <span v-else class="kw-page-empty">{{ pageTip }}</span>
        <p v-if="framesSummary && framesSummary.otherTotal > 0" class="kw-iframe-note">
          iframe 内另有 {{ framesSummary.otherTotal }} 处命中（角标已计入）
        </p>
      </div>
      <button class="kw-mini" type="button" @click="rescanPage()">重扫</button>
    </section>

    <nav class="kw-tabs">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="kw-tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <main v-if="!loading" class="kw-body">
      <template v-if="activeTab === 'words'">
        <h3 class="kw-section">关键词分组</h3>
        <GroupList v-model="settings.groups" :levels="settings.levels" @remove="removeGroup" />
        <button class="kw-add" type="button" @click="addGroup()">+ 新增分组</button>
      </template>

      <template v-else-if="activeTab === 'rules'">
        <h3 class="kw-section">处置档位</h3>
        <LevelList v-model="settings.levels" @remove="removeLevel" />

        <h3 class="kw-section">匹配方式</h3>
        <label class="kw-row">
          <input v-model="settings.match.caseSensitive" type="checkbox" />
          区分大小写
        </label>
        <label class="kw-row">
          <input v-model="settings.match.wholeWord" type="checkbox" />
          整词匹配（不命中词的一部分）
        </label>
        <label class="kw-row">
          <input v-model="settings.match.useRegex" type="checkbox" />
          关键词按正则解释
        </label>
        <label class="kw-row">
          <input v-model="settings.match.chineseWord" type="checkbox" />
          中文整词（按分词判断，避免跨词误命中）
        </label>
        <label class="kw-row">
          <input v-model="settings.match.englishWord" type="checkbox" />
          英文整词（按分词判断，避免英文/数字 跨词误命中）
        </label>

        <h3 class="kw-section">显示</h3>
        <label class="kw-row">
          <input v-model="settings.panel.show" type="checkbox" />
          页面内显示审查面板
        </label>
        <div class="kw-field">
          <span>面板位置</span>
          <select v-model="settings.panel.corner">
            <option value="top-right">右上角</option>
            <option value="bottom-right">右下角</option>
          </select>
        </div>

        <h3 class="kw-section">按钮提示</h3>
        <label class="kw-row">
          <input v-model="settings.trigger.enabled" type="checkbox" />
          点击发布 / 驳回类按钮时浮出提示卡（不阻止原操作）
        </label>
        <textarea
          v-model="triggerText"
          class="kw-textarea"
          rows="2"
          spellcheck="false"
          placeholder="需要监听的按钮文案，逗号或换行分隔"
          @change="commitTriggerText"
          @blur="commitTriggerText"
        />
        <div class="kw-field">
          <span>自动消失（毫秒，0 为不消失）</span>
          <input v-model.number="settings.trigger.duration" type="number" min="0" step="1000" />
        </div>
        <p class="kw-tip">仅在命中关键词时提示，且不会拦截或代替你操作平台。</p>
      </template>

      <template v-else>
        <h3 class="kw-section">生效范围</h3>
        <label class="kw-row">
          <input v-model="settings.siteMode" type="radio" value="all" />
          全部站点
        </label>
        <label class="kw-row">
          <input v-model="settings.siteMode" type="radio" value="include" />
          仅指定站点
        </label>
        <template v-if="settings.siteMode === 'include'">
          <textarea
            v-model="sitesText"
            class="kw-textarea"
            rows="6"
            spellcheck="false"
            placeholder="每行一个域名，支持 *.example.com"
            @change="commitSites"
            @blur="commitSites"
          />
          <p class="kw-tip">示例：audit.example.com、*.corp.com</p>
        </template>
        <label class="kw-row">
          <input v-model="settings.siteMode" type="radio" value="exclude" />
          除以下站点外
        </label>
        <template v-if="settings.siteMode === 'exclude'">
          <textarea
            v-model="excludedText"
            class="kw-textarea"
            rows="6"
            spellcheck="false"
            placeholder="每行一个域名，支持 *.example.com"
            @change="commitExcluded"
            @blur="commitExcluded"
          />
          <p class="kw-tip">其余站点照常审查；示例：bank.example.com、*.secure.com</p>
        </template>

        <div v-if="host" class="kw-current-site">
          <span class="kw-current-host">{{ host }}</span>
          <button
            v-if="settings.siteMode === 'include'"
            class="kw-mini"
            type="button"
            :disabled="currentInSites"
            @click="addCurrentToSites"
          >{{ currentInSites ? '已在生效列表' : '+ 加入生效列表' }}</button>
          <template v-else-if="settings.siteMode === 'exclude'">
            <button v-if="!currentInExcluded" class="kw-mini" type="button" @click="addCurrentToExcluded">+ 加入排除列表</button>
            <button v-else class="kw-mini" type="button" @click="removeCurrentFromExcluded">恢复当前页</button>
          </template>
          <button v-else class="kw-mini" type="button" @click="excludeCurrent">排除当前页</button>
        </div>
        <p class="kw-tip">
          当前页：{{ pageStats ? `${pageStats.total} 处命中` : pageTip }}
        </p>

        <h3 class="kw-section">性能</h3>
        <div class="kw-field">
          <span>扫描模式</span>
          <select v-model="settings.scanMode">
            <option value="auto">实时（含动态监听）</option>
            <option value="manual">仅手动（点「重扫」才扫）</option>
          </select>
        </div>
        <label class="kw-row">
          <input v-model="settings.dynamic" type="checkbox" />
          监听动态内容（分页、懒加载）
        </label>
        <label class="kw-row">
          <input v-model="settings.skipIframes" type="checkbox" />
          排除 iframe（不在子框架内审查）
        </label>
        <label class="kw-row">
          <input v-model="settings.viewportOnly" type="checkbox" />
          视口懒扫描（只扫可见区，滚动再扫其余）
        </label>
        <label class="kw-row">
          <input v-model="settings.ignoreHidden" type="checkbox" />
          忽略隐藏内容（display:none 等不计入结果）
        </label>
        <div class="kw-field">
          <span>每批扫描上限</span>
          <input v-model.number="settings.limits.maxNodes" type="number" min="1000" step="1000" />
        </div>
        <div class="kw-field">
          <span>增量扫描防抖（毫秒）</span>
          <input v-model.number="settings.limits.flushDelay" type="number" min="50" step="50" />
        </div>
        <p class="kw-tip">触达每批上限会自动分批续扫，不会漏扫；超重型页面卡顿时：切「仅手动」、调高防抖、或排除 iframe。</p>
      </template>
    </main>
    <main v-else class="kw-body">
      <p class="kw-empty">正在加载设置…</p>
    </main>

    <footer class="kw-footer">修改即时生效，无需重载页面</footer>
  </div>
</template>
