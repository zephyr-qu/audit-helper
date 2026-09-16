import { storage, type WxtStorageItem } from 'wxt/utils/storage';
import {
  LEGACY_SAMPLE_GROUP_IDS,
  PACK_LEVELS,
  applyCompliancePack,
  buildPackGroups,
  mergeCompliancePack,
} from './compliance-pack';
import { type LevelAction, type LevelStyle, type Settings } from './types';

export const SETTINGS_KEY = 'local:kw-settings' as const;

/** 新增档位时按顺序取用的预设色板 */
export const LEVEL_COLOR_PALETTE = [
  '#ef4444',
  '#f59e0b',
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#ec4899',
  '#14b8a6',
  '#64748b',
];

/**
 * 默认配置：档位与 6 种处置一一对应，词库直接就是 BOSS 合规规则包
 * （本扩展面向 BOSS 岗位审核，不需要额外导入步骤）
 */
export function createDefaultSettings(): Settings {
  return {
    enabled: true,
    siteMode: 'all',
    sites: [],
    excludedSites: [],
    levels: PACK_LEVELS.map((level) => ({ ...level, form: level.form ?? 'solid' })),
    groups: buildPackGroups(),
    match: {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      chineseWord: true,
      englishWord: true,
    },
    panel: { show: true, corner: 'top-right', collapsed: false },
    trigger: {
      enabled: true,
      buttonTexts: ['发布', '提交', '保存', '通过', '驳回', '确认发布'],
      duration: 8000,
    },
    dynamic: true,
    scanMode: 'auto',
    skipIframes: false,
    viewportOnly: false,
    ignoreHidden: true,
    limits: { maxNodes: 20000, flushDelay: 220 },
  };
}

let settingsItemCache: WxtStorageItem<Settings, Record<string, unknown>> | null = null;

/**
 * 惰性创建 storage item。
 *
 * `defineItem` 在定义时就会立刻读一次存储，若在普通网页里（IDE 预览 popup）
 * 于模块顶层调用，会抛出 "must be loaded in a web extension environment"。
 * 改为首次真正使用时再创建，扩展环境之外就不会产生这个报错。
 */
export function settingsStorage(): WxtStorageItem<Settings, Record<string, unknown>> {
  if (!settingsItemCache) {
    settingsItemCache = storage.defineItem<Settings>(SETTINGS_KEY, {
      fallback: createDefaultSettings(),
      version: 3,
      migrations: {
        // v1 是模板示例词库，v2 起默认使用 BOSS 合规规则包
        2: (oldValue: unknown) => {
          const migrated = applyCompliancePack(normalizeSettings(oldValue));
          const legacyIds = new Set(LEGACY_SAMPLE_GROUP_IDS);
          migrated.groups = migrated.groups.filter((group) => !legacyIds.has(group.id));
          return migrated;
        },
        // v3 扩充规则包（网络灰产、工时加班、不实招聘、招生培训等）：
        // 只补充新增分组与关键词，不覆盖用户改过的内容
        3: (oldValue: unknown) => mergeCompliancePack(normalizeSettings(oldValue)),
      },
    });
  }
  return settingsItemCache;
}

/** 容错：兼容旧数据或手工改坏的结构 */
export function normalizeSettings(raw: unknown): Settings {
  const base = createDefaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<Settings>;

  const rawLevels =
    Array.isArray(value.levels) && value.levels.length > 0
      ? value.levels.filter((level) => level && typeof level.id === 'string')
      : base.levels;

  const levels = rawLevels
    .map((level, index) => ({
      id: String(level.id),
      name: String(level.name || `档位 ${index + 1}`),
      color: normalizeColor(level.color, LEVEL_COLOR_PALETTE[index % LEVEL_COLOR_PALETTE.length]!),
      style: normalizeLevelStyle(level.style),
      form: normalizeLevelForm(level.form),
      action: normalizeAction(level.action, index, rawLevels.length),
    }))
    // 没有手动排序入口，顺序完全由处置决定：这里统一重排，
    // 保证「数组顺序 = 处置优先级 = 面板/清单/审核意见的展示顺序」
    .sort((a, b) => ACTION_PRIORITY[a.action] - ACTION_PRIORITY[b.action]);

  const levelIds = new Set(levels.map((level) => level.id));
  const fallbackLevelId = levels[0]!.id;

  const groups = Array.isArray(value.groups)
    ? value.groups
        .filter((group) => group && typeof group.id === 'string')
        .map((group) => ({
          id: String(group.id),
          name: String(group.name || '未命名分组'),
          levelId: levelIds.has(String(group.levelId)) ? String(group.levelId) : fallbackLevelId,
          enabled: group.enabled !== false,
          keywords: Array.isArray(group.keywords)
            ? group.keywords.filter((word): word is string => typeof word === 'string')
            : [],
          useRegex: group.useRegex === true,
          clause: typeof group.clause === 'string' && group.clause ? group.clause : undefined,
          advice: typeof group.advice === 'string' && group.advice ? group.advice : undefined,
        }))
    : base.groups;

  return {
    enabled: value.enabled !== false,
    siteMode:
      value.siteMode === 'include' || value.siteMode === 'exclude' ? value.siteMode : 'all',
    sites: Array.isArray(value.sites)
      ? value.sites.filter((site): site is string => typeof site === 'string')
      : [],
    excludedSites: Array.isArray(value.excludedSites)
      ? value.excludedSites.filter((site): site is string => typeof site === 'string')
      : [],
    levels,
    groups,
    match: {
      caseSensitive: value.match?.caseSensitive === true,
      wholeWord: value.match?.wholeWord === true,
      useRegex: value.match?.useRegex === true,
      chineseWord: value.match?.chineseWord === true,
      englishWord: value.match?.englishWord === true,
    },
    panel: {
      show: value.panel?.show !== false,
      corner: value.panel?.corner === 'bottom-right' ? 'bottom-right' : 'top-right',
      collapsed: value.panel?.collapsed === true,
    },
    trigger: {
      enabled: value.trigger?.enabled !== false,
      buttonTexts: Array.isArray(value.trigger?.buttonTexts)
        ? value.trigger.buttonTexts.filter(
            (text): text is string => typeof text === 'string' && text.trim().length > 0,
          )
        : base.trigger.buttonTexts,
      duration:
        typeof value.trigger?.duration === 'number' && value.trigger.duration >= 0
          ? value.trigger.duration
          : base.trigger.duration,
    },
    dynamic: value.dynamic !== false,
    scanMode: value.scanMode === 'manual' ? 'manual' : 'auto',
    skipIframes: value.skipIframes === true,
    viewportOnly: value.viewportOnly === true,
    // 默认开启：老数据没有这个字段时也按「忽略隐藏内容」处理
    ignoreHidden: value.ignoreHidden !== false,
    limits: {
      maxNodes:
        typeof value.limits?.maxNodes === 'number' && value.limits.maxNodes > 0
          ? Math.floor(value.limits.maxNodes)
          : base.limits.maxNodes,
      flushDelay:
        typeof value.limits?.flushDelay === 'number' && value.limits.flushDelay >= 0
          ? Math.floor(value.limits.flushDelay)
          : base.limits.flushDelay,
    },
  };
}

function normalizeColor(color: unknown, fallback: string): string {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : fallback;
}

const LEVEL_STYLES: readonly string[] = ['auto', 'strong', 'medium', 'weak', 'plain', 'none'];
const LEVEL_FORMS: readonly string[] = ['none', 'solid', 'dashed', 'dotted', 'wavy'];

const LEVEL_ACTIONS: readonly string[] = ['reject', 'revise', 'verify', 'qualify', 'warn', 'hint'];

/** 档位顺序的唯一依据：处置动作的优先级（越靠前越严重） */
const ACTION_PRIORITY: Record<LevelAction, number> = {
  reject: 0,
  revise: 1,
  verify: 2,
  qualify: 3,
  warn: 4,
  hint: 5,
};

function normalizeLevelStyle(value: unknown): LevelStyle {
  return typeof value === 'string' && LEVEL_STYLES.includes(value) ? (value as LevelStyle) : 'auto';
}

function isForm(value: unknown): value is HighlightStyle {
  return typeof value === 'string' && LEVEL_FORMS.includes(value);
}

function toForm(value: unknown): HighlightStyle | undefined {
  return isForm(value) ? value : undefined;
}

/** 档位线型：非法或未设置时回落实线 */
function normalizeLevelForm(value: unknown): HighlightStyle {
  return toForm(value) ?? 'solid';
}

/** 旧数据没有处置动作时按序位推导：第 1 档驳回、中间核实、最后 1 档提示 */
function deriveAction(rank: number, total: number): LevelAction {
  if (total <= 1) return 'reject';
  if (rank === 0) return 'reject';
  if (rank === total - 1) return 'hint';
  return 'verify';
}

function normalizeAction(value: unknown, rank: number, total: number): LevelAction {
  return typeof value === 'string' && LEVEL_ACTIONS.includes(value)
    ? (value as LevelAction)
    : deriveAction(rank, total);
}

/** 读取设置并做一次容错归一 */
export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await settingsStorage().getValue());
}

export async function updateSettings(updater: (settings: Settings) => Settings): Promise<Settings> {
  const next = normalizeSettings(updater(await getSettings()));
  await settingsStorage().setValue(next);
  return next;
}

/** 站点白名单匹配：支持 `example.com`、`*.example.com`、含协议的完整地址 */
export function matchSite(pattern: string, hostname: string): boolean {
  const cleaned = pattern
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
  if (!cleaned) return false;
  const host = hostname.toLowerCase();
  if (cleaned.startsWith('*.')) {
    const base = cleaned.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === cleaned;
}

export function isSiteEnabled(settings: Settings, url: string): boolean {
  if (settings.siteMode === 'all') return true;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  if (settings.siteMode === 'exclude') {
    return !settings.excludedSites.some((site) => matchSite(site, hostname));
  }
  return settings.sites.some((site) => matchSite(site, hostname));
}

/** 把「每行一个 / 逗号分隔」的文本解析为关键词数组（去重、去空） */
export function parseKeywords(text: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[\n,，、;；]+/)) {
    const word = part.trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
  }
  return result;
}

/**
 * 右键加词用：整段选中文本作为一个关键词，多行时才按行拆开。
 * 刻意不按逗号切分——正文里的逗号多是句子停顿，切开会塞进一堆无意义的碎片词。
 */
export function parseSelectionKeywords(text: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[\r\n]+/)) {
    const word = part.trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
  }
  return result;
}

export function formatKeywords(keywords: string[]): string {
  return keywords.join('\n');
}
