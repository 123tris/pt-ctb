// The search in the top bar, as assets/js/core/search.js has it: a combobox over the players and the maps, plus a few
// pages (the Dan course, the glossary…). Results come in labelled groups (pages, Players, Maps) inside one listbox, and
// the arrow keys move through all of them. Wide screens show the field inline; narrow ones show a search button that
// opens the field as a full-width row under the bar. "/" anywhere focuses it. What it finds and how it draws it is
// ui/header-search.ts.
//
// The players come from the core pack, which nearly every page has loaded already (client/players.ts). The maps come
// from search-maps.json (the maps two or more players here have played, about 0.4 MB compressed, cached under its
// content hash), fetched on the field's first focus, never on page load; until it arrives the players show alone. An
// exact beatmap id or link outside it is looked up in that map's own small file, and "Search all maps" (the Maps page)
// has every map.

import type { Ctx } from '../kernel/ctx.ts';
import { M } from '../kernel/model.ts';
import { mapBucket } from '../routes.ts';
import type { Players } from '../ui/players.ts';
import { findAll, groups, resultsList, searchMaps, statusText, type Found, type MapRow, type Result, type SearchMaps } from '../ui/header-search.ts';
import { decodeMapsSearch, decodeSearchMaps } from '../../../assets/js/core/maps-search.js';
import { store } from './boot.ts';
import { shellPlayers } from './players.ts';
import { go } from './ui.ts';
import { track, shapeOf } from './track.ts';

const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** The header search's maps; data from before search-maps.json has only the full index. */
async function loadSearchMaps(): Promise<MapRow[]> {
  if (await store.hasJson('search-maps.json')) return decodeSearchMaps(await store.json('search-maps.json')) as MapRow[];
  return decodeMapsSearch(await store.json('maps-search.json')) as MapRow[];
}

/** A map's board in its bucket: { m: map tuple | null, c: category, s: scores }, or nothing for no PT scores. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapEntry = { m: any[] | null; c: string; s: unknown[] } | undefined;

export function initSearch(ctx: Ctx): void {
  const { t } = ctx;
  const bar = document.querySelector('.topbar-inner')!;
  const box = document.createElement('div');
  box.className = 'search';
  box.innerHTML = `
    <button class="search-toggle" type="button" aria-label="${t('Search players or maps')}" aria-expanded="false" aria-controls="search-panel">${ICON}<span class="search-toggle-label" aria-hidden="true">${t('Search')}</span></button>
    <div class="search-panel" id="search-panel" role="search">
      <div class="search-field">
        ${ICON}
        <input id="player-search" type="text" placeholder="${t('Search players or maps|placeholder')}" autocomplete="off" spellcheck="false"
          role="combobox" aria-label="${t('Search players or maps')}" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results">
        <kbd class="search-key" aria-hidden="true">/</kbd>
      </div>
      <div class="search-pop" hidden>
        <div class="search-results" id="search-results" role="listbox" aria-label="${t('Players and maps')}"></div>
        <p class="search-status" id="search-status" role="status"></p>
        <div class="search-all"><a href="/players">${t('Search all players')}</a><a href="/maps">${t('Search all maps')}</a></div>
      </div>
    </div>`;
  bar.insertBefore(box, bar.querySelector('.nav-toggle'));

  const toggle = box.querySelector<HTMLButtonElement>('.search-toggle')!;
  const input = box.querySelector('input')!;
  const pop = box.querySelector<HTMLElement>('.search-pop')!;
  const listEl = box.querySelector<HTMLElement>('.search-results')!;
  const [allPlayers, allMaps] = box.querySelectorAll<HTMLAnchorElement>('.search-all a');
  // null: not asked for; a promise while they load; then the maps.
  let maps: SearchMaps | Promise<void> | null = null;
  let results: Result[] = [];
  let drawnFrom: Players | null = null; // the players the list was drawn from (a result is a row of them)
  let active = -1;
  const looked = new Map<number, MapRow | null | undefined>(); // beatmap id → a row from its own map file (null: none)

  const load = shellPlayers;
  /** The maps and their search text, fetched once, on the field's first focus; redraws when they arrive. */
  const loadMaps = () => {
    if (maps) return;
    maps = loadSearchMaps().then(rows => {
      maps = searchMaps(rows);
      if (input.value.trim() && document.activeElement === input) draw();
    }).catch(() => { maps = null; });
  };
  const options = () => listEl.querySelectorAll<HTMLElement>('[role="option"]');

  const setActive = (i: number) => {
    active = i;
    options().forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    const li = options()[i];
    if (li?.id) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };

  const showPop = (open: boolean) => {
    pop.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) setActive(-1);
  };

  /** Looks up a beatmap id the maps don't have in its own map file, once, and redraws if the text is still the same. */
  const lookUp = (id: number, text: string) => {
    looked.set(id, undefined);
    store.json<Record<string, MapEntry>>(mapBucket(id)).catch(() => ({} as Record<string, MapEntry>)).then(bucket => {
      const e = bucket[id];
      const m = e?.m;
      looked.set(id, m ? [id, m[M.SET], m[M.ARTIST], m[M.TITLE], m[M.VERSION], m[M.STARS], e.c, e.s.length, null, m[M.CREATOR]] : null);
      if (input.value.trim() === text) draw();
    }).catch(() => looked.set(id, null));
  };

  const draw = async () => {
    const text = input.value.trim();
    if (!text) { results = []; showPop(false); return; }
    const list = await load();
    if (text !== input.value.trim()) return; // typed on while loading
    drawnFrom = list;
    const ready = maps && !(maps instanceof Promise) ? maps : null;
    const found: Found = findAll(ctx, list, ready, text, id => (looked.has(id) ? looked.get(id) ?? null : undefined));
    if (found.lookUp !== null) lookUp(found.lookUp, text);
    const shown = groups(ctx, found);
    results = shown.flatMap(([, items]) => items);
    listEl.innerHTML = String(resultsList(ctx, list, shown, text));
    listEl.hidden = !results.length;
    // Outside the listbox, in a live region, so screen readers hear "Nothing found" or how many matched.
    const status = box.querySelector('.search-status')!;
    status.classList.toggle('sr-only', Boolean(results.length));
    status.textContent = statusText(ctx, found, maps instanceof Promise);
    allPlayers.href = `/players?q=${encodeURIComponent(text)}`;
    allMaps.href = `/maps?q=${encodeURIComponent(text)}`;
    showPop(true);
    setActive(results.length ? 0 : -1);
  };

  // On narrow screens the field lives in a row under the bar, opened by the search button.
  const setOpen = (open: boolean) => {
    box.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      document.getElementById('nav')?.classList.remove('open');
      document.querySelector('.nav-toggle')?.setAttribute('aria-expanded', 'false');
      input.focus();
    }
  };

  const reset = () => {
    input.value = '';
    results = [];
    showPop(false);
    setOpen(false);
    input.blur();
  };

  // Usage counts: what was picked and the shape of what was typed, never the text (client/track.ts).
  const open = (r: Result) => {
    track('search', 'header', `${'page' in r ? 'picked a page' : 'map' in r ? 'picked a map' : 'picked a player'} · ${shapeOf(input.value)}`);
    go('page' in r ? r.page.href : 'map' in r ? `/map/${r.map[0]}` : `/player/${drawnFrom!.id[r.player]}`);
    reset();
  };

  toggle.addEventListener('click', () => setOpen(!box.classList.contains('open')));
  document.querySelector('.nav-toggle')?.addEventListener('click', () => setOpen(false));
  input.addEventListener('focus', () => { load(); loadMaps(); if (input.value.trim()) draw(); });
  // Typing also starts the maps, for a field focused before the window had focus (no focus event then).
  input.addEventListener('input', () => { loadMaps(); draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (pop.hidden) { draw(); return; }
      if (!results.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = results[active] ?? results[0];
      if (p) open(p);
      else if (input.value.trim()) { track('search', 'header', `all results · ${shapeOf(input.value)}`); go(allPlayers.getAttribute('href')!); reset(); }
    } else if (e.key === 'Escape') {
      if (!pop.hidden) showPop(false);
      else { input.value = ''; setOpen(false); input.blur(); }
    }
  });
  // mousedown keeps focus in the field, so the click lands before blur closes the list.
  listEl.addEventListener('mousedown', e => e.preventDefault());
  listEl.addEventListener('click', e => {
    const li = (e.target as Element).closest<HTMLElement>('[data-i]');
    if (li) open(results[Number(li.dataset.i)]);
  });
  listEl.addEventListener('mousemove', e => {
    const li = (e.target as Element).closest<HTMLElement>('[data-i]');
    if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i));
  });
  for (const a of [allPlayers, allMaps]) a.addEventListener('click', () => { track('search', 'header', `all results · ${shapeOf(input.value)}`); setTimeout(reset); });
  box.addEventListener('focusout', e => { if (!box.contains(e.relatedTarget as Node | null)) showPop(false); });
  document.addEventListener('click', e => { if (!box.contains(e.target as Node)) { showPop(false); if (!input.value) setOpen(false); } });

  // "/" focuses the search from anywhere that isn't already a text field.
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    e.preventDefault();
    setOpen(true);
    input.focus();
    input.select();
  });
  window.addEventListener('routechange', () => { if (document.activeElement !== input) { showPop(false); setOpen(false); } });
}
