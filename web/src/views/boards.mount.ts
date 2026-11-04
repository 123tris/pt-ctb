// The Mods and Top plays tabs' browser half: the source and mod chips redraw the board, and the filter box and the
// inactive-players checkbox hide rows by name and mark, as the old page does, all kept in the address.

import type { Ctx } from '../kernel/ctx.ts';
import { announce, writeQuery } from '../client/legacy.ts';
import { setPressed } from '../client/dom.ts';
import { emptyFiltered, resultCount } from '../ui/page.ts';
import { board, queryDefaults, type Data, type State } from './boards.ts';

export function mount(root: HTMLElement, ctx: Ctx, data: Data, start: State): void {
  const { t } = ctx;
  const state = { ...start };
  const boardEl = root.querySelector<HTMLElement>('#board')!;
  const filter = root.querySelector<HTMLInputElement>('#filter')!;
  const legends = root.querySelector<HTMLInputElement>('#legends');
  const count = root.querySelector<HTMLElement>('#count')!;
  const emptyEl = root.querySelector<HTMLElement>('#board-empty')!;
  const filtered = data.slug === 'mods' || Boolean(data.plays);

  const saveQuery = () => writeQuery({
    q: filter.value.trim(), legends: legends && !legends.checked ? '0' : '', ...(filtered ? { src: state.source, mod: state.mod } : {}),
  }, queryDefaults(data));

  const applyFilter = ({ speak = false } = {}) => {
    const q = filter.value.trim().toLowerCase();
    const rows = [...boardEl.querySelectorAll<HTMLElement>('[data-name]')];
    let shown = 0;
    for (const row of rows) {
      const hide = Boolean(q && !row.dataset.name!.includes(q)) || Boolean(legends && !legends.checked && row.classList.contains('inactive'));
      row.classList.toggle('hidden', hide);
      if (!hide) shown++;
    }
    const text = rows.length ? resultCount(ctx, shown, rows.length, data.slug === 'plays' ? 'play' : 'player') : '';
    count.textContent = text;
    // A filter that matches nobody says so (with the way back) instead of leaving a table of headers.
    boardEl.querySelector('.table-wrap, .rows')?.classList.toggle('hidden', rows.length > 0 && !shown);
    const query = filter.value.trim();
    emptyEl.innerHTML = rows.length && !shown ? String(emptyFiltered(ctx, query
      ? (data.slug === 'plays' ? t('No player in these top plays matches “{q}”.', { q: query }) : t('No player on this leaderboard matches “{q}”.', { q: query }))
      : t('Nobody here is active right now.'))) : '';
    if (speak) announce(text);
  };

  const draw = ({ speak = false } = {}) => {
    setPressed(root, 'src', state.source);
    setPressed(root, 'mod', state.mod);
    boardEl.innerHTML = String(board(ctx, data, state));
    applyFilter({ speak });
    saveQuery();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  filter.addEventListener('input', () => {
    applyFilter();
    clearTimeout(timer);
    timer = setTimeout(() => { saveQuery(); announce(count.textContent ?? ''); }, 400);
  });
  legends?.addEventListener('change', () => { applyFilter({ speak: true }); saveQuery(); });
  emptyEl.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-clear]')) return;
    filter.value = '';
    if (legends) legends.checked = true;
    applyFilter({ speak: true });
    saveQuery();
    filter.focus();
  });
  root.querySelector('#sources')?.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-src]');
    if (b) { state.source = b.dataset.src!; draw({ speak: true }); }
  });
  root.querySelector('#modchips')?.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-mod]');
    if (b) { state.mod = b.dataset.mod!; draw({ speak: true }); }
  });
  if (filtered) { applyFilter(); saveQuery(); }
}
