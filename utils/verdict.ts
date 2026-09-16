import {
  actionKind,
  type ActionKind,
  type LevelAction,
  type LevelCount,
  type Settings,
  type StatsSnapshot,
} from './types';

export type VerdictLevel =
  | 'reject'
  | 'revise'
  | 'verify'
  | 'qualify'
  | 'warn'
  | 'hint'
  | 'clean'
  | 'limited';

export interface Verdict {
  level: VerdictLevel;
  /** 一句话结论 */
  title: string;
  /** 补充说明 */
  detail: string;
  blockCount: number;
  reviewCount: number;
  hintCount: number;
}

export const VERDICT_STYLE: Record<VerdictLevel, { color: string }> = {
  reject: { color: '#ef4444' },
  revise: { color: '#f97316' },
  verify: { color: '#f59e0b' },
  qualify: { color: '#3b82f6' },
  warn: { color: '#8b5cf6' },
  hint: { color: '#14b8a6' },
  clean: { color: '#10b981' },
  limited: { color: '#64748b' },
};

function sumCount(levels: LevelCount[]): number {
  return levels.reduce((total, level) => total + level.count, 0);
}

function describe(levels: LevelCount[], fallbackName: string): string {
  const name = levels[0]?.name ?? fallbackName;
  return levels.length === 1 ? `「${name}」` : `${name}类`;
}

/**
 * 由命中情况推导审核结论。
 * 依据是档位的「行为级别」（阻断 / 待核实 / 提示），
 * 处置动作的措辞（建议驳回、退回修改、补充资质…）只影响文案。
 */
/** 结论优先级：命中时按处置的优先级给出结论（建议驳回 → … → 仅作提示） */
const ACTION_ORDER: LevelAction[] = ['reject', 'revise', 'verify', 'qualify', 'warn', 'hint'];

/** 各处置对应的结论文案 */
const ACTION_VERDICT: Record<LevelAction, { title: string; tail: string }> = {
  reject: { title: '建议驳回', tail: '属规范明确禁止的内容' },
  revise: { title: '建议退回修改', tail: '修改后可重新发布' },
  verify: { title: '存在风险，建议核实', tail: '需结合岗位实际情况判断' },
  qualify: { title: '需补充资质', tail: '请核实相关资质材料' },
  warn: { title: '建议教育警示', tail: '建议提示招聘方注意' },
  hint: { title: '仅提示', tail: '可提示招聘方优化' },
};

export function computeVerdict(stats: StatsSnapshot): Verdict {
  const byKind = (kind: ActionKind): LevelCount[] =>
    stats.levels.filter((level) => actionKind(level.action) === kind);

  const blockCount = sumCount(byKind('block'));
  const reviewCount = sumCount(byKind('review'));
  const hintCount = sumCount(byKind('hint'));

  if (stats.total === 0) {
    // 内容被截断、或有规则无法编译时，不轻易下「无风险」结论
    if (stats.truncated || stats.ruleErrors.length > 0) {
      return {
        level: 'limited',
        title: '信息不足，结论仅供参考',
        detail: '本页内容过多或部分规则无法编译，未能完整扫描',
        blockCount,
        reviewCount,
        hintCount,
      };
    }
    // 命中全落在隐藏容器里：可见内容确实没问题，但不能说「词库没命中」
    if (stats.hiddenSkipped > 0) {
      return {
        level: 'clean',
        title: '可见内容未发现风险项',
        detail: `另有 ${stats.hiddenSkipped} 处命中位于隐藏内容中，未计入`,
        blockCount,
        reviewCount,
        hintCount,
      };
    }
    return {
      level: 'clean',
      title: '未发现风险项',
      detail: '当前词库未命中任何关键词',
      blockCount,
      reviewCount,
      hintCount,
    };
  }

  // 取命中的最高优先级处置作为结论
  const hitLevels = stats.levels.filter((level) => level.count > 0);
  const topAction =
    ACTION_ORDER.find((action) => hitLevels.some((level) => level.action === action)) ?? 'hint';
  const topLevels = hitLevels.filter((level) => level.action === topAction);
  const meta = ACTION_VERDICT[topAction];

  return {
    level: topAction,
    title: meta.title,
    detail: `命中 ${sumCount(topLevels)} 处${describe(topLevels, '相关')}项，${meta.tail}`,
    blockCount,
    reviewCount,
    hintCount,
  };
}

/** 生成可复制的审核意见 */
export function buildReportText(settings: Settings, stats: StatsSnapshot, verdict: Verdict): string {
  const orderOf = new Map(settings.levels.map((level, index) => [level.id, index]));
  const levelName = new Map(settings.levels.map((level) => [level.id, level.name]));
  const lines: string[] = [];

  lines.push(`【合规审核意见】${verdict.title}`);
  lines.push(
    `命中 ${stats.total} 处：建议驳回 ${verdict.blockCount} · 需核实 ${verdict.reviewCount} · 仅提示 ${verdict.hintCount}`,
  );
  lines.push(`来源：${stats.url || location.href}`);
  lines.push(`时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  const grouped = new Map<number, typeof stats.hits>();
  for (const hit of stats.hits) {
    const rank = orderOf.get(hit.levelId) ?? 99;
    const list = grouped.get(rank) ?? [];
    list.push(hit);
    grouped.set(rank, list);
  }

  for (const rank of [...grouped.keys()].sort((a, b) => a - b)) {
    const list = grouped.get(rank) ?? [];
    const sample = list[0];
    const label = sample ? (levelName.get(sample.levelId) ?? `第 ${rank + 1} 档`) : `第 ${rank + 1} 档`;
    lines.push(`▌${label}项（${list.length} 类 / ${list.reduce((sum, hit) => sum + hit.count, 0)} 处）`);
    list.forEach((hit, index) => {
      const clause = hit.clause ? `　依据 ${hit.clause}` : '';
      const shown = hit.sample || hit.keyword;
      lines.push(`${index + 1}. ${hit.groupName} · "${shown}" ×${hit.count}${clause}`);
      if (hit.advice) lines.push(`   建议：${hit.advice}`);
    });
    lines.push('');
  }

  if (stats.truncated) lines.push('注：页面内容过多，扫描未能跑完，结果可能不完整');
  if (stats.hiddenSkipped > 0) {
    lines.push(`注：另有 ${stats.hiddenSkipped} 处命中位于隐藏内容（display:none 等）中，未计入本意见`);
  }
  if (stats.ruleErrors.length > 0) {
    lines.push(`注：${stats.ruleErrors.length} 条规则无法编译，请检查关键词是否为正则写法`);
  }

  return lines.join('\n').trim();
}
