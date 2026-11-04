// The Maps page's browser half (maps.ts draws it): the search box, the sort, the category chips, the star slider and
// the pages. Each change searches again (a few milliseconds, ui/map-search.ts) and redraws just the list, from its
// first page. Search, sort, filters and page live in the address, so Back from a map returns to the same results.
// paginate() takes over the list, so it draws the first page again as it starts: the same markup, before the browser
// has painted the first.

import type { Ctx } from '../kernel/ctx.ts';
import { pageCount } from '../ui/page.ts';
import { ANY_STARS, formatStars, type StarRange } from '../ui/star-range.ts';
import { findMaps, mapText, type MapCat, type MapQuery, type MapSort } from '../ui/map-search.ts';
import { PAGE, mapRows, noMaps, countText, type Data, type State } from './maps.ts';
import { paginate, setPressed } from '../client/dom.ts';
import { bindStarSlider } from '../client/star-slider.ts';
import { announce, writeQuery } from '../client/legacy.ts';

export interface MountOptions {
  /** The address has an old ?diff=, to rewrite as the star range it now means. */
  rewrite: boolean;
  /** Whether this page is still the one open (the old router's isCurrent). */
  isCurrent(): boolean;
}

export function mount(root: HTMLElement, ctx: Ctx, data: Data, state: State, { rewrite, isCurrent }: MountOptions): void {
  const q = root.querySelector<HTMLInputElement>('#q')!;
  const sort = root.querySelector<HTMLSelectElement>('#sort')!;
  const count = root.querySelector('#count')!;
  const list = root.querySelector<HTMLElement>('#list')!;
  let cat: MapCat = state.cat;
  let stars: StarRange = state.stars;
  let results = findMaps(data.index, state);
  // A page past the end shows the last, as paginate() draws it.
  let page = Math.min(state.page, pageCount(results.length, PAGE) - 1);

  const query = (): MapQuery => ({ q: q.value, cat, stars, sort: sort.value as MapSort });
  const save = () =>
    writeQuery({ q: q.value.trim(), sort: sort.value, cat, stars: formatStars(stars), page: page + 1 }, { sort: 'players', page: 1 });
  const redraw = paginate(ctx, list, results, slice => mapRows(ctx, data, slice), PAGE, {
    page,
    onPage: p => {
      page = p;
      save();
    },
    empty: () => noMaps(ctx, query()),
  });
  // A new search, sort or filter: the results from their first page, the address, and the new count read out. A
  // search that comes due after the visitor has left the page does nothing.
  const refilter = () => {
    if (!isCurrent()) return;
    results = findMaps(data.index, query());
    redraw(results);
    count.textContent = countText(ctx, data, results);
    announce(count.textContent);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refilter, 200);
  });
  sort.addEventListener('change', refilter);
  root.querySelector('#cats')!.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat as MapCat;
    setPressed(root, 'cat', cat);
    refilter();
  });

  // The star slider: the list catches up once the thumbs rest.
  const slider = bindStarSlider(root, ctx, stars, next => {
    stars = next;
    refilter();
  });

  list.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-clear]')) return;
    q.value = '';
    cat = '';
    stars = ANY_STARS;
    setPressed(root, 'cat', cat);
    slider.set(stars);
    refilter();
    q.focus();
  });

  // An old ?diff= link is rewritten to the star range it now means.
  if (rewrite) save();

  // The text a search reads, made while the page is idle (a few tens of milliseconds), so the first word typed doesn't
  // wait for it.
  const warm = () => mapText(data.index);
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2000 });
  else setTimeout(warm, 300);
}
