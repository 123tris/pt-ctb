// The players page's browser half (players.ts draws it): the search box, the sort and the pager, kept in the address
// (the header search's "all results" link fills in ?q=).
//
// paginate() takes over the list, so it draws the first page again as it starts: the same markup, before the browser
// has painted, in exchange for the old page's paging (focus, scroll and the spoken page number) as it was.

import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { PAGE_SIZE, visibleRows, countText, noMatch, cards, type Sort, type State } from './players.ts';
import { paginate } from '../client/dom.ts';
import { announce, writeQuery } from '../client/legacy.ts';

export function mount(root: HTMLElement, ctx: Ctx, core: CorePack, state: State): void {
  const q = root.querySelector<HTMLInputElement>('#q')!;
  const sort = root.querySelector<HTMLSelectElement>('#sort')!;
  const count = root.querySelector('#count')!;
  const list = root.querySelector<HTMLElement>('#list')!;
  let page = state.page;
  const save = () => writeQuery({ q: q.value.trim(), sort: sort.value, page: page + 1 }, { sort: 'cv', page: 1 });
  const visible = () => visibleRows(core, q.value, sort.value as Sort);
  let items = visible();
  const showCount = () => {
    count.textContent = countText(ctx, core, items.length);
    announce(count.textContent);
  };
  const redraw = paginate(ctx, list, items, slice => cards(ctx, core, slice), PAGE_SIZE, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => noMatch(ctx, q.value),
  });
  const refilter = () => { items = visible(); redraw(items); showCount(); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refilter, 200); });
  sort.addEventListener('change', refilter);
  list.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-clear]')) return;
    q.value = '';
    refilter();
    q.focus();
  });
}
