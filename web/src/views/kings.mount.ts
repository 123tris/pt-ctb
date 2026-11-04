// The Star kings tab's browser half: choosing a range or source redraws the board (kept in the address), and the moves
// between the kings and a range's board keep the place: back to the board's link, or up to the heading.

import type { Ctx } from '../kernel/ctx.ts';
import { announce, setTitle, writeQuery } from '../client/legacy.ts';
import { setPressed } from '../client/dom.ts';
import { boardCount, boardHref, boardTable, rangeText, title, viewKey, type Data, type Source, type State } from './kings.ts';

/** The address's query for a view key, for the usage counts' record of filters (core/track.js). */
const viewQuery = (key: string | undefined) => {
  if (!key || key === 'all') return {};
  const [stars, source] = key.split(':');
  return source === 'catch' ? { stars } : { stars, src: source };
};

/** The view the page showed before this one (keep), for an in-page move. */
export const keep = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-kings]')?.dataset.kings;

export function mount(root: HTMLElement, ctx: Ctx, { core, kings }: Data, start: State, before: string | undefined): void {
  const { t, fmt } = ctx;
  if (start.stars === null || !kings) {
    const titles = kings ? Object.values(kings).reduce((n, rows) => n + rows.length, 0) : 0;
    announce(t('{titles} across catch maps and converts.', { titles: fmt.plural(titles, 'star title') }));
    // Back from a board: return to its link instead of wherever the shorter board left the scroll.
    if (before && before !== 'all') {
      const [stars, source] = before.split(':');
      const from = root.querySelector<HTMLElement>(`a[href="${boardHref(stars, source)}"]`);
      if (from) {
        from.focus({ preventScroll: true });
        from.scrollIntoView({ block: 'center', behavior: 'instant' });
        window.dispatchEvent(new CustomEvent('ptctb:query', { detail: { before: viewQuery(before), after: {} } }));
      }
    }
    return;
  }

  const state = { ...start, stars: start.stars };
  const view = root.querySelector<HTMLElement>('[data-kings]')!;
  const boardEl = root.querySelector<HTMLElement>('#kings-board')!;
  const count = root.querySelector<HTMLElement>('#kings-count')!;
  const draw = ({ speak = false, redraw = true } = {}) => {
    view.dataset.kings = viewKey(state.stars, state.source);
    setPressed(root, 'src', state.source);
    setTitle(title(ctx, state));
    if (redraw) {
      boardEl.innerHTML = String(boardTable(ctx, core, kings, state.stars, state.source));
      count.textContent = boardCount(ctx, kings, state.stars, state.source);
    }
    writeQuery({ stars: state.stars, src: state.source }, { src: 'catch' });
    const maps = state.source === 'catch' ? t('catch maps') : t('converts');
    if (speak) announce(count.textContent || t('No #1s on {maps} {range} yet.', { maps, range: rangeText(ctx, state.stars) }));
  };
  draw({ speak: true, redraw: false });
  root.querySelector<HTMLSelectElement>('#kings-stars')!.addEventListener('change', e => {
    state.stars = Number((e.target as HTMLSelectElement).value);
    draw({ speak: true });
  });
  view.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-src]');
    if (b && b.dataset.src !== state.source) { state.source = b.dataset.src as Source; draw({ speak: true }); }
  });

  // Opened from the kings (same page, so the router neither scrolls, moves focus nor counts it): do all three here.
  if (before === 'all') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const h1 = root.querySelector('h1');
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    window.dispatchEvent(new CustomEvent('ptctb:query', { detail: { before: {}, after: viewQuery(view.dataset.kings) } }));
  }
}
