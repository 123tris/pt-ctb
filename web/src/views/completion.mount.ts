// The Completion tab's browser half: the sort, the star slider and the pages of the maps left, kept in the address. A
// new sort or range starts again from the first page. paginate() takes over the list, so it draws the page shown again
// as it starts: the same markup, before the browser has painted the first.

import type { Ctx } from '../kernel/ctx.ts';
import { ANY_STARS, formatStars, type StarRange } from '../ui/star-range.ts';
import { announce, writeQuery } from '../client/legacy.ts';
import { paginate } from '../client/dom.ts';
import { bindStarSlider } from '../client/star-slider.ts';
import { PAGE, countText, leftRows, noneLeft, visible, type Completion, type Sort, type State } from './completion.ts';

export function mount(panel: HTMLElement, ctx: Ctx, goal: Completion | null, start: State): void {
  if (!goal?.left.length) return;
  const sort = panel.querySelector<HTMLSelectElement>('#left-sort')!;
  const count = panel.querySelector<HTMLElement>('#left-count')!;
  const list = panel.querySelector<HTMLElement>('#left-list')!;
  let stars: StarRange = start.stars;
  let sortKey: Sort = start.sort;
  let page = start.page;
  let items = visible(ctx, goal, stars, sortKey);

  const save = () => writeQuery({ sort: sortKey, stars: formatStars(stars), page: page + 1 }, { sort: 'popular', page: 1 });
  const redraw = paginate(ctx, list, items, slice => leftRows(ctx, goal, slice), PAGE, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => noneLeft(ctx, stars),
  });
  // A new sort or range starts again from the first page (paginate's redraw, which saves it).
  const refilter = () => {
    items = visible(ctx, goal, stars, sortKey);
    redraw(items);
    count.textContent = countText(ctx, goal, items);
    announce(count.textContent);
  };
  sort.addEventListener('change', () => { sortKey = sort.value as Sort; refilter(); });
  const slider = bindStarSlider(panel, ctx, stars, next => { stars = next; refilter(); });
  list.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-clear]')) return;
    stars = ANY_STARS;
    slider.set(stars);
    refilter();
  });
}
