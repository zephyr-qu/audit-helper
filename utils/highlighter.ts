import { actionKind } from './types';
import { scrollElementIntoView } from './scroll';
import type {
  ActionKind,
  LevelCount,
  GroupCount,
  HitSummary,
  Settings,
  StatsSnapshot,
} from './types';

/**
 * 整词校验方式：
 * - none  不校验（按子串命中）
 * - cjk   只看首字 —— ICU 会把「微信号」切成「微|信号」，查词尾会误杀「微信」
 * - latin 首尾都看 —— 字母数字词的片段问题主要在词尾（love ← loves、996 ← 1996）
 */
export type WordCheckMode = 'none' | 'cjk' | 'latin';

export interface CompiledHit {
  keyword: string;
  groupId: string;
  levelId: string;
  /** 该关键词按正则解释，跳过整词校验 */
  asRegex: boolean;
  /** 整词校验方式（按匹配设置与词形推导，环境不支持分词时会降级为 none） */
  wordMode: WordCheckMode;
}

export interface CompiledRules {
  /** 字面关键词管线：无捕获组正则 + 命中文本索引（无字面词时为 null） */
  literal: { regex: RegExp; index: Map<string, CompiledHit> } | null;
  /** 正则关键词管线：命名捕获组（无正则词时为 null） */
  pattern: { regex: RegExp; byGroupName: Map<string, CompiledHit> } | null;
  /** 参与匹配的关键词数量 */
  count: number;
  /** 编译失败的关键词（多为非法正则） */
  errors: string[];
}

/** 这些标签内部的文本不参与审查 */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'CANVAS',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'VIDEO',
  'AUDIO',
]);

const SKIP_SELECTOR = [
  '[data-kwa-mark]',
  '[data-kwa-ignore]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
  'kwa-panel',
].join(',');

/**
 * checkVisibility 的新旧选项名各带一份：Chrome 105+ 用 checkVisibilityCSS，
 * 125+ 改叫 visibilityProperty，多传一个键不影响旧实现。
 */
const VISIBILITY_OPTIONS = { checkVisibilityCSS: true, visibilityProperty: true };

type CheckVisibilityElement = Element & {
  checkVisibility?: (options?: Record<string, boolean>) => boolean;
};

/**
 * 文本节点是否真的渲染出来了（自身或祖先 display:none / visibility:hidden 都算隐藏）。
 * 刻意不检查 opacity：`opacity: 0` 的文本页内查找仍能搜到，不算隐藏。
 * 只在「正则已命中」的文本节点上调用，所以 checkVisibility 触发的样式计算不拖累扫描性能。
 */
function isRendered(node: Text): boolean {
  const element = node.parentElement;
  if (!element) return false;

  const check = (element as CheckVisibilityElement).checkVisibility;
  if (typeof check === 'function') return check.call(element, VISIBILITY_OPTIONS);

  // 降级（老浏览器）：逐级向上检查 display / visibility
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (current === document.body) break;
  }
  return true;
}

const BOUNDARY_START = String.raw`(?<![\w\u4e00-\u9fa5])`;
const BOUNDARY_END = String.raw`(?![\w\u4e00-\u9fa5])`;

/** 关键词是否含中文（用于中文整词判断） */
const CJK_RE = /[\u4e00-\u9fa5]/;
/**
 * 关键词是否含拉丁字母或数字（用于英文整词判断）。
 * 数字一并纳入：`996` 不该命中「1996」——分词器把纯数字也算作 word-like。
 */
const ALNUM_RE = /[A-Za-z0-9]/;

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 分词整词校验用的分词器（懒初始化；undefined 表示尚未初始化，null 表示环境不支持） */
let wordSegmenter: Intl.Segmenter | null | undefined;
let warnedNoSegmenter = false;

function getSegmenter(): Intl.Segmenter | null {
  if (wordSegmenter !== undefined) return wordSegmenter;
  wordSegmenter =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('zh', { granularity: 'word' })
      : null;
  return wordSegmenter;
}

/** 当前环境是否支持分词（不支持时中文/英文整词降级为边界匹配） */
export function hasSegmenter(): boolean {
  return getSegmenter() !== null;
}

/**
 * 构建 isWordLike 分词段的范围表 [起点, 终点)。每个文本节点只需构建一次，
 * 供该节点所有命中复用。环境不支持分词时返回 null。
 */
export function buildWordSpans(text: string): Array<[number, number]> | null {
  const segmenter = getSegmenter();
  if (!segmenter) return null;
  const spans: Array<[number, number]> = [];
  for (const part of segmenter.segment(text)) {
    if (part.isWordLike) spans.push([part.index, part.index + part.segment.length]);
  }
  return spans;
}

function isInsideAnySpan(spans: Array<[number, number]>, index: number): boolean {
  for (const [start, end] of spans) {
    if (start < index && index < end) return true;
  }
  return false;
}

/**
 * 判断 text 中 index 处是否「从词中间起始」——即该位置落在某个 isWordLike 分词的内部。
 * 中文整词据此拒绝跨词拼接（如「专家教你」拼出的「家教」），同时放行领域词
 * （如「微信号」里被 ICU 切成「微|信号」的「微信」）。
 * 无 DOM 依赖，便于单测。返回 null 表示当前环境无法分词（调用方应降级）。
 */
export function startsInsideWord(text: string, index: number): boolean | null {
  const spans = buildWordSpans(text);
  if (!spans) return null;
  return isInsideAnySpan(spans, index);
}

/**
 * 命中是否独立成词。环境不支持分词时返回 true（交由边界匹配兜底）。
 * cjk 只看首字、latin 首尾都看，原因见 WordCheckMode 的说明。
 */
function passesWordCheck(
  spans: Array<[number, number]> | null,
  mode: 'cjk' | 'latin',
  index: number,
  length: number,
): boolean {
  if (!spans) {
    if (!warnedNoSegmenter) {
      warnedNoSegmenter = true;
      console.warn('[合规审查助手] 当前环境不支持 Intl.Segmenter，整词校验已降级为边界匹配');
    }
    return true;
  }
  if (isInsideAnySpan(spans, index)) return false;
  return mode === 'cjk' ? true : !isInsideAnySpan(spans, index + length);
}

/**
 * 把所有启用分组的关键词编译成一个合并正则，一次遍历即可命中。
 * 同一个词只归属最先出现的分组（设置层保证词不跨组，这里做兜底去重）。
 */
export function compileRules(settings: Settings): CompiledRules | null {
  const { levels, groups, match } = settings;
  const levelIds = new Set(levels.map((level) => level.id));
  const errors: string[] = [];
  const seen = new Set<string>();
  const flags = match.caseSensitive ? 'g' : 'gi';
  const literalEntries: Array<{ body: string; key: string; hit: CompiledHit }> = [];
  const patternEntries: Array<{ body: string; hit: CompiledHit }> = [];

  for (const group of groups) {
    if (!group.enabled || !levelIds.has(group.levelId)) continue;
    // 分组可单独指定按正则解析（如联系方式变体），否则跟随全局设置
    const asRegex = group.useRegex ?? match.useRegex;
    // 组内按词长降序参与合成：合并正则的备选项是「从左到右取首个命中」，
    // 前缀重叠时（押金 / 押金退还）让更具体的词先匹配，报告里就不会只报半截词。
    // 只排组内、不动分组层级——跨组的先后代表「严重度优先」，
    // 若全局按长度排，更长的词可能属于更轻的档位，会把结论改轻。
    const ordered = [...group.keywords].sort((a, b) => b.trim().length - a.trim().length);
    for (const raw of ordered) {
      const keyword = raw.trim();
      if (!keyword) continue;
      const dedupeKey = match.caseSensitive ? keyword : keyword.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (asRegex) {
        try {
          new RegExp(keyword, flags);
        } catch {
          errors.push(keyword);
          continue;
        }
        patternEntries.push({
          body: keyword,
          hit: { keyword, groupId: group.id, levelId: group.levelId, asRegex: true, wordMode: 'none' },
        });
        continue;
      }

      // 整词校验分工：含中文的词走中文整词（只看首字），其余字母数字词走英文整词（首尾都看）。
      // 含中文时优先中文模式，免得「微信号」这类词被词尾校验误杀。
      const isCjkLiteral = CJK_RE.test(keyword);
      const wordMode: WordCheckMode = isCjkLiteral
        ? match.chineseWord
          ? 'cjk'
          : 'none'
        : match.englishWord && ALNUM_RE.test(keyword)
          ? 'latin'
          : 'none';
      // 环境支持分词时由分词校验接管「独立成词」判断；不支持则退回边界匹配
      const segmentHandlesWord = wordMode !== 'none' && hasSegmenter();
      const fallbackToBoundary = wordMode !== 'none' && !hasSegmenter();
      let body = escapeRegExp(keyword);
      if (!segmentHandlesWord && (match.wholeWord || fallbackToBoundary))
        body = `${BOUNDARY_START}${body}${BOUNDARY_END}`;

      literalEntries.push({
        body,
        key: dedupeKey,
        hit: {
          keyword,
          groupId: group.id,
          levelId: group.levelId,
          asRegex: false,
          wordMode: segmentHandlesWord ? wordMode : 'none',
        },
      });
    }
  }

  if (literalEntries.length === 0 && patternEntries.length === 0) return null;

  // 字面词管线：无捕获组。几百个字面词合成一条正则，靠 V8 的字面量首字符优化，
  // 命中后再用 index 做 O(1) 反查——与词量基本无关。
  let literal: CompiledRules['literal'] = null;
  if (literalEntries.length > 0) {
    literal = {
      regex: new RegExp(literalEntries.map((entry) => entry.body).join('|'), flags),
      index: new Map(literalEntries.map((entry) => [entry.key, entry.hit])),
    };
  }

  // 正则词管线：命名捕获组（数量很少，开销可控）。单独成组，避免把大量字面词
  // 也拖进「每次命中都分配 N 个命名组」的慢路径。
  let pattern: CompiledRules['pattern'] = null;
  if (patternEntries.length > 0) {
    const byGroupName = new Map<string, CompiledHit>();
    const parts = patternEntries.map((entry, index) => {
      const name = `k${index}`;
      byGroupName.set(name, entry.hit);
      return `(?<${name}>${entry.body})`;
    });
    try {
      pattern = { regex: new RegExp(parts.join('|'), flags), byGroupName };
    } catch (error) {
      errors.push(String(error));
      pattern = null;
    }
  }

  return {
    literal,
    pattern,
    count: literalEntries.length + patternEntries.length,
    errors,
  };
}

/** 一批扫描的结果 */
export interface ScanResult {
  /** 本批新增的命中数 */
  added: number;
  /** 本批处理（或登记为待扫）的文本节点数 */
  processed: number;
  /** 是否触达本批节点上限、仍有剩余节点未处理 */
  truncated: boolean;
}

/** 规则指纹：用于判断设置变化后是否需要重新扫描 DOM */
export function rulesFingerprint(settings: Settings): string {
  return JSON.stringify({
    m: settings.match,
    l: settings.levels.map((level) => level.id),
    g: settings.groups.map((group) => [group.id, group.levelId, group.enabled, group.keywords]),
    h: settings.ignoreHidden,
  });
}

export class Highlighter {
  private rules: CompiledRules | null = null;

  private marks: HTMLElement[] = [];

  /** 视口懒扫描：已发现但当前不在视口内、待滚动到时再扫描的文本节点 */
  private pendingViewport = new Set<Text>();

  /** 是否跳过隐藏容器（display:none 等）里的命中 */
  private ignoreHidden = false;

  /** 因位于隐藏容器而未被计入的命中数 */
  private hiddenSkipped = 0;

  /** 整页续扫的起点与锚点（只由 startFullScan / continueScan 维护） */
  private resumeRoot: Node | null = null;
  /** 下一批从哪个文本节点开始：上一批结束时其后首个待处理节点，必定仍在文档里 */
  private resumeAnchor: Text | null = null;

  setRules(rules: CompiledRules | null): void {
    this.rules = rules;
  }

  setIgnoreHidden(ignore: boolean): void {
    this.ignoreHidden = ignore;
  }

  /** 因位于隐藏容器而被跳过的命中数（累计值，clear() 时重置） */
  get skippedCount(): number {
    return this.hiddenSkipped;
  }

  /** 已插入且仍挂载在页面上的高亮节点 */
  liveMarks(): HTMLElement[] {
    if (this.marks.some((mark) => !mark.isConnected)) {
      this.marks = this.marks.filter((mark) => mark.isConnected);
    }
    return this.marks;
  }

  get count(): number {
    return this.liveMarks().length;
  }

  /**
   * 扫描一个子树，返回本批结果。viewportOnly 为真时，视口外的文本节点只登记进待扫队列、
   * 暂不逐字匹配，等滚动到视口再扫，省掉长页面里大量不可见文本的匹配开销。
   */
  scan(root: Node, maxNodes: number, viewportOnly = false): ScanResult {
    return this.walk(root, maxNodes, viewportOnly, false);
  }

  /** 整页扫描的第一批：重置续扫锚点后再扫（增量扫描的零散节点不该动这个锚点） */
  startFullScan(root: Node, maxNodes: number, viewportOnly = false): ScanResult {
    this.resumeRoot = root;
    this.resumeAnchor = null;
    return this.walk(root, maxNodes, viewportOnly, true);
  }

  /**
   * 续扫下一批，由调用方在空闲时间反复调用直到 truncated 为 false，
   * 避免长页面被节点上限静默截断。
   *
   * 续扫靠「节点身份」定位，既不能用 TreeWalker 也不能记节点序号：
   * - TreeWalker 的游标会随被改写的文本节点脱离文档而失效；
   * - 记序号会被高亮插入的残留文本节点带偏——每命中一处就多出 0~2 个文本节点，
   *   偏移累积后批次可能永远推不到末尾（空转）。
   * 锚点取「本批最后处理的那个节点之后的第一个节点」，它不在本批改写范围内，
   * 改写后仍在原位，因此批次必定单调前进。
   */
  continueScan(maxNodes: number, viewportOnly = false): ScanResult {
    if (!this.resumeRoot || !this.resumeRoot.isConnected) {
      return { added: 0, processed: 0, truncated: false };
    }
    // 锚点被页面改动弄丢：放弃续扫，但保留「结果可能不完整」的提示
    if (!this.resumeAnchor || !this.resumeAnchor.isConnected) {
      return { added: 0, processed: 0, truncated: true };
    }
    return this.walk(this.resumeRoot, maxNodes, viewportOnly, true);
  }

  private walk(
    root: Node,
    maxNodes: number,
    viewportOnly: boolean,
    resumable: boolean,
  ): ScanResult {
    if (!this.rules) return { added: 0, processed: 0, truncated: false };

    // 动态内容常常只是单个文本节点
    if (root.nodeType === Node.TEXT_NODE) {
      const text = root as Text;
      if (this.accept(text) !== NodeFilter.FILTER_ACCEPT) {
        return { added: 0, processed: 0, truncated: false };
      }
      if (viewportOnly && !this.isInViewport(text)) {
        this.pendingViewport.add(text);
        return { added: 0, processed: 1, truncated: false };
      }
      return { added: this.highlightTextNode(text), processed: 1, truncated: false };
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
      return { added: 0, processed: 0, truncated: false };
    }

    // 先收集目标文本节点，再统一改写，避免边遍历边改树
    const anchor = resumable && this.resumeAnchor?.isConnected ? this.resumeAnchor : null;
    let reachedAnchor = anchor === null;
    const targets: Text[] = [];
    let truncated = false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => this.accept(node as Text),
    });
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!reachedAnchor) {
        if (node === anchor) reachedAnchor = true;
        else continue;
      }
      targets.push(node);
      if (targets.length >= maxNodes) {
        // 多走一步记住「下一个待处理节点」：它不在本批改写范围内，改写后位置不变，
        // 下一批直接从它续起，不需要重数已处理的节点。
        const next = walker.nextNode() ? (walker.currentNode as Text) : null;
        if (resumable) this.resumeAnchor = next;
        truncated = next !== null;
        break;
      }
    }
    if (!truncated && resumable) this.resumeAnchor = null;

    // 锚点没找到（被 accept 过滤或中途被移走）：不冒险从头重扫，保留不完整提示
    if (!reachedAnchor) {
      return { added: 0, processed: 0, truncated: true };
    }

    let added = 0;
    for (const node of targets) {
      if (viewportOnly && !this.isInViewport(node)) {
        this.pendingViewport.add(node);
        continue;
      }
      added += this.highlightTextNode(node);
    }
    return { added, processed: targets.length, truncated };
  }

  /** 文本节点是否落在视口内（上下各预留一个视口高度，滚动时提前扫出） */
  private isInViewport(node: Text): boolean {
    const parent = node.parentElement;
    if (!parent) return false;
    const rect = parent.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const margin = window.innerHeight;
    return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
  }

  /** 滚动时补扫已进入视口的待扫节点，返回新增命中数 */
  scanViewport(): number {
    if (this.pendingViewport.size === 0) return 0;
    let added = 0;
    for (const node of this.pendingViewport) {
      if (!node.isConnected) {
        this.pendingViewport.delete(node);
        continue;
      }
      if (this.isInViewport(node)) {
        this.pendingViewport.delete(node);
        added += this.highlightTextNode(node);
      }
    }
    return added;
  }

  /** 关闭视口懒扫描时，把之前跳过（视口外）的节点一次性补扫出来 */
  flushViewportAll(): void {
    if (this.pendingViewport.size === 0) return;
    for (const node of this.pendingViewport) {
      if (node.isConnected) this.highlightTextNode(node);
    }
    this.pendingViewport.clear();
  }

  private accept(node: Text): number {
    const parent = node.parentElement;
    if (!parent) return NodeFilter.FILTER_REJECT;
    if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
    if (parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
    const value = node.nodeValue;
    if (!value || value.length < 1 || !value.trim()) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }

  private highlightTextNode(node: Text): number {
    const rules = this.rules;
    const value = node.nodeValue;
    if (!rules || !value) return 0;

    // 两条管线分别收集命中：字面词(0) 用 O(1) 反查，正则词(1) 用命名组
    const found: Array<{ index: number; text: string; hit: CompiledHit; order: number }> = [];

    const literalRules = rules.literal;
    if (literalRules) {
      const ci = literalRules.regex.flags.includes('i');
      const regex = literalRules.regex;
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(value)) !== null) {
        const text = m[0];
        if (text.length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        const hit = literalRules.index.get(ci ? text.toLowerCase() : text);
        if (hit) found.push({ index: m.index, text, hit, order: 0 });
      }
    }

    const patternRules = rules.pattern;
    if (patternRules) {
      const regex = patternRules.regex;
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(value)) !== null) {
        const text = m[0];
        if (text.length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        const groups = m.groups;
        if (!groups) continue;
        for (const name in groups) {
          if (groups[name] !== undefined) {
            const hit = patternRules.byGroupName.get(name);
            if (hit) found.push({ index: m.index, text, hit, order: 1 });
            break;
          }
        }
      }
    }

    if (found.length === 0) return 0;

    // 隐藏区里的命中不计入结果。放在正则命中之后判断：checkVisibility 会触发样式计算，
    // 只对真正命中的少数节点调用，避免遍历全页文本时逐节点做布局查询。
    if (this.ignoreHidden && !isRendered(node)) {
      this.hiddenSkipped += found.length;
      return 0;
    }

    // 合并为非重叠：位置升序 → 长优先（主要处理字面词与正则词在同一位置重叠的情形；
    // 同一管线内的重叠早已被正则备选项的「从左到右取首个命中」定掉）→ 字面优先
    found.sort(
      (a, b) =>
        a.index - b.index ||
        b.index + b.text.length - (a.index + a.text.length) ||
        a.order - b.order,
    );

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let matched = 0;
    // 中文整词校验用的分词段表：首次遇到中文词命中时才构建，供本节点所有命中复用
    let wordSpans: Array<[number, number]> | null | undefined;

    for (const item of found) {
      if (item.index < cursor) continue; // 与已命中重叠，跳过
      // 整词校验（正则关键词跳过）：中文看首字、拉丁词看首尾
      if (item.hit.wordMode !== 'none') {
        if (wordSpans === undefined) wordSpans = buildWordSpans(value);
        if (!passesWordCheck(wordSpans, item.hit.wordMode, item.index, item.text.length)) continue;
      }
      if (item.index > cursor) {
        fragment.appendChild(document.createTextNode(value.slice(cursor, item.index)));
      }
      const mark = document.createElement('span');
      mark.className = 'kwa-mark';
      mark.dataset.kwaMark = '';
      mark.dataset.kwaLevel = item.hit.levelId;
      mark.dataset.kwaGroup = item.hit.groupId;
      mark.dataset.kwaKeyword = item.hit.keyword;
      mark.dataset.kwaText = item.text;
      mark.textContent = item.text;
      fragment.appendChild(mark);
      this.marks.push(mark);
      cursor = item.index + item.text.length;
      matched += 1;
    }

    if (matched === 0) return 0;
    if (cursor < value.length) {
      fragment.appendChild(document.createTextNode(value.slice(cursor)));
    }
    node.replaceWith(fragment);
    return matched;
  }

  /** 还原页面 DOM */
  clear(): void {
    const marks = this.marks.filter((mark) => mark.isConnected);
    const parents = new Set<Node>();
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parents.add(parent);
      mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
    }
    for (const parent of parents) {
      if (parent instanceof Element) parent.normalize();
      else if (parent instanceof Document) parent.normalize();
    }
    this.marks = [];
    this.pendingViewport.clear();
    this.hiddenSkipped = 0;
    this.resumeRoot = null;
    this.resumeAnchor = null;
  }

  /** 让某个命中项可见（取消过滤态） */
  private visibleMarks(activeLevelIds: string[]): HTMLElement[] {
    const live = this.liveMarks();
    if (activeLevelIds.length === 0) return live;
    const allowed = new Set(activeLevelIds);
    return live.filter((mark) => allowed.has(mark.dataset.kwaLevel ?? ''));
  }

  /** 按档位过滤显示：未选中的档位取消高亮样式（文本保留） */
  applyLevelFilter(activeLevelIds: string[]): void {
    const allowed = activeLevelIds.length > 0 ? new Set(activeLevelIds) : null;
    for (const mark of this.liveMarks()) {
      const levelId = mark.dataset.kwaLevel ?? '';
      mark.classList.toggle('kwa-muted', allowed !== null && !allowed.has(levelId));
    }
  }

  /** 定位到第 index 个（在过滤集合内）命中项 */
  focus(index: number, activeLevelIds: string[]): boolean {
    const marks = this.visibleMarks(activeLevelIds);
    if (marks.length === 0) return false;
    const target = marks[Math.max(0, Math.min(index, marks.length - 1))];
    if (!target) return false;
    scrollElementIntoView(target);
    target.classList.add('kwa-flash');
    window.setTimeout(() => target.classList.remove('kwa-flash'), 1700);
    return true;
  }

  /** 某个 mark 在过滤集合中的序号，找不到返回 -1 */
  indexOf(mark: HTMLElement, activeLevelIds: string[]): number {
    return this.visibleMarks(activeLevelIds).indexOf(mark);
  }

  /** 过滤集合内的命中总数 */
  visibleCount(activeLevelIds: string[]): number {
    return this.visibleMarks(activeLevelIds).length;
  }

  /** 过滤集合内第一个属于某分组的序号，找不到返回 -1 */
  indexOfGroup(groupId: string, activeLevelIds: string[]): number {
    return this.visibleMarks(activeLevelIds).findIndex(
      (mark) => mark.dataset.kwaGroup === groupId,
    );
  }

  /** 过滤集合内某个「关键词 + 分组」命中的序号，找不到返回 -1 */
  indexOfHit(keyword: string, groupId: string, activeLevelIds: string[]): number {
    return this.visibleMarks(activeLevelIds).findIndex(
      (mark) => mark.dataset.kwaKeyword === keyword && mark.dataset.kwaGroup === groupId,
    );
  }

  stats(settings: Settings, url: string, truncated: boolean, ruleErrors: string[]): StatsSnapshot {
    const marks = this.liveMarks();
    const levelCounter = new Map<string, number>();
    const groupCounter = new Map<string, number>();
    for (const mark of marks) {
      const levelId = mark.dataset.kwaLevel ?? '';
      const groupId = mark.dataset.kwaGroup ?? '';
      levelCounter.set(levelId, (levelCounter.get(levelId) ?? 0) + 1);
      groupCounter.set(groupId, (groupCounter.get(groupId) ?? 0) + 1);
    }

    const levels: LevelCount[] = settings.levels.map((level, rank) => ({
      id: level.id,
      name: level.name,
      color: level.color,
      action: level.action ?? 'verify',
      rank,
      count: levelCounter.get(level.id) ?? 0,
    }));

    const groups: GroupCount[] = settings.groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        levelId: group.levelId,
        count: groupCounter.get(group.id) ?? 0,
      }))
      .filter((group) => group.count > 0);

    // 按「关键词 + 分组」聚合，供审核问题清单使用
    const hitCounter = new Map<string, HitSummary>();
    for (const mark of marks) {
      const keyword = mark.dataset.kwaKeyword ?? '';
      const groupId = mark.dataset.kwaGroup ?? '';
      const key = `${groupId}\u0000${keyword}`;
      const existing = hitCounter.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const group = settings.groups.find((item) => item.id === groupId);
      hitCounter.set(key, {
        keyword,
        sample: mark.dataset.kwaText ?? keyword,
        groupId,
        groupName: group?.name ?? '未分组',
        levelId: mark.dataset.kwaLevel ?? '',
        clause: group?.clause,
        advice: group?.advice,
        count: 1,
      });
    }

    // 清单排序：先按行为级别（阻断 → 待核实 → 提示），同级按处置优先级（即档位顺序）
    const KIND_WEIGHT: Record<ActionKind, number> = { block: 0, review: 1, hint: 2 };
    const orderOf = new Map(
      settings.levels.map((level, index) => [
        level.id,
        { weight: KIND_WEIGHT[actionKind(level.action)], rank: index },
      ]),
    );
    const hits = [...hitCounter.values()].sort((a, b) => {
      const orderA = orderOf.get(a.levelId) ?? { weight: 9, rank: 99 };
      const orderB = orderOf.get(b.levelId) ?? { weight: 9, rank: 99 };
      if (orderA.weight !== orderB.weight) return orderA.weight - orderB.weight;
      if (orderA.rank !== orderB.rank) return orderA.rank - orderB.rank;
      return b.count - a.count;
    });

    return {
      url,
      total: marks.length,
      truncated,
      hiddenSkipped: this.hiddenSkipped,
      levels,
      groups,
      hits,
      ruleErrors,
    };
  }
}
