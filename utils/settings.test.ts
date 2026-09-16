import { describe, expect, it } from 'vitest';
import {
  createDefaultSettings,
  formatKeywords,
  isSiteEnabled,
  matchSite,
  normalizeSettings,
  parseKeywords,
  parseSelectionKeywords,
} from './settings';

describe('normalizeSettings', () => {
  it('档位顺序由处置决定，与存储里的顺序无关', () => {
    const settings = normalizeSettings({
      levels: [
        { id: 'a', name: '仅提示', color: '#10b981', action: 'hint' },
        { id: 'b', name: '建议驳回', color: '#ef4444', action: 'reject' },
        { id: 'c', name: '需人工核实', color: '#f59e0b', action: 'verify' },
      ],
    });
    expect(settings.levels.map((level) => level.action)).toEqual(['reject', 'verify', 'hint']);
  });

  it('分组指向不存在的档位时回落到首个档位', () => {
    const settings = normalizeSettings({
      levels: [{ id: 'lv_only', name: '唯一', color: '#ef4444', action: 'reject' }],
      groups: [{ id: 'g1', name: '分组', levelId: 'lv_missing', enabled: true, keywords: ['押金'] }],
    });
    expect(settings.groups[0]?.levelId).toBe('lv_only');
  });

  it('ignoreHidden 缺省为开启，显式 false 才关闭', () => {
    expect(normalizeSettings({}).ignoreHidden).toBe(true);
    expect(normalizeSettings({ ignoreHidden: false }).ignoreHidden).toBe(false);
  });

  it('viewportOnly 缺省为关闭（避开隐藏内容与懒扫描混淆）', () => {
    expect(normalizeSettings({}).viewportOnly).toBe(false);
    expect(normalizeSettings({ viewportOnly: true }).viewportOnly).toBe(true);
  });

  it('非法的扫描上限与防抖回落到默认值', () => {
    expect(normalizeSettings({ limits: { maxNodes: 0, flushDelay: -1 } }).limits).toEqual({
      maxNodes: 20000,
      flushDelay: 220,
    });
    expect(normalizeSettings({ limits: { maxNodes: 'x' } }).limits.maxNodes).toBe(20000);
    expect(normalizeSettings({ limits: { maxNodes: 4096.7 } }).limits.maxNodes).toBe(4096);
  });

  it('非法色值回落到调色板', () => {
    const settings = normalizeSettings({ levels: [{ id: 'a', name: 'x', color: 'red' }] });
    expect(settings.levels[0]?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('旧数据没有处置动作时按序位推导', () => {
    const settings = normalizeSettings({
      levels: [{ id: 'a', name: '一' }, { id: 'b', name: '二' }, { id: 'c', name: '三' }],
    });
    // 排序后：第 1 档驳回、中间核实、最后 1 档提示
    expect(settings.levels.map((level) => level.action)).toEqual(['reject', 'verify', 'hint']);
  });
});

describe('matchSite', () => {
  it('支持精确域名、通配子域，并清理协议/端口/路径', () => {
    expect(matchSite('example.com', 'example.com')).toBe(true);
    expect(matchSite('example.com', 'www.example.com')).toBe(false);
    expect(matchSite('*.corp.com', 'a.corp.com')).toBe(true);
    expect(matchSite('*.corp.com', 'corp.com')).toBe(true);
    expect(matchSite('https://audit.example.com/path?x=1', 'audit.example.com')).toBe(true);
    expect(matchSite('example.com:8080', 'example.com')).toBe(true);
    expect(matchSite('Example.COM', 'example.com')).toBe(true);
    expect(matchSite('', 'example.com')).toBe(false);
  });
});

describe('isSiteEnabled', () => {
  const base = createDefaultSettings();

  it('全部站点', () => {
    expect(isSiteEnabled({ ...base, siteMode: 'all' }, 'https://any.com')).toBe(true);
  });

  it('仅指定站点', () => {
    const settings = { ...base, siteMode: 'include' as const, sites: ['a.com'] };
    expect(isSiteEnabled(settings, 'https://a.com/x')).toBe(true);
    expect(isSiteEnabled(settings, 'https://b.com')).toBe(false);
    expect(isSiteEnabled(settings, 'not-a-url')).toBe(false);
  });

  it('除以下站点外：精确域名不含子域，要连子域一起排除需用通配', () => {
    const settings = { ...base, siteMode: 'exclude' as const, excludedSites: ['a.com'] };
    expect(isSiteEnabled(settings, 'https://a.com/x')).toBe(false);
    expect(isSiteEnabled(settings, 'https://sub.a.com/x')).toBe(true);
    expect(isSiteEnabled(settings, 'https://b.com')).toBe(true);

    const wildcard = { ...base, siteMode: 'exclude' as const, excludedSites: ['*.a.com'] };
    expect(isSiteEnabled(wildcard, 'https://sub.a.com/x')).toBe(false);
    expect(isSiteEnabled(wildcard, 'https://a.com/x')).toBe(false);
  });
});

describe('关键词解析', () => {
  it('词库文本按逗号/顿号/分号/换行切分并去重', () => {
    expect(parseKeywords('押金,保证金、入职费；培训费\n学费')).toEqual([
      '押金',
      '保证金',
      '入职费',
      '培训费',
      '学费',
    ]);
    expect(parseKeywords('押金, 押金，押金')).toEqual(['押金']);
  });

  it('右键选中的正文整段保留，不按逗号切碎', () => {
    expect(parseSelectionKeywords('限男性，35岁以下')).toEqual(['限男性，35岁以下']);
    expect(parseSelectionKeywords('限男性\n不招女性')).toEqual(['限男性', '不招女性']);
    expect(parseSelectionKeywords('   ')).toEqual([]);
  });

  it('formatKeywords 与 parseKeywords 互逆', () => {
    const words = ['押金', '保证金'];
    expect(parseKeywords(formatKeywords(words))).toEqual(words);
  });
});
