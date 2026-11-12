// The Ranked tab's browser half for its switch (the official board or the boards by year ranked, and which year) and
// for a year's board (ranked-years.ts draws it): the filter box, applied to the rows and kept in the address.

import type { Ctx } from '../kernel/ctx.ts';
import { announce, go, writeQuery } from '../client/ui.ts';
import { thisYear, yearHref } from './rankings.ts';
import { boardOf, filterNote, visible, type Data, type State } from './ranked-years.ts';

/** The control that moved to another board, to give focus back to once the new board is drawn in its place. */
let refocus: string | null = null;

/** The switch's chips and year menu: each choice is its own address (/rankings/ranked, /rankings/ranked/2024). */
export function wireRankedSwitch(root: HTMLElement, ctx: Ctx): void {
  const select = root.querySelector<HTMLSelectElement>('#ranked-year');
  root.querySelector('[data-ranked-view]')?.parentElement?.addEventListener('click', e => {
    const chip = (e.target as Element).closest<HTMLElement>('[data-ranked-view]');
    if (!chip || chip.getAttribute('aria-pressed') === 'true') return;
    refocus = `[data-ranked-view="${chip.dataset.rankedView}"]`;
    go(chip.dataset.rankedView === 'years' ? yearHref(thisYear(ctx)) : '/rankings/ranked');
  });
  select?.addEventListener('change', () => {
    refocus = '#ranked-year';
    go(yearHref(Number(select.value)));
  });
  if (refocus) {
    root.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
    refocus = null;
  }
}

export function mount(root: HTMLElement, ctx: Ctx, { core, years }: Data, state: State): void {
  wireRankedSwitch(root, ctx);
  const board = years && boardOf(years, state.year);
  const filter = root.querySelector<HTMLInputElement>('#filter');
  if (!years || !board || !filter) return;
  const count = root.querySelector('#count')!;
  const emptyEl = root.querySelector('#board-empty')!;
  const wrap = root.querySelector('#board .table-wrap');

  const apply = ({ speak = false } = {}) => {
    const shown = visible(core, years, board.from, board.count, filter.value);
    const rows = root.querySelectorAll('#board tbody tr');
    let n = 0;
    for (let i = 0; i < shown.length; i++) {
      rows[i]?.classList.toggle('hidden', !shown[i]);
      n += shown[i];
    }
    const note = filterNote(ctx, board.count, n, filter.value);
    count.textContent = note.count;
    wrap?.classList.toggle('hidden', !n);
    emptyEl.innerHTML = String(note.empty);
    if (speak) announce(note.count);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  filter.addEventListener('input', () => {
    apply();
    clearTimeout(timer);
    timer = setTimeout(() => {
      writeQuery({ q: filter.value.trim() });
      announce(count.textContent ?? '');
    }, 400);
  });
  emptyEl.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-clear]')) return;
    filter.value = '';
    apply({ speak: true });
    writeQuery({ q: '' });
    filter.focus();
  });

  // ?at=<player id>: bring that player's row into view.
  root.querySelector('#board tr.target:not(.hidden)')?.scrollIntoView({ block: 'center' });
}
