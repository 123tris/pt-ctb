// The leaderboards' browser half (rankings.ts draws them): the rest of the board's rows after the first paint, and the
// filter box and the inactive-players checkbox, applied to the rows by their order on the board and kept in the address.

import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { BOARD_CAT, FIRST_ROWS, boardBody, boardRows, visible, filterNote, type State } from './rankings.ts';
import { announce, writeQuery } from '../client/ui.ts';
import { addInFrames } from '../client/dom.ts';
import { wireRankedSwitch } from './ranked-years.mount.ts';

/** `drawn`: how many of the board's rows render() drew; the rest are added here, a batch per frame. */
export function mount(root: HTMLElement, ctx: Ctx, core: CorePack, state: State, drawn = Infinity): void {
  const board = root.querySelector('#board')!;
  const filter = root.querySelector<HTMLInputElement>('#filter')!;
  const legends = root.querySelector<HTMLInputElement>('#legends');
  const count = root.querySelector('#count')!;
  const emptyEl = root.querySelector('#board-empty')!;
  const wrap = board.querySelector('.table-wrap');
  const tbody = board.querySelector('tbody');
  const cat = BOARD_CAT[state.slug];
  const total = boardRows(core, cat).length;
  const legendsOn = () => legends?.checked ?? true;
  if (state.slug === 'ranked') wireRankedSwitch(root, ctx);

  const saveQuery = () => writeQuery({ q: filter.value.trim(), legends: legends && !legends.checked ? '0' : '' });
  const apply = ({ speak = false } = {}) => {
    const shown = visible(ctx, core, cat, filter.value, legendsOn());
    const rows = board.querySelectorAll('tbody tr');
    let n = 0;
    for (let i = 0; i < shown.length; i++) {
      rows[i]?.classList.toggle('hidden', !shown[i]);
      n += shown[i];
    }
    const note = filterNote(ctx, total, n, filter.value);
    count.textContent = note.count;
    // A filter that matches nobody says so (with the way back) instead of leaving a table of headers.
    wrap?.classList.toggle('hidden', total > 0 && !n);
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

  // The rest of the board, filtered as the boxes are when each batch goes in.
  if (tbody && drawn < total) {
    addInFrames(tbody, drawn, total, FIRST_ROWS,
      (from, to) => boardBody(ctx, core, state, visible(ctx, core, cat, filter.value, legendsOn()), from, to).join(''));
  }
}
