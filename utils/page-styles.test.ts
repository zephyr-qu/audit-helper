import { describe, expect, it } from 'vitest';
import { appearanceToInlineStyle, buildPageCss, resolveAppearance, resolveStrength } from './page-styles';
import { makeLevels, makeSettings } from './test-fixtures';
import type { Level } from './types';

function level(overrides: Partial<Level> = {}): Level {
  return { id: 'lv_x', name: '档位', color: '#ef4444', style: 'auto', form: 'solid', action: 'reject', ...overrides };
}

describe('resolveStrength', () => {
  it('auto 跟随处置的行为级别', () => {
    const [reject, , verify, hint] = makeLevels();
    expect(resolveStrength(reject!)).toBe('strong');
    expect(resolveStrength(verify!)).toBe('medium');
    expect(resolveStrength(hint!)).toBe('weak');
  });

  it('显式指定外观时直接采用', () => {
    expect(resolveStrength(level({ style: 'plain' }))).toBe('plain');
    expect(resolveStrength(level({ style: 'weak', action: 'reject' }))).toBe('weak');
  });
});

describe('resolveAppearance', () => {
  it('极简只改文字，不铺底色也不画线', () => {
    const appearance = resolveAppearance(level({ style: 'plain' }));
    expect(appearance.textOnly).toBe(true);
    expect(appearance.background).toBe(false);
    expect(appearance.underline).toBeNull();
  });

  it('无底色 + 无线型时不画任何装饰', () => {
    const appearance = resolveAppearance(level({ style: 'none', form: 'none' }));
    expect(appearance.background).toBe(false);
    expect(appearance.underline).toBeNull();
  });

  it('强档默认铺底色并加内描边', () => {
    const appearance = resolveAppearance(level());
    expect(appearance.background).toBe(true);
    expect(appearance.outline).toBe(true);
    expect(appearance.underline?.style).toBe('solid');
  });

  it('appearanceToInlineStyle 把外观转成内联样式', () => {
    expect(appearanceToInlineStyle(resolveAppearance(level({ style: 'plain' })), '#ef4444')).toEqual({
      color: '#ef4444',
      fontWeight: '600',
    });
    expect(appearanceToInlineStyle(resolveAppearance(level({ form: 'wavy' })), '#ef4444')).toMatchObject({
      textDecoration: 'underline wavy',
      textDecorationColor: '#ef4444',
    });
  });
});

describe('buildPageCss', () => {
  it('每个档位生成一条带 :not(.kwa-muted) 的规则', () => {
    const css = buildPageCss(makeSettings());
    expect(css).toContain('[data-kwa-mark][data-kwa-level="lv_reject"]:not(.kwa-muted)');
    expect(css).toContain('--kwa-color: #ef4444;');
    expect(css).toContain('background-color: color-mix');
  });

  it('档位 id 里的引号被转义、控制字符被剔除，不会拼出额外选择器', () => {
    const css = buildPageCss(makeSettings({ levels: [level({ id: 'a"\n}"x' })] }));
    expect(css).toContain('[data-kwa-level="a\\"}\\"x"]');
    expect(css).not.toContain('a"}"x');
  });

  it('非法色值回落到灰色，不会拼出额外声明', () => {
    const css = buildPageCss(makeSettings({ levels: [level({ color: 'red; background:url(x)' })] }));
    expect(css).toContain('--kwa-color: #64748b;');
    expect(css).not.toContain('url(x)');
  });
});
