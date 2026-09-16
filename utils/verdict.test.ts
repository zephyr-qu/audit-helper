import { describe, expect, it } from 'vitest';
import { makeHit, makeSettings, makeStats } from './test-fixtures';
import { buildReportText, computeVerdict } from './verdict';

describe('computeVerdict', () => {
  it('无命中且扫描完整 → 未发现风险项', () => {
    const verdict = computeVerdict(makeStats());
    expect(verdict.level).toBe('clean');
    expect(verdict.title).toBe('未发现风险项');
  });

  it('截断或规则编译失败时不下「无风险」结论', () => {
    expect(computeVerdict(makeStats({ truncated: true })).level).toBe('limited');
    expect(computeVerdict(makeStats({ ruleErrors: ['('] })).level).toBe('limited');
  });

  it('命中全落在隐藏内容里 → 结论仍为 clean，但文案说明未计入', () => {
    const verdict = computeVerdict(makeStats({ hiddenSkipped: 5 }));
    expect(verdict.level).toBe('clean');
    expect(verdict.title).toBe('可见内容未发现风险项');
    expect(verdict.detail).toContain('5 处');
  });

  it('按处置优先级取最高档作为结论，并统计三种行为级别', () => {
    const verdict = computeVerdict(makeStats({ counts: { lv_hint: 3, lv_verify: 2, lv_reject: 1 } }));
    expect(verdict.level).toBe('reject');
    expect(verdict.title).toBe('建议驳回');
    expect(verdict.detail).toContain('属规范明确禁止的内容');
    expect(verdict.blockCount).toBe(1);
    expect(verdict.reviewCount).toBe(2);
    expect(verdict.hintCount).toBe(3);
  });

  it('退回修改比需人工核实优先', () => {
    const verdict = computeVerdict(makeStats({ counts: { lv_verify: 9, lv_revise: 1 } }));
    expect(verdict.level).toBe('revise');
    expect(verdict.detail).toContain('1 处');
  });
});

describe('buildReportText', () => {
  const settings = makeSettings();

  it('按档位顺序分组，并带上条款依据与处理建议', () => {
    const stats = makeStats({
      counts: { lv_reject: 1, lv_verify: 1 },
      hits: [
        makeHit({
          keyword: '陪酒',
          groupName: '色情低俗',
          levelId: 'lv_reject',
          clause: '5.2',
          advice: '删除涉黄描述',
        }),
        makeHit({ keyword: '押金', groupName: '收费押金', levelId: 'lv_verify', clause: '5.13' }),
      ],
    });

    const text = buildReportText(settings, stats, computeVerdict(stats));

    expect(text).toContain('【合规审核意见】建议驳回');
    expect(text).toContain('▌建议驳回项');
    expect(text).toContain('依据 5.2');
    expect(text).toContain('建议：删除涉黄描述');
    // 建议驳回排在需人工核实之前
    expect(text.indexOf('▌建议驳回项')).toBeLessThan(text.indexOf('▌人工核实项'));
  });

  it('隐藏命中与扫描未跑完都会写入注脚', () => {
    const stats = makeStats({ hiddenSkipped: 5, truncated: true });
    const text = buildReportText(settings, stats, computeVerdict(stats));
    expect(text).toContain('另有 5 处命中位于隐藏内容');
    expect(text).toContain('扫描未能跑完');
  });
});
