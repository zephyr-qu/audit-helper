/**
 * 高亮匹配性能基准（`npm run bench`）。
 *
 * 用真实 BOSS 词包，在 Node 下测量 compileRules 的编译耗时，以及 highlightTextNode
 * 匹配循环 + 双管线合并的扫描耗时。覆盖「含正则组 / 纯字面」与「词量放大」四种场景，
 * 便于后续回归对比（尤其验证字面词不再被正则词拖进命名捕获组慢路径）。
 *
 * 说明：此脚本不加载扩展、不触碰 storage，纯函数级基准，可在任意环境运行。
 */
import { PACK_LEVELS, buildPackGroups } from '../utils/compliance-pack';
import { compileRules, type CompiledRules } from '../utils/highlighter';
import type { KeywordGroup, Settings } from '../utils/types';

/** 构造基准用设置。scale>1 时复制多份并加后缀，放大关键词规模 */
function buildSettings(opts: { literal: boolean; scale: number }): Settings {
  let groups: KeywordGroup[] = buildPackGroups();
  if (opts.literal) groups = groups.map((g) => ({ ...g, useRegex: false }));
  if (opts.scale > 1) {
    const scaled: KeywordGroup[] = [];
    for (let i = 0; i < opts.scale; i++) {
      for (const g of groups) {
        scaled.push({ ...g, id: `${g.id}_${i}`, keywords: g.keywords.map((w) => `${w}_${i}`) });
      }
    }
    groups = scaled;
  }
  return {
    enabled: true,
    siteMode: 'all',
    sites: [],
    excludedSites: [],
    levels: PACK_LEVELS.map((l) => ({ ...l, form: 'solid' })),
    groups,
    match: {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      chineseWord: false,
      englishWord: false,
    },
    panel: { show: true, corner: 'top-right', collapsed: false },
    trigger: { enabled: true, buttonTexts: [], duration: 0 },
    dynamic: true,
    scanMode: 'auto',
    skipIframes: false,
    viewportOnly: false,
    limits: { maxNodes: 20000, flushDelay: 220 },
  } as unknown as Settings;
}

function countKeywords(settings: Settings): number {
  return settings.groups.reduce((n, g) => n + g.keywords.length, 0);
}

/** 生成约 size 字符的中文文本，周期性插入真实关键词制造命中 */
function makeText(settings: Settings, size: number): string {
  const sample = settings.groups[0]?.keywords.slice(0, 20) ?? [];
  const filler = '本岗位负责日常运营与数据整理，工作环境良好，欢迎您的加入。';
  let out = '';
  let i = 0;
  while (out.length < size) {
    out += filler;
    if (i % 7 === 0) out += sample[i % Math.max(sample.length, 1)] ?? '';
    i++;
  }
  return out;
}

/** 模拟双管线 highlightTextNode 的匹配 + 合并（含排序）成本 */
function scan(rules: CompiledRules, text: string): number {
  const found: Array<{ index: number; len: number; order: number }> = [];

  if (rules.literal) {
    const ci = rules.literal.regex.flags.includes('i');
    const regex = rules.literal.regex;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const t = m[0];
      if (t.length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      if (rules.literal.index.get(ci ? t.toLowerCase() : t))
        found.push({ index: m.index, len: t.length, order: 0 });
    }
  }

  if (rules.pattern) {
    const regex = rules.pattern.regex;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const t = m[0];
      if (t.length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      const gs = m.groups;
      if (!gs) continue;
      for (const name in gs) {
        if (gs[name] !== undefined) {
          if (rules.pattern.byGroupName.get(name))
            found.push({ index: m.index, len: t.length, order: 1 });
          break;
        }
      }
    }
  }

  found.sort((a, b) => a.index - b.index || b.len - a.len || a.order - b.order);
  let cursor = -1;
  let count = 0;
  for (const it of found) {
    if (it.index < cursor) continue;
    cursor = it.index + it.len;
    count++;
  }
  return count;
}

function bench(label: string, settings: Settings, reps: number, textSize: number): void {
  const k = countKeywords(settings);
  let rules: CompiledRules | null = null;
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) rules = compileRules(settings);
  const compileMs = (performance.now() - t0) / reps;

  const text = makeText(settings, textSize);
  let count = 0;
  const t1 = performance.now();
  for (let i = 0; i < reps; i++) count = scan(rules!, text);
  const scanMs = (performance.now() - t1) / reps;

  console.log(
    `${label.padEnd(22)} | 关键词 ${String(k).padStart(5)} | 编译 ${compileMs
      .toFixed(2)
      .padStart(7)}ms | 扫描 ${Math.round(textSize / 1000)}KB ${scanMs
      .toFixed(2)
      .padStart(7)}ms | 命中 ${count}`,
  );
}

const SIZE = 300_000;
console.log(`\n高亮匹配基准 | 文本样本 ${SIZE / 1000}KB 中文\n`);
bench('混合(含正则组) ×1', buildSettings({ literal: false, scale: 1 }), 20, SIZE);
bench('纯字面 ×1', buildSettings({ literal: true, scale: 1 }), 20, SIZE);
bench('混合(含正则组) ×10', buildSettings({ literal: false, scale: 10 }), 5, SIZE);
bench('纯字面 ×10', buildSettings({ literal: true, scale: 10 }), 5, SIZE);
console.log('');
