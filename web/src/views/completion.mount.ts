// The Completion tab's browser half: the year strip's hover and tap, and the sort, the year, the star slider and the
// pages of the maps left, kept in the address. A new sort, year or range starts again from the first page. paginate()
// takes over the list, so it draws the page shown again as it starts: the same markup, before the browser has painted
// the first.

import type { Ctx } from '../kernel/ctx.ts';
import { ANY_STARS, formatStars, type StarRange } from '../ui/star-range.ts';
import { announce, scrollBehavior, writeQuery } from '../client/legacy.ts';
import { paginate } from '../client/dom.ts';
import { bindStarSlider } from '../client/star-slider.ts';
import { PAGE, countText, everyYear, leftRows, noneLeft, visible, yearText, type Completion, type Sort, type State, type Year } from './completion.ts';

/**
 * The year strip's hover and tap: the line under it names the year under the pointer (on touch, the one tapped, until
 * the next tap). With `choose` (the page has maps left to list), a year that isn't fully cleared also lists its maps
 * left: a click, or on touch a second tap on the year already picked (the first only names it). Choosing the chosen
 * year again lists every year. Returns `mark(year)`, which outlines the year listed.
 */
function bindYearStrip(panel: HTMLElement, ctx: Ctx, years: readonly Year[] | undefined,
  { chosen = () => null, choose = null }: { chosen?: () => number | null; choose?: ((year: number | null) => void) | null } = {}): { mark(year: number | null): void } {
  const cols = panel.querySelector<HTMLElement>('.goal-years-cols');
  if (!cols || !years) return { mark() {} };
  const { t } = ctx;
  const rest = panel.querySelector<HTMLElement>('#year-rest')!, picked = panel.querySelector<HTMLElement>('#year-pick')!;
  const yearOf = (col: HTMLElement) => years[Number(col.dataset.i)];
  const open = (y: Year) => Boolean(choose) && y[1] > y[2];
  let active: HTMLElement | null = null, touch = false, wasActive = false;
  const line = (col: HTMLElement) => {
    const y = yearOf(col);
    if (!open(y)) return yearText(ctx, y);
    const hint = chosen() === y[0] ? t('its maps left are listed below') : touch ? t('tap again to list its maps left') : t('click to list its maps left');
    return `${yearText(ctx, y)} · ${hint}`;
  };
  const show = (col: HTMLElement | null) => {
    if (col === active) return;
    active?.classList.remove('is-active');
    active = col;
    cols.classList.toggle('is-pointing', Boolean(col));
    col?.classList.add('is-active');
    if (col) picked.textContent = line(col);
    rest.hidden = Boolean(col);
    picked.hidden = !col;
  };
  const columnAt = (e: Event) => (e.target as Element).closest<HTMLElement>('.goal-year');
  // Touch has no hover: a tap picks a year and it stays until the next tap.
  const pick = (e: Event) => show(columnAt(e) ?? active);
  cols.addEventListener('pointermove', pick);
  cols.addEventListener('pointerdown', e => {
    touch = e.pointerType !== 'mouse';
    wasActive = Boolean(active) && columnAt(e) === active;
    pick(e);
  });
  cols.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') show(null); });
  cols.classList.toggle('is-listable', Boolean(choose));
  cols.addEventListener('click', e => {
    const col = columnAt(e);
    if (!col || !choose || !open(yearOf(col)) || (touch && !wasActive)) return;
    const year = yearOf(col)[0];
    choose(chosen() === year ? null : year);
    picked.textContent = line(col);
  });
  const mark = (year: number | null) => cols.querySelectorAll<HTMLElement>('.goal-year').forEach((col, i) => col.classList.toggle('is-chosen', years[i][0] === year));
  mark(chosen());
  return { mark };
}

export function mount(panel: HTMLElement, ctx: Ctx, goal: Completion | null, start: State): void {
  if (!goal) return;
  const years = everyYear(goal.years);
  if (!goal.left.length) {
    bindYearStrip(panel, ctx, years);
    return;
  }
  const sort = panel.querySelector<HTMLSelectElement>('#left-sort')!;
  const yearSelect = panel.querySelector<HTMLSelectElement>('#left-year');
  const count = panel.querySelector<HTMLElement>('#left-count')!;
  const list = panel.querySelector<HTMLElement>('#left-list')!;
  let stars: StarRange = start.stars;
  let sortKey: Sort = start.sort;
  let year = start.year;
  let page = start.page;
  let items = visible(ctx, goal, stars, sortKey, year);

  const save = () => writeQuery({ sort: sortKey, year: year ?? '', stars: formatStars(stars), page: page + 1 }, { sort: 'popular', page: 1 });
  const redraw = paginate(ctx, list, items, slice => leftRows(ctx, goal, slice), PAGE, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => noneLeft(ctx, stars, year),
  });
  // A new sort, year or range starts again from the first page (paginate's redraw, which saves it).
  const refilter = () => {
    items = visible(ctx, goal, stars, sortKey, year);
    redraw(items);
    count.textContent = countText(ctx, goal, items);
    announce(count.textContent);
  };
  sort.addEventListener('change', () => { sortKey = sort.value as Sort; refilter(); });
  const slider = bindStarSlider(panel, ctx, stars, next => { stars = next; refilter(); });
  // A year from the select or the strip above; the strip also brings the list into view.
  const setYear = (next: number | null) => {
    year = next;
    if (yearSelect) yearSelect.value = year === null ? '' : String(year);
    strip.mark(year);
    refilter();
  };
  const strip = bindYearStrip(panel, ctx, years, {
    chosen: () => year,
    choose: next => {
      setYear(next);
      if (next !== null) panel.querySelector('#left-head')!.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    },
  });
  yearSelect?.addEventListener('change', () => setYear(yearSelect.value ? Number(yearSelect.value) : null));
  list.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-clear]')) return;
    stars = ANY_STARS;
    slider.set(stars);
    setYear(null);
  });
}
