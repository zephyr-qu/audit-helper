import { beforeEach, describe, expect, it } from 'vitest';
import { buildPackGroups } from './compliance-pack';
import { Highlighter, compileRules, escapeRegExp, rulesFingerprint } from './highlighter';
import { makeSettings } from './test-fixtures';
import type { KeywordGroup, Settings } from './types';

const GROUP_BAN: KeywordGroup = {
  id: 'g_ban',
  name: '违禁',
  levelId: 'lv_reject',
  enabled: true,
  keywords: ['陪酒', '赌博'],
};

const GROUP_FEE: KeywordGroup = {
  id: 'g_fee',
  name: '收费押金',
  levelId: 'lv_verify',
  enabled: true,
  keywords: ['押金'],
};

/** 建好规则与扫描器：测试里大量重复这段接线 */
function setup(groups: KeywordGroup[], overrides: Partial<Settings> = {}) {
  const settings = makeSettings({ groups, ...overrides });
  const highlighter = new Highlighter();
  highlighter.setRules(compileRules(settings));
  highlighter.setIgnoreHidden(settings.ignoreHidden);
  return { settings, highlighter };
}

function markCount(): number {
  return document.querySelectorAll('[data-kwa-mark]').length;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('compileRules', () => {
  it('没有启用分组时返回 null', () => {
    expect(compileRules(makeSettings({ groups: [] }))).toBeNull();
    expect(compileRules(makeSettings({ groups: [{ ...GROUP_BAN, enabled: false }] }))).toBeNull();
    // 分组指向不存在的档位同样不参与匹配
    expect(compileRules(makeSettings({ groups: [{ ...GROUP_BAN, levelId: 'lv_missing' }] }))).toBeNull();
  });

  it('字面关键词走 literal 管线，默认忽略大小写', () => {
    const settings = makeSettings({ groups: [{ ...GROUP_BAN, keywords: ['WeChat'] }] });
    const rules = compileRules(settings)!;
    expect(rules.literal?.regex.exec('请加 wechat 联系')?.[0]).toBe('wechat');
    expect(rules.pattern).toBeNull();
  });

  it('区分大小写时不再命中不同大小写', () => {
    const settings = makeSettings({
      groups: [{ ...GROUP_BAN, keywords: ['WeChat'] }],
      match: { caseSensitive: true, wholeWord: false, useRegex: false, chineseWord: false, englishWord: false },
    });
    const rules = compileRules(settings)!;
    expect(rules.literal?.regex.exec('请加 wechat 联系')).toBeNull();
  });

  it('非法正则计入 errors，且不影响字面词管线', () => {
    const settings = makeSettings({
      groups: [
        GROUP_FEE,
        { ...GROUP_BAN, id: 'g_regex', useRegex: true, keywords: ['(', '陪酒'] },
      ],
    });
    const rules = compileRules(settings)!;
    expect(rules.errors).toEqual(['(']);
    expect(rules.literal?.index.get('押金')?.groupId).toBe('g_fee');
    expect(rules.pattern?.regex.exec('这里有陪酒')?.[0]).toBe('陪酒');
  });

  it('同一个词只归属最先出现的分组', () => {
    const settings = makeSettings({
      groups: [GROUP_BAN, { ...GROUP_FEE, keywords: ['押金', '陪酒'] }],
    });
    const rules = compileRules(settings)!;
    expect(rules.literal?.index.get('陪酒')?.groupId).toBe('g_ban');
  });

  it('整词匹配按中英文边界拒绝词内命中', () => {
    const settings = makeSettings({
      groups: [{ ...GROUP_BAN, keywords: ['微信'] }],
      match: { caseSensitive: false, wholeWord: true, useRegex: false, chineseWord: false, englishWord: false },
    });
    const rules = compileRules(settings)!;
    expect(rules.literal?.regex.exec('微信号')?.[0]).toBeUndefined();
    expect(rules.literal?.regex.exec('请加 微信 联系')?.[0]).toBe('微信');
  });
});

describe('rulesFingerprint', () => {
  it('与规则无关的字段变化不改变指纹，规则相关的变化会改变', () => {
    const base = makeSettings({ groups: [GROUP_BAN] });
    expect(rulesFingerprint(base)).toBe(rulesFingerprint({ ...base, panel: { show: false, corner: 'bottom-right', collapsed: true } }));

    expect(rulesFingerprint(base)).not.toBe(rulesFingerprint({ ...base, ignoreHidden: false }));
    expect(rulesFingerprint(base)).not.toBe(
      rulesFingerprint({ ...base, groups: [{ ...GROUP_BAN, keywords: ['陪酒', '赌博', '传销'] }] }),
    );
  });
});

describe('escapeRegExp', () => {
  it('转义正则元字符', () => {
    expect(escapeRegExp('1+1=2?')).toBe('1\\+1=2\\?');
  });
});

describe('Highlighter', () => {
  it('命中后插入高亮节点，页面文本保持不变', () => {
    document.body.innerHTML = '<p>需要交押金</p>';
    const { highlighter } = setup([GROUP_FEE]);

    const result = highlighter.scan(document.body, 100);

    expect(result.added).toBe(1);
    expect(markCount()).toBe(1);
    expect(document.querySelector('[data-kwa-mark]')?.textContent).toBe('押金');
    expect(document.body.textContent).toBe('需要交押金');
    expect(highlighter.count).toBe(1);
  });

  it('跳过 script / style / 富文本 / 显式忽略的节点', () => {
    document.body.innerHTML = `
      <script>var a = '押金';</script>
      <style>/* 押金 */</style>
      <div contenteditable="true">押金</div>
      <div data-kwa-ignore>押金</div>
      <p>押金</p>`;
    const { highlighter } = setup([GROUP_FEE]);

    expect(highlighter.scan(document.body, 100).added).toBe(1);
    expect(markCount()).toBe(1);
  });

  it('同一分组内前缀重叠时优先取更长的词（押金退还 而不是 押金）', () => {
    document.body.innerHTML = '<p>押金退还</p>';
    // 词库里「押金」写在前面，但合成正则会按长度降序重排
    const { highlighter } = setup([{ ...GROUP_FEE, keywords: ['押金', '押金退还'] }]);

    highlighter.scan(document.body, 100);

    expect(markCount()).toBe(1);
    expect(document.querySelector('[data-kwa-mark]')?.textContent).toBe('押金退还');
  });

  it('跨分组不按长度重排：先声明的分组优先，避免更长的词把结论改轻', () => {
    document.body.innerHTML = '<p>押金退还</p>';
    const settings = makeSettings({
      groups: [
        { ...GROUP_BAN, keywords: ['押金'] }, // 先声明 → 建议驳回
        { ...GROUP_FEE, keywords: ['押金退还'] }, // 后声明但更长 → 需人工核实
      ],
    });
    const highlighter = new Highlighter();
    highlighter.setRules(compileRules(settings));

    highlighter.scan(document.body, 100);

    const mark = document.querySelector('[data-kwa-mark]');
    expect(mark?.textContent).toBe('押金');
    expect(mark?.getAttribute('data-kwa-level')).toBe('lv_reject');
  });

  it('跨管线重叠时取更长的命中（正则词的 `押金退还` 压过字面词的 `押金`）', () => {
    document.body.innerHTML = '<p>押金退还</p>';
    const settings = makeSettings({
      groups: [
        { ...GROUP_FEE, keywords: ['押金'] },
        { ...GROUP_BAN, id: 'g_regex', useRegex: true, keywords: ['押金退还'] },
      ],
    });
    const highlighter = new Highlighter();
    highlighter.setRules(compileRules(settings));

    highlighter.scan(document.body, 100);

    expect(markCount()).toBe(1);
    expect(document.querySelector('[data-kwa-mark]')?.textContent).toBe('押金退还');
  });

  it('隐藏容器里的命中不计入结果，并单独计数（ignoreHidden 默认开启）', () => {
    document.body.innerHTML = `
      <div style="display:none"><p>需要交押金</p></div>
      <p>正常内容</p>`;
    const { highlighter } = setup([GROUP_FEE]);

    const result = highlighter.scan(document.body, 100);

    expect(result.added).toBe(0);
    expect(markCount()).toBe(0);
    expect(highlighter.skippedCount).toBe(1);
  });

  it('关闭 ignoreHidden 后隐藏内容照常命中', () => {
    document.body.innerHTML = '<div style="display:none"><p>需要交押金</p></div>';
    const { highlighter } = setup([GROUP_FEE], { ignoreHidden: false });

    expect(highlighter.scan(document.body, 100).added).toBe(1);
    expect(highlighter.skippedCount).toBe(0);
  });

  it('触达批次上限后能续扫完，不丢命中也不重复计数', () => {
    // 12 个独立文本节点，每批只处理 5 个
    document.body.innerHTML = Array.from({ length: 12 }, (_, i) => `<p>第${i}条 押金</p>`).join('');
    const { highlighter } = setup([GROUP_FEE]);

    let result = highlighter.startFullScan(document.body, 5);
    let added = result.added;
    let batches = 0;
    while (result.truncated && batches < 20) {
      result = highlighter.continueScan(5);
      added += result.added;
      batches += 1;
    }

    expect(result.truncated).toBe(false);
    expect(batches).toBeLessThan(20);
    expect(added).toBe(12);
    expect(markCount()).toBe(12);
    expect(highlighter.count).toBe(12);
  });

  it('续扫的每一批都会前进，不会空转', () => {
    document.body.innerHTML = Array.from({ length: 30 }, (_, i) => `<p>第${i}条 押金</p>`).join('');
    const { highlighter } = setup([GROUP_FEE]);

    let result = highlighter.startFullScan(document.body, 4);
    let batches = 0;
    while (result.truncated && batches < 30) {
      const previous = markCount();
      result = highlighter.continueScan(4);
      // truncated 为真就必须真的处理了新节点
      if (result.truncated) expect(result.processed).toBeGreaterThan(0);
      expect(markCount()).toBeGreaterThanOrEqual(previous);
      batches += 1;
    }

    expect(markCount()).toBe(30);
  });

  it('没有 startFullScan 时 continueScan 安全返回', () => {
    const { highlighter } = setup([GROUP_FEE]);
    expect(highlighter.continueScan(5)).toEqual({ added: 0, processed: 0, truncated: false });
  });

  it('viewportOnly 把视口外的节点延后，flushViewportAll 再补扫', () => {
    document.body.innerHTML = '<p>需要交押金</p>';
    const { highlighter } = setup([GROUP_FEE]);

    const result = highlighter.scan(document.body, 100, true);
    expect(result.added).toBe(0);
    expect(markCount()).toBe(0);

    highlighter.flushViewportAll();
    expect(markCount()).toBe(1);
  });

  it('clear 还原页面 DOM，且可重复扫描', () => {
    document.body.innerHTML = '<p>需要交押金</p>';
    const { highlighter } = setup([GROUP_FEE]);

    highlighter.scan(document.body, 100);
    highlighter.clear();

    expect(markCount()).toBe(0);
    expect(document.querySelectorAll('p')).toHaveLength(1);
    expect(document.body.textContent).toBe('需要交押金');
    expect(highlighter.count).toBe(0);

    expect(highlighter.scan(document.body, 100).added).toBe(1);
    expect(markCount()).toBe(1);
  });

  it('按档位过滤后，可见数量与统计都按过滤集合计算', () => {
    document.body.innerHTML = '<p>陪酒</p><p>押金</p>';
    const { settings, highlighter } = setup([GROUP_BAN, GROUP_FEE]);
    highlighter.scan(document.body, 100);

    expect(highlighter.visibleCount([])).toBe(2);
    highlighter.applyLevelFilter(['lv_reject']);
    expect(highlighter.visibleCount(['lv_reject'])).toBe(1);

    const stats = highlighter.stats(settings, 'https://example.com/job/1', false, []);
    expect(stats.total).toBe(2);
    expect(stats.levels.find((level) => level.id === 'lv_reject')?.count).toBe(1);
    expect(stats.levels.find((level) => level.id === 'lv_verify')?.count).toBe(1);
    // 清单排序：阻断类排在待核实类之前
    expect(stats.hits.map((hit) => hit.keyword)).toEqual(['陪酒', '押金']);
  });
});

describe('内置规则包', () => {
  it('联系方式分组能命中手机号与微信变体', () => {
    document.body.innerHTML = '<p>联系 13812345678 或加薇信</p>';
    const { highlighter } = setup(buildPackGroups(), { ignoreHidden: false });

    const result = highlighter.scan(document.body, 100);

    expect(result.added).toBeGreaterThanOrEqual(2);
  });

  it('收费押金分组把词归到「需人工核实」档位', () => {
    document.body.innerHTML = '<p>入职需缴纳押金</p>';
    const { settings, highlighter } = setup(buildPackGroups());
    highlighter.scan(document.body, 100);

    const stats = highlighter.stats(settings, 'https://example.com/job/1', false, []);
    const hit = stats.hits[0];
    expect(hit?.groupName).toBe('收费押金');
    expect(hit?.clause).toBe('5.13');
    expect(hit?.advice).toBeTruthy();
  });
});

describe('英文整词（englishWord）', () => {
  const GROUP_LATIN: KeywordGroup = {
    id: 'g_latin',
    name: '拉丁词',
    levelId: 'lv_hint',
    enabled: true,
    keywords: ['spa', 'love'],
  };

  function scanText(html: string, match: Partial<Settings['match']>): number {
    document.body.innerHTML = html;
    const settings = makeSettings({
      groups: [GROUP_LATIN],
      match: {
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
        chineseWord: false,
        englishWord: false,
        ...match,
      },
    });
    const highlighter = new Highlighter();
    highlighter.setRules(compileRules(settings));
    return highlighter.scan(document.body, 100).added;
  }

  it('默认关闭时按子串命中', () => {
    expect(scanText('<p>spaces</p>', {})).toBe(1);
    expect(scanText('<p>loves</p>', {})).toBe(1);
  });

  it('开启后不再命中更长单词里的片段', () => {
    expect(scanText('<p>spaces</p>', { englishWord: true })).toBe(0);
    expect(scanText('<p>loves</p>', { englishWord: true })).toBe(0);
  });

  it('开启后独立成词的仍然命中，且忽略大小写', () => {
    expect(scanText('<p>the SPA 会所</p>', { englishWord: true })).toBe(1);
    expect(scanText('<p>I love it</p>', { englishWord: true })).toBe(1);
  });

  it('数字也纳入整词判断：「996」不再命中「1996」', () => {
    document.body.innerHTML = '<p>1996 和 996</p>';
    const settings = makeSettings({
      groups: [{ id: 'g_num', name: '数字词', levelId: 'lv_hint', enabled: true, keywords: ['996'] }],
      match: {
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
        chineseWord: false,
        englishWord: true,
      },
    });
    const highlighter = new Highlighter();
    highlighter.setRules(compileRules(settings));

    expect(highlighter.scan(document.body, 100).added).toBe(1);
    expect(document.querySelector('[data-kwa-mark]')?.textContent).toBe('996');
  });

  it('数字整词关闭时仍按子串命中', () => {
    document.body.innerHTML = '<p>1996</p>';
    const settings = makeSettings({
      groups: [{ id: 'g_num', name: '数字词', levelId: 'lv_hint', enabled: true, keywords: ['996'] }],
      match: {
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
        chineseWord: false,
        englishWord: false,
      },
    });
    const highlighter = new Highlighter();
    highlighter.setRules(compileRules(settings));

    expect(highlighter.scan(document.body, 100).added).toBe(1);
  });

  it('不影响中文整词的既有口径：「微信号」仍能命中「微信」', () => {
    document.body.innerHTML = '<p>微信号</p>';
    const settings = makeSettings({
      groups: [
        { id: 'g_cjk', name: '中文词', levelId: 'lv_reject', enabled: true, keywords: ['微信'] },
      ],
      match: {
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
        chineseWord: true,
        englishWord: true,
      },
    });
    const highlighter = new Highlighter();
    highlighter.setRules(compileRules(settings));

    expect(highlighter.scan(document.body, 100).added).toBe(1);
  });

  it('中英混排、标点包围、纯大写时仍算独立词', () => {
    expect(scanText('<p>需要spa服务</p>', { englishWord: true })).toBe(1);
    expect(scanText('<p>spa,</p>', { englishWord: true })).toBe(1);
    expect(scanText('<p>(spa)</p>', { englishWord: true })).toBe(1);
    expect(scanText('<p>SPA</p>', { englishWord: true })).toBe(1);
  });

  it('下划线视为词内字符、连字符视为分隔符', () => {
    expect(scanText('<p>user_spa_name</p>', { englishWord: true })).toBe(0);
    expect(scanText('<p>a-spa-b</p>', { englishWord: true })).toBe(1);
  });

  it('字母与数字粘连时不命中片段（abc996 / 996abc）', () => {
    function scanNum(html: string): number {
      document.body.innerHTML = html;
      const settings = makeSettings({
        groups: [{ id: 'g_num', name: '数字词', levelId: 'lv_hint', enabled: true, keywords: ['996'] }],
        match: {
          caseSensitive: false,
          wholeWord: false,
          useRegex: false,
          chineseWord: false,
          englishWord: true,
        },
      });
      const highlighter = new Highlighter();
      highlighter.setRules(compileRules(settings));
      return highlighter.scan(document.body, 100).added;
    }

    expect(scanNum('<p>abc996</p>')).toBe(0);
    expect(scanNum('<p>996abc</p>')).toBe(0);
  });
});
