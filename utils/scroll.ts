/**
 * 把元素滚动到视口（或滚动容器）中间。
 *
 * 只用原生 `scrollIntoView` 并不够：审核后台常见的
 * 「外层 overflow:hidden + 内层 div 滚动」布局里，原生 API 会被
 * 不可滚动的中间层截断，表现为「点了没反应」。
 * 所以这里先让浏览器滚一遍，再逐级兜底修正所有可滚动祖先。
 */
export function scrollElementIntoView(el: HTMLElement): void {
  // 瞬时滚动（不用 smooth）：保证下面的位置测量是准确的
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    el.scrollIntoView();
  }

  let parent = el.parentElement;
  while (parent && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const scrollableY =
      /(auto|scroll|overlay|hidden)/.test(style.overflowY) &&
      parent.scrollHeight - parent.clientHeight > 4;

    if (scrollableY) {
      const rect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const delta = rect.top - parentRect.top - parent.clientHeight / 2 + rect.height / 2;
      if (Math.abs(delta) > 8) parent.scrollTop += delta;
    }
    parent = parent.parentElement;
  }
}
