import type { StatsSnapshot } from './types';

/** 消息类型常量 */
export const MSG = {
  /** content → background：上报统计（用于 badge） */
  STATS: 'kwa:stats',
  /** popup → content：获取当前页统计 */
  GET_STATS: 'kwa:get-stats',
  /** popup → content：重新扫描 */
  RESCAN: 'kwa:rescan',
  /** popup → content：定位命中项 */
  GOTO: 'kwa:goto',
  /** popup → background：查询该 tab 的跨 frame 汇总 */
  TAB_STATS: 'kwa:tab-stats',
  /** background → content（顶层）：推送该 tab 的跨 frame 汇总 */
  FRAME_STATS: 'kwa:frame-stats',
} as const;

export interface StatsMessage {
  type: typeof MSG.STATS;
  stats: StatsSnapshot;
}

export interface GetStatsMessage {
  type: typeof MSG.GET_STATS;
}

export interface RescanMessage {
  type: typeof MSG.RESCAN;
}

export type GotoDirection = 'next' | 'prev' | 'first';

export interface GotoMessage {
  type: typeof MSG.GOTO;
  direction: GotoDirection;
}

/** 跨 frame 汇总：让页内面板、popup 与扩展角标口径一致 */
export interface TabStatsSummary {
  /** 参与汇总的 frame 数（含顶层） */
  frameCount: number;
  /** 该 tab 下全部 frame 的命中总数（与扩展角标同源） */
  total: number;
  /** 除顶层 frame 之外的命中数，即 iframe 内的部分 */
  otherTotal: number;
}

/** popup → background：查询跨 frame 汇总 */
export interface TabStatsQueryMessage {
  type: typeof MSG.TAB_STATS;
  /** popup 不在 tab 内，需要显式带上 tabId */
  tabId?: number;
}

/** background → content（顶层）：推送跨 frame 汇总 */
export interface FrameStatsMessage {
  type: typeof MSG.FRAME_STATS;
  summary: TabStatsSummary;
}

/** popup → content */
export type ContentMessage = GetStatsMessage | RescanMessage | GotoMessage;

/** content / popup → background */
export type BackgroundMessage = StatsMessage | TabStatsQueryMessage;
