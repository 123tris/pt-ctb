// Small browser-only helpers for mount(): things that change the page after it's drawn.

import { html, raw, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { empty } from '../ui/page.ts';
import { announce, scrollBehavior } from './legacy.ts';

/** Marks the chip (or other toggle) whose data-`attr` equals `value` as pressed, the rest as not. */
export function setPressed(scope: ParentNode, attr: string, value: string | number): void {
  const key = attr.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  scope.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach(b => {
    const on = b.dataset[key] === String(value);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/**
 * Renders `items` a page at a time into `container`, with previous/next buttons, as ui.js paginate() does (whose
 * markup is the old html tag's, which would escape this client's). `render(slice, offset)` gives one page's markup.
 * Options: `page` to start on (0-based, e.g. from the address), `onPage(page)` when it changes, and `empty()` for the
 * markup when nothing matches. After paging, focus moves to the list and the new page is announced. Returns a function
 * that draws a new list from its first page, or `keepPage` for the same list grown longer (the full set arriving
 * after a first slice).
 */
export function paginate<T>(ctx: Ctx, container: HTMLElement, items: readonly T[], render: (slice: readonly T[], offset: number) => Value, size = 50,
  { page: start = 0, onPage, empty: emptyView }: { page?: number; onPage?: (page: number) => void; empty?: () => Value } = {},
): (newItems?: readonly T[], keepPage?: boolean) => void {
  const { t, fmt } = ctx;
  let page = Math.max(0, start);
  const pages = () => Math.max(1, Math.ceil(items.length / size));
  const pageOf = () => t('Page {page} of {pages}', { page: fmt.num(page + 1), pages: fmt.num(pages()) });
  const draw = () => {
    page = Math.min(page, pages() - 1);
    const slice = items.slice(page * size, page * size + size);
    container.innerHTML = String(html`${slice.length ? render(slice, page * size) : emptyView?.() ?? empty(t('Nothing to show.'))}
      ${pages() > 1 ? html`<nav class="pager" aria-label="${t('Pages')}">
        <button class="btn btn-small" type="button" data-page="prev" ${page === 0 ? raw('disabled') : ''}>← ${t('Previous')}</button>
        <span>${pageOf()}</span>
        <button class="btn btn-small" type="button" data-page="next" ${page >= pages() - 1 ? raw('disabled') : ''}>${t('Next')}</button>
      </nav>` : ''}`);
  };
  container.addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLElement>('[data-page]');
    if (!button || !container.contains(button)) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    draw();
    onPage?.(page);
    // The clicked button is gone; put focus at the top of the new page instead of dropping it to <body>.
    container.tabIndex = -1;
    container.focus({ preventScroll: true });
    container.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    announce(pageOf());
  });
  draw();
  return (newItems, keepPage = false) => {
    items = newItems ?? items;
    page = keepPage ? Math.min(page, pages() - 1) : 0;
    draw();
    onPage?.(page);
  };
}
