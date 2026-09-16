import { actionKind, type Level, type Settings } from './types';

const STYLE_ID = 'kwa-page-styles';
const TIP_ID = 'kwa-tip';

/**
 * 拼进 CSS 属性选择器前转义：引号与反斜杠必须转义，
 * 控制字符直接剔除——CSS 字符串里不允许裸换行，留着会让整条规则被解析器丢弃。
 */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, '\\$&').replace(/[\u0000-\u001f\u007f]/g, '');
}

/** 主色兜底：设置里的色值理论上已归一化，这里再挡一层，避免拼出非法声明 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function safeColor(color: string): string {
  return HEX_COLOR.test(color) ? color : '#64748b';
}

export type Strength = 'strong' | 'medium' | 'weak' | 'plain';

/** 一个档位最终的视觉外观（由「档位样式」+「全局高亮形式」推导） */
export interface LevelAppearance {
  strength: Strength;
  /** 是否铺底色 */
  background: boolean;
  alpha: number;
  /** 下划线，null 表示不画 */
  underline: { width: number; style: 'solid' | 'dashed' | 'dotted' | 'wavy' } | null;
  /** 内描边（仅强档） */
  outline: boolean;
  /** 极简：只改文字颜色与字重，不碰背景 */
  textOnly: boolean;
}

/**
 * 档位外观强度。
 * - 显式指定（strong/medium/weak/plain）→ 直接用
 * - auto（默认）→ 跟随处置的行为级别：阻断=强、待核实=中、提示=弱
 */
export function resolveStrength(level: Level): Strength {
  switch (level.style) {
    case 'strong':
    case 'medium':
    case 'weak':
    case 'plain':
      return level.style;
    default: {
      const kind = actionKind(level.action);
      if (kind === 'block') return 'strong';
      if (kind === 'hint') return 'weak';
      return 'medium';
    }
  }
}

function alphaOf(strength: Strength): number {
  if (strength === 'strong') return 0.42;
  if (strength === 'weak') return 0.22;
  return 0.3;
}

export function resolveAppearance(level: Level): LevelAppearance {
  const strength = resolveStrength(level);

  if (strength === 'plain') {
    // 极简：不铺底色、不画下划线，只改文字颜色 + 加粗
    return { strength, background: false, alpha: 0, underline: null, outline: false, textOnly: true };
  }

  // 是否铺底色由「外观」决定：none 表示不铺底色
  const background = level.style !== 'none';
  // 线型（形式维度）：none 表示不画线
  const form = level.form ?? 'solid';
  const line = form === 'none' ? null : form;
  return {
    strength,
    background,
    alpha: alphaOf(strength),
    underline: line ? { width: 2, style: line } : null,
    outline: strength === 'strong' && background,
    textOnly: false,
  };
}

/** 供 popup 的档位预览使用：把外观转成内联样式 */
export function appearanceToInlineStyle(
  appearance: LevelAppearance,
  color: string,
): Record<string, string> {
  if (appearance.textOnly) {
    return { color, fontWeight: '600' };
  }

  const style: Record<string, string> = {};
  if (appearance.background) {
    style.background = `color-mix(in srgb, ${color} ${Math.round(appearance.alpha * 100)}%, transparent)`;
  }
  if (appearance.underline) {
    style.textDecoration = `underline ${appearance.underline.style}`;
    style.textDecorationColor = color;
    style.textDecorationThickness = `${appearance.underline.width}px`;
    style.textUnderlineOffset = '2px';
  }
  if (appearance.outline) {
    style.boxShadow = `inset 0 0 0 1px color-mix(in srgb, ${color} 60%, transparent)`;
  }
  return style;
}

function buildBaseCss(): string {
  return `
[data-kwa-mark] {
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
  border-radius: 3px;
  transition: background-color 0.15s ease;
}
[data-kwa-mark]:hover {
  background-color: color-mix(in srgb, var(--kwa-color) 55%, transparent) !important;
}
[data-kwa-mark].kwa-muted {
  background-color: transparent !important;
  box-shadow: none !important;
  text-decoration: none !important;
}
[data-kwa-mark].kwa-flash {
  animation: kwa-flash 0.55s ease-in-out 3;
}
@keyframes kwa-flash {
  0%,
  100% {
    outline: 2px solid transparent;
    outline-offset: 0;
  }
  50% {
    outline: 2px solid var(--kwa-color);
    outline-offset: 2px;
  }
}
#${TIP_ID} {
  position: fixed;
  z-index: 2147483601;
  display: none;
  max-width: 260px;
  padding: 6px 10px;
  border-radius: 8px;
  font: 12px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.28);
  pointer-events: none;
  white-space: nowrap;
}
#${TIP_ID} .kwa-tip-key {
  font-weight: 600;
}
#${TIP_ID} .kwa-tip-level {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  color: #0f172a;
}
`.trim();
}

/** 依据当前设置生成页面级样式（高亮 mark + 悬浮气泡） */
export function buildPageCss(settings: Settings): string {
  const { levels } = settings;
  const blocks: string[] = [buildBaseCss()];

  levels.forEach((level) => {
    const appearance = resolveAppearance(level);
    // 加 :not(.kwa-muted)：否则「按档位过滤」时两条规则特异性相同、后者覆盖前者
    const selector = `[data-kwa-mark][data-kwa-level="${escapeAttr(level.id)}"]:not(.kwa-muted)`;
    const decls: string[] = [`--kwa-color: ${safeColor(level.color)};`];

    if (appearance.textOnly) {
      decls.push(
        'color: var(--kwa-color) !important;',
        'font-weight: 600 !important;',
        'background-color: transparent !important;',
        'text-decoration: none !important;',
        'box-shadow: none !important;',
      );
    } else {
      if (appearance.background) {
        decls.push(
          `background-color: color-mix(in srgb, var(--kwa-color) ${Math.round(appearance.alpha * 100)}%, transparent) !important;`,
        );
      }
      if (appearance.underline) {
        decls.push(
          `text-decoration: underline ${appearance.underline.style} !important;`,
          `text-decoration-color: color-mix(in srgb, var(--kwa-color) 95%, transparent) !important;`,
          `text-decoration-thickness: ${appearance.underline.width}px !important;`,
          'text-underline-offset: 2px !important;',
        );
      }
      if (appearance.outline) {
        decls.push(
          'box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kwa-color) 60%, transparent) !important;',
        );
      }
    }

    blocks.push(`${selector} {\n  ${decls.join('\n  ')}\n}`);
  });

  return blocks.join('\n');
}

/**
 * 页面级样式必须注入到页面 DOM（高亮元素在页面里，不在 Shadow DOM 中），
 * 所以这里手动维护一个 style 标签。
 */
export function applyPageStyles(settings: Settings): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(el);
  }
  el.textContent = buildPageCss(settings);
}

export function removePageStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(TIP_ID)?.remove();
}

/** 命中项悬浮气泡（页面级元素，故样式随页面 CSS 一起注入） */
export function showTip(target: HTMLElement, keyword: string, levelName: string, color: string): void {
  let tip = document.getElementById(TIP_ID) as HTMLDivElement | null;
  if (!tip) {
    tip = document.createElement('div');
    tip.id = TIP_ID;
    document.body.appendChild(tip);
  }
  tip.innerHTML = '';
  const key = document.createElement('span');
  key.className = 'kwa-tip-key';
  key.textContent = keyword;
  const level = document.createElement('span');
  level.className = 'kwa-tip-level';
  level.textContent = levelName;
  level.style.background = color;
  tip.append(key, level);
  tip.style.display = 'block';

  const rect = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let top = rect.top - tipRect.height - 8;
  if (top < 4) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - tipRect.width - 6));
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
}

export function hideTip(): void {
  const tip = document.getElementById(TIP_ID);
  if (tip) tip.style.display = 'none';
}
