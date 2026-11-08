// The Duels tab's browser half: the ladder's pages, and the latest duels' filter and pages, kept in the address. A new
// filter starts again from the first page. paginate() takes over each list, so it draws the page shown again as it
// starts: the same markup, before the browser has painted the first.

import type { Ctx } from '../kernel/ctx.ts';
import type { Players } from '../ui/players.ts';
import type { DuelsFile } from '../ui/duels.ts';
import { announce, writeQuery } from '../client/ui.ts';
import { paginate, setPressed } from '../client/dom.ts';
import { DUELS_PAGE, LADDER_PAGE, countText, duelRows, ladderTable, noneOfKind, shownDuels, type Kind, type State } from './duels.ts';

export function mount(panel: HTMLElement, ctx: Ctx, duels: DuelsFile, players: Players, start: State): void {
  const ladder = panel.querySelector<HTMLElement>('#duel-ladder');
  if (ladder) paginate(ctx, ladder, duels.ladder, slice => ladderTable(ctx, slice, players), LADDER_PAGE);
  if (!duels.recent.length) return;

  const chips = panel.querySelector<HTMLElement>('#duel-kinds')!;
  const count = panel.querySelector<HTMLElement>('#duel-count')!;
  const list = panel.querySelector<HTMLElement>('#duel-list')!;
  let kind: Kind = start.kind;
  let page = start.page;
  let items = shownDuels(ctx, duels, kind);

  const save = () => writeQuery({ duels: kind, page: page + 1 }, { duels: 'all', page: 1 });
  const redraw = paginate(ctx, list, items, slice => duelRows(ctx, players, slice), DUELS_PAGE, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => noneOfKind(ctx),
  });
  const refilter = () => {
    items = shownDuels(ctx, duels, kind);
    setPressed(chips, 'duels', kind);
    redraw(items);
    count.textContent = countText(ctx, duels, items);
    announce(count.textContent);
  };
  chips.addEventListener('click', e => {
    const chip = (e.target as Element).closest<HTMLElement>('[data-duels]');
    if (chip) { kind = chip.dataset.duels as Kind; refilter(); }
  });
  list.addEventListener('click', e => {
    if ((e.target as Element).closest('[data-clear]')) { kind = 'all'; refilter(); }
  });
}
