/**
 * 测试夹具：手工构造 Settings / StatsSnapshot。
 * 刻意不 import settings.ts —— 那个模块会拉进 wxt/storage，测试不该依赖扩展环境。
 */
import type { HitSummary, Level, LevelCount, Settings, StatsSnapshot } from './types';

export function makeLevels(): Level[] {
  return [
    { id: 'lv_reject', name: '建议驳回', color: '#ef4444', style: 'auto', form: 'solid', action: 'reject' },
    { id: 'lv_revise', name: '退回修改', color: '#f97316', style: 'auto', form: 'solid', action: 'revise' },
    { id: 'lv_verify', name: '人工核实', color: '#f59e0b', style: 'auto', form: 'solid', action: 'verify' },
    { id: 'lv_hint', name: '仅作提示', color: '#10b981', style: 'auto', form: 'solid', action: 'hint' },
  ];
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  const levels = overrides.levels ?? makeLevels();
  return {
    enabled: true,
    siteMode: 'all',
    sites: [],
    excludedSites: [],
    levels,
    groups: [],
    match: {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      chineseWord: false,
      englishWord: false,
    },
    panel: { show: true, corner: 'top-right', collapsed: false },
    trigger: { enabled: true, buttonTexts: ['发布'], duration: 0 },
    dynamic: true,
    scanMode: 'auto',
    skipIframes: false,
    viewportOnly: false,
    ignoreHidden: true,
    limits: { maxNodes: 20000, flushDelay: 220 },
    ...overrides,
  };
}

/** 按「档位 id → 命中数」生成 stats.levels，总数为各项之和 */
export function makeStats(
  options: { counts?: Record<string, number>; levels?: Level[] } & Partial<StatsSnapshot> = {},
): StatsSnapshot {
  const { counts = {}, levels: levelDefs = makeLevels(), ...rest } = options;
  const levels: LevelCount[] = levelDefs.map((level, rank) => ({
    id: level.id,
    name: level.name,
    color: level.color,
    action: level.action ?? 'verify',
    rank,
    count: counts[level.id] ?? 0,
  }));
  return {
    url: 'https://example.com/job/1',
    total: levels.reduce((sum, level) => sum + level.count, 0),
    truncated: false,
    hiddenSkipped: 0,
    levels,
    groups: [],
    hits: [],
    ruleErrors: [],
    ...rest,
  };
}

export function makeHit(partial: Partial<HitSummary> = {}): HitSummary {
  return {
    keyword: '押金',
    sample: '押金',
    groupId: 'g_fee',
    groupName: '收费押金',
    levelId: 'lv_verify',
    count: 1,
    ...partial,
  };
}
