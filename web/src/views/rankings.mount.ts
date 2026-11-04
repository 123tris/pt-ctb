// The leaderboards' browser half (rankings.ts draws them): the filter box and the inactive-players checkbox, applied to
// the rows that are already there, by their order on the board, and kept in the address.

import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { BOARD_CAT, visible, filterNote, type State } from './rankings.ts';
import { announce, writeQuery } from '../client/legacy.ts';

export function mount(root: HTMLElement, ctx: Ctx, core: CorePack, state: State): void {
  const board = root.querySelector('#board')!;
  const filter = root.querySelector<HTMLInputElement>('#filter')!;
  const legends = root.querySelector<HTMLInputElement>('#legends');
  const count = root.querySelector('#count')!;
  const emptyEl = root.querySelector('#board-empty')!;
  const wrap = board.querySelector('.table-wrap');
  const rows = board.querySelectorAll('tbody tr');
  const cat = BOARD_CAT[state.slug];

  const saveQuery = () => writeQuery({ q: filter.value.trim(), legends: legends && !legends.checked ? '0' : '' });
  const apply = ({ speak = false } = {}) => {
    const shown = visible(ctx, core, cat, filter.value, legends?.checked ?? true);
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('hidden', !shown[i]);
      n += shown[i];
    }
    const note = filterNote(ctx, rows.length, n, filter.value);
    count.textContent = note.count;
    // A filter that matches nobody says so (with the way back) instead of leaving a table of headers.
    wrap?.classList.toggle('hidden', rows.length > 0 && !n);
    emptyEl.innerHTML = String(note.empty);
    if (speak) announce(note.count);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  filter.addEventListener('input', () => {
    apply();
    clearTimeout(timer);
    timer = setTimeout(() => {
      saveQuery();
      announce(count.textContent ?? '');
    }, 400);
  });
  legends?.addEventListener('change', () => {
    apply({ speak: true });
    saveQuery();
  });
  emptyEl.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-clear]')) return;
    filter.value = '';
    if (legends) legends.checked = true;
    apply({ speak: true });
    saveQuery();
    filter.focus();
  });

  // ?at=<player id> (a profile's rank links here): bring that player's row into view.
  board.querySelector('tr.target:not(.hidden)')?.scrollIntoView({ block: 'center' });
}
