import { reactive } from 'vue';
import type { GotoDirection } from './messages';
import type { TabStatsSummary } from './messages';
import { EMPTY_STATS, type PanelCorner, type StatsSnapshot } from './types';
import type { Verdict } from './verdict';

/** 浮出提示卡（点击发布/驳回类按钮时出现，不阻止原操作） */
export interface TriggerToast {
  visible: boolean;
  /** 视口坐标 */
  x: number;
  y: number;
  title: string;
  lines: string[];
}

/** 面板可调用的动作，由内容脚本在初始化时注入实现 */
export interface PanelActions {
  goto(direction: GotoDirection): void;
  rescan(): void;
  toggleLevel(levelId: string): void;
  focusGroup(groupId: string): void;
  focusHit(keyword: string, groupId: string): void;
  copyReport(): void;
  toggleCollapse(): void;
  hide(): void;
  dismissToast(): void;
}

/** 面板与内容脚本共享的响应式状态（同一 bundle 内是模块单例） */
export const panelState = reactive({
  /** 当前页面是否处于生效状态 */
  active: false,
  /** 是否显示面板卡片（iframe 内或用户关闭时为 false，但浮出提示卡仍可用） */
  visible: true,
  collapsed: false,
  corner: 'top-right' as PanelCorner,
  stats: { ...EMPTY_STATS } as StatsSnapshot,
  /** 跨 frame 汇总：iframe 内的命中不在本 frame 的清单里，仅用于对齐口径 */
  frames: { frameCount: 1, total: 0, otherTotal: 0 } as TabStatsSummary,
  verdict: null as Verdict | null,
  /** 当前定位序号（1 起，0 表示未定位） */
  cursor: 0,
  cursorTotal: 0,
  /** 空数组表示「全部档位」 */
  activeLevelIds: [] as string[],
  copyState: '' as '' | 'ok' | 'fail',
  toast: { visible: false, x: 0, y: 0, title: '', lines: [] } as TriggerToast,
});

export const panelActions: PanelActions = {
  goto: () => {},
  rescan: () => {},
  toggleLevel: () => {},
  focusGroup: () => {},
  focusHit: () => {},
  copyReport: () => {},
  toggleCollapse: () => {},
  hide: () => {},
  dismissToast: () => {},
};
