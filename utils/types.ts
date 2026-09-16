/**
 * 关键字审查：共享类型定义。
 */

/**
 * 档位外观（底色的浓淡程度）。
 * auto/strong/medium/weak 是不同程度的底色；plain 极简（只改文字）；
 * none 不铺底色（仍可画下划线）。
 */
export type LevelStyle = 'auto' | 'strong' | 'medium' | 'weak' | 'plain' | 'none';

/**
 * 命中处置动作 —— 档位的业务措辞，对应《招聘行为管理规范》第六章的管理措施。
 * 每种动作都归入一个「行为级别」（见 ACTION_KIND），由行为级别决定系统行为。
 */
export type LevelAction =
  | 'reject' // 建议驳回      6.4 驳回删除类
  | 'revise' // 退回修改      6.4 要求调整修改
  | 'verify' // 人工核实
  | 'qualify' // 补充资质    6.2 资质核验类
  | 'warn' // 教育警示       6.5 教育警示类
  | 'hint'; // 仅作提示

/** 行为级别：只有三档，决定结论、角标与排序 */
export type ActionKind = 'block' | 'review' | 'hint';

export const ACTION_LABEL: Record<LevelAction, string> = {
  reject: '建议驳回',
  revise: '退回修改',
  verify: '人工核实',
  qualify: '补充资质',
  warn: '教育警示',
  hint: '仅作提示',
};

export const ACTION_KIND: Record<LevelAction, ActionKind> = {
  reject: 'block',
  revise: 'block',
  verify: 'review',
  qualify: 'review',
  warn: 'review',
  hint: 'hint',
};

export function actionKind(action: LevelAction | undefined): ActionKind {
  return action ? ACTION_KIND[action] : 'review';
}

/**
 * 档位。有序数组，索引即显示顺序，顺序由处置动作的优先级决定
 * （没有拖拽 / 手动排序入口）。
 */
export interface Level {
  id: string;
  /** 档位名称，如「建议驳回」「人工核实」 */
  name: string;
  /** 主色，其余色值由它派生 */
  color: string;
  /** 高亮外观（纯表现层） */
  style?: LevelStyle;
  /** 高亮线型（下划线线型） */
  form?: HighlightStyle;
  /** 命中处置动作（系统语义） */
  action?: LevelAction;
}

/** 关键词分组：对应一类审核问题，颜色与轻重由所属档位决定。 */
export interface KeywordGroup {
  id: string;
  name: string;
  levelId: string;
  enabled: boolean;
  keywords: string[];
  /** 该组关键词按正则解释（覆盖全局 match.useRegex） */
  useRegex?: boolean;
  /** 官方条款依据，如「5.13.2」 */
  clause?: string;
  /** 处理建议 */
  advice?: string;
}

/** 下划线线型（形式维度）：none 表示不画线、仅靠底色呈现 */
export type HighlightStyle = 'none' | 'solid' | 'dashed' | 'dotted' | 'wavy';

export type PanelCorner = 'top-right' | 'bottom-right';

export interface MatchSettings {
  /** 大小写敏感 */
  caseSensitive: boolean;
  /** 整词匹配（中英文边界） */
  wholeWord: boolean;
  /** 关键词默认按正则解释 */
  useRegex: boolean;
  /** 中文整词：按分词判断独立成词，避免「专家教你」跨词拼出「家教」这类误命中 */
  chineseWord: boolean;
  /** 英文整词：按分词判断字母数字词是否独立成词，避免「spa」命中「spaces」、「996」命中「1996」 */
  englishWord: boolean;
}

/** 点击「发布/驳回/通过」这类按钮时浮出的提示卡 */
export interface TriggerSettings {
  enabled: boolean;
  /** 需要监听的按钮文案 */
  buttonTexts: string[];
  /** 自动消失时间（毫秒），0 表示不自动消失 */
  duration: number;
}

export interface Settings {
  /** 总开关 */
  enabled: boolean;
  /** 生效范围：全部站点 / 仅指定站点 / 除以下站点外 */
  siteMode: 'all' | 'include' | 'exclude';
  /** 生效站点，支持精确域名与 *.example.com */
  sites: string[];
  /** 排除站点（siteMode 为 exclude 时生效），格式同 sites */
  excludedSites: string[];
  levels: Level[];
  groups: KeywordGroup[];
  match: MatchSettings;
  panel: { show: boolean; corner: PanelCorner; collapsed: boolean };
  trigger: TriggerSettings;
  /** 监听动态内容（分页、懒加载） */
  dynamic: boolean;
  /** 扫描模式：auto 实时扫描（含动态监听）；manual 仅手动点「重扫」时扫描 */
  scanMode: 'auto' | 'manual';
  /** 排除 iframe：不在嵌入的子框架内运行审查（只审查顶层页面） */
  skipIframes: boolean;
  /** 视口懒扫描：只扫描当前可见区域，滚动到时再扫视口外内容 */
  viewportOnly: boolean;
  /** 忽略隐藏内容：display:none / visibility:hidden 容器里的命中不计入结果 */
  ignoreHidden: boolean;
  limits: { maxNodes: number; flushDelay: number };
}

export interface LevelCount {
  id: string;
  name: string;
  color: string;
  action: LevelAction;
  count: number;
  rank: number;
}

export interface GroupCount {
  id: string;
  name: string;
  levelId: string;
  count: number;
}

/** 按「关键词 + 分组」聚合后的命中项，用于审核问题清单 */
export interface HitSummary {
  /** 规则本身（正则组时是正则字符串） */
  keyword: string;
  /** 页面上实际命中的文本，用于展示 */
  sample: string;
  groupId: string;
  groupName: string;
  levelId: string;
  clause?: string;
  advice?: string;
  count: number;
}

/** 一次扫描后的统计快照 */
export interface StatsSnapshot {
  url: string;
  total: number;
  truncated: boolean;
  /** 因位于隐藏容器（display:none 等）而未被计入的命中数 */
  hiddenSkipped: number;
  levels: LevelCount[];
  groups: GroupCount[];
  hits: HitSummary[];
  /** 规则编译时的非法正则提示 */
  ruleErrors: string[];
}

export const EMPTY_STATS: StatsSnapshot = {
  url: '',
  total: 0,
  truncated: false,
  hiddenSkipped: 0,
  levels: [],
  groups: [],
  hits: [],
  ruleErrors: [],
};
