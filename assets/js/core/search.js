// The search in the top bar: a combobox over players.json and the maps index, plus a few pages (the Dan course, the
// glossary…). Results come in labelled groups (pages, Players, Maps) inside one listbox, and the arrow keys move
// through all of them. Wide screens show the field inline; narrow ones show a search button that opens the field as a
// full-width row under the bar. "/" anywhere focuses it.
//
// The maps come from search-maps.json (core/data.js searchMaps): the maps two or more players here have played, about
// 0.4 MB compressed, cached under its content hash. It's only fetched on the field's first focus, never on page load;
// until it arrives the players show alone. An exact beatmap id or link outside it is looked up in that map's own small
// file, and "Search all maps" (the Maps page) has every map.

import { html } from './html.js';
import { players, searchMaps, mapEntry } from './data.js';
import { tierOf, rankMaps, beatmapIdOf } from './maps-search.js';
import { M } from './model.js';
import { avatar, setCover, starsBadge, nameClass } from './ui.js';
import * as fmt from './fmt.js';
import { track, shapeOf } from './track.js';
import { t, tn } from './i18n.js';

const LIMIT = 8;
const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** Name starts with the text, then a word in the name starts with it, then it appears anywhere; ties go to more pp. */
function rank(list, text) {
  const q = text.toLowerCase();
  const scored = [];
  for (const p of list) {
    const tier = tierOf(p.name.toLowerCase(), q);
    if (tier >= 0) scored.push([tier, Math.max(p.cv, p.ul, p.pp), p]);
  }
  scored.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2].name.localeCompare(b[2].name, 'en'));
  return scored.map(s => ({ tier: s[0], p: s[2] }));
}

// Pages the search offers above the players, so "dan" finds the Dan course even though it lives under Challenges.
// A page matches when its name contains the text or one of its words starts with it (English or Portuguese).
const PAGES = [
  { name: t('Dan course'), href: '#/challenges/dan', detail: t('Challenges · 19 stages'), words: 'dan dans course stage stages zeroth aleph shin updatedan claimdanrole curso etapa etapas' },
  { name: t('Map of the week'), href: '#/challenges/week', detail: t('Challenges'), words: 'week weekly challenge challenges semana semanal desafio desafios' },
  { name: t('King of the hill'), href: '#/challenges/hill', detail: t('Challenges · a crown per slot each month'), words: 'king hill crown crowns koth slot slots pool monthly month cv rei colina coroa coroas mês mensal' },
  { name: t('Snipe targets'), href: '#/challenges/targets', detail: t('Challenges'), words: 'snipe snipes sniping targets vulnerable unclaimed alvos' },
  { name: t('Bounties'), href: '#/challenges/bounties', detail: t('Challenges · prizes for hard maps'), words: 'bounty bounties wanted prize prizes reward hunter hall fame recompensa recompensas prémio prémios procurado caçador' },
  { name: t('Completion'), href: '#/challenges/completion', detail: t('Challenges · ranked maps cleared'), words: 'completion complete cleared clear uncleared progress goal conclusão completar progresso objetivo' },
  { name: t('Glossary'), href: '#/glossary', detail: t('pp, FC, mods explained'), words: 'glossary help words meaning new glossário glossario ajuda palavras' },
  { name: t('Records'), href: '#/records', detail: t('Biggest combos, most #1s'), words: 'records record recordes recorde' },
  { name: t('Calculator'), href: '#/calculator', detail: t('How much pp is a play worth'), words: 'calculator calc pp calculadora' },
  { name: t('How to join'), href: '#/join', detail: t('Discord, /verify and playing'), words: 'join verify verification verified role discord new entrar verificar verificação' },
];

function pageMatches(text) {
  const q = text.toLowerCase();
  if (q.length < 2) return [];
  return PAGES.filter(p => p.name.toLowerCase().includes(q) || p.words.split(' ').some(w => w.startsWith(q))).slice(0, 2);
}

/** The text with the matched part in a <mark>. */
function highlight(name, text) {
  const at = name.toLowerCase().indexOf(text.toLowerCase());
  if (at < 0) return name;
  return html`${name.slice(0, at)}<mark>${name.slice(at, at + text.length)}</mark>${name.slice(at + text.length)}`;
}

/** A quiet second line: converts pp when there is some, otherwise whichever pp the player has. */
function detail(p) {
  if (p.cv > 0) return `${fmt.pp(p.cv)} pp · ${t('Converts')}`;
  if (p.pp > 0) return `${fmt.pp(p.pp)} pp · ${t('Ranked')}`;
  if (p.ul > 0) return `${fmt.pp(p.ul)} pp · ${t('Loved')}`;
  return t('No pp yet');
}

export function initSearch() {
  const bar = document.querySelector('.topbar-inner');
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
        <div class="search-all"><a href="#/players">${t('Search all players')}</a><a href="#/maps">${t('Search all maps')}</a></div>
      </div>
    </div>`;
  bar.insertBefore(box, bar.querySelector('.nav-toggle'));

  const toggle = box.querySelector('.search-toggle');
  const input = box.querySelector('input');
  const pop = box.querySelector('.search-pop');
  const listEl = box.querySelector('.search-results');
  const [allPlayers, allMaps] = box.querySelectorAll('.search-all a');
  let list = null, maps = null, results = [], active = -1;
  const looked = new Map(); // beatmap id → a row from its own map file, for ids outside the search index (null: none)

  const load = () => {
    if (!list) list = players().then(l => (list = l)).catch(() => (list = null, []));
    return Promise.resolve(list);
  };
  /** The maps and their search text, fetched once, on the field's first focus; redraws when they arrive. */
  const loadMaps = () => {
    if (maps) return;
    maps = searchMaps().then(rows => {
      maps = { rows, hay: rows.map(r => `${r[3]} ${r[2]} ${r[4]} ${r[9] ?? ''}`.toLowerCase()) };
      if (input.value.trim() && document.activeElement === input) draw();
    }).catch(() => { maps = null; });
  };
  const options = () => listEl.querySelectorAll('[role="option"]');

  const setActive = i => {
    active = i;
    options().forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    const li = options()[i];
    if (li?.id) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };

  const showPop = open => {
    pop.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) setActive(-1);
  };

  const option = (r, i, text) => {
    if (r.page) return html`<div role="option" class="search-page" id="search-opt-${i}" data-i="${i}" aria-selected="false">
      <span class="search-page-mark" aria-hidden="true">→</span><span class="search-name">${highlight(r.page.name, text)}</span><span class="search-detail">${r.page.detail}</span>
    </div>`;
    if (r.map) {
      const [id, setId, artist, title, version, stars, , , , mapper] = r.map;
      const known = Boolean(title);
      return html`<div role="option" class="search-map" id="search-opt-${i}" data-i="${i}" aria-selected="false">
        ${setCover(setId, 'list', 'search-cover')}
        <span class="search-name">${known ? html`${highlight(title, text)} <span class="search-diff">[${highlight(version, text)}]</span>` : t('Map {id}', { id })}</span>
        <span class="search-detail">${known && stars ? starsBadge(stars) : ''}</span>
        <span class="search-sub">${known ? html`${highlight(artist, text)}${mapper ? html` · ${t('mapped by {mapper}', { mapper: highlight(mapper, text) })}` : ''}` : r.map[7] ? t('No map details') : t('No Portuguese plays on it yet')}</span>
      </div>`;
    }
    return html`<div role="option" id="search-opt-${i}" data-i="${i}" aria-selected="false">
      ${avatar(r.id, 'avatar-sm')}<span class="search-name ${nameClass(r)}">${highlight(r.name, text)}</span><span class="search-detail">${detail(r)}</span>
    </div>`;
  };
  const group = (label, items, offset, text) => (items.length ? html`<div role="group" aria-labelledby="search-g-${offset}">
    <div class="search-group" id="search-g-${offset}" role="presentation">${label}</div>
    ${items.map((r, k) => option(r, offset + k, text))}
  </div>` : '');

  const draw = async () => {
    const text = input.value.trim();
    if (!text) { results = []; showPop(false); return; }
    const l = await load();
    if (text !== input.value.trim()) return; // typed on while loading
    const pages = pageMatches(text);
    const ranked = rank(l, text);
    let foundMaps = maps?.rows ? rankMaps(maps.rows, maps.hay, text) : [];
    // An id the index doesn't have: its own map file has it (or says nobody here has played it).
    const id = beatmapIdOf(text);
    if (id !== null && foundMaps[0] && !foundMaps[0].row[3]) {
      if (!looked.has(id)) {
        looked.set(id, undefined);
        mapEntry(id).then(e => {
          const m = e?.m;
          looked.set(id, m ? [id, m[M.SET], m[M.ARTIST], m[M.TITLE], m[M.VERSION], m[M.STARS], e.c, e.s.length, null, m[M.CREATOR]] : null);
          if (input.value.trim() === text) draw();
        }).catch(() => looked.set(id, null));
      }
      if (looked.get(id)) foundMaps = [{ tier: 0, row: looked.get(id) }];
    }
    // Players first when the text matches a name at least as well as a map (a name, then, not a title or a map id).
    const playersFirst = !foundMaps.length || (ranked.length > 0 && ranked[0].tier <= foundMaps[0].tier);
    const people = ranked.slice(0, Math.max(2, LIMIT - foundMaps.length - pages.length)).map(r => r.p);
    const mapItems = foundMaps.map(m => ({ map: m.row }));
    const groups = playersFirst
      ? [['', pages.map(page => ({ page }))], [t('Players'), people], [t('Maps'), mapItems]]
      : [['', pages.map(page => ({ page }))], [t('Maps'), mapItems], [t('Players'), people]];
    results = groups.flatMap(([, items]) => items);
    let offset = 0;
    listEl.innerHTML = String(html`${groups.map(([label, items]) => {
      const out = label ? group(label, items, offset, text) : items.map((r, k) => option(r, offset + k, text));
      offset += items.length;
      return out;
    })}`);
    listEl.hidden = !results.length;
    // Outside the listbox, in a live region, so screen readers hear "Nothing found" or how many matched.
    const status = box.querySelector('.search-status');
    const loadingMaps = maps && !maps.rows;
    status.classList.toggle('sr-only', Boolean(results.length));
    const and = ` ${t('and')} `;
    status.textContent = results.length
      ? t('{what} found', { what: [pages.length && tn(pages.length, '{names} page', '{names} pages', { names: pages.map(p => p.name).join(and) }),
        people.length && fmt.plural(people.length, 'player'), mapItems.length && fmt.plural(mapItems.length, 'map')].filter(Boolean).join(and) })
      : loadingMaps ? t('No players found. Looking through the maps…') : t('No players or maps found. This search has the maps two or more players here have played; Search all maps has the rest.');
    allPlayers.href = `#/players?q=${encodeURIComponent(text)}`;
    allMaps.href = `#/maps?q=${encodeURIComponent(text)}`;
    showPop(true);
    setActive(results.length ? 0 : -1);
  };

  // On narrow screens the field lives in a row under the bar, opened by the search button.
  const setOpen = open => {
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

  // Usage counts: what was picked and the shape of what was typed, never the text (core/track.js).
  const go = r => {
    track('search', 'header', `${r.page ? 'picked a page' : r.map ? 'picked a map' : 'picked a player'} · ${shapeOf(input.value)}`);
    location.hash = r.page ? r.page.href : r.map ? `#/map/${r.map[0]}` : `#/player/${r.id}`;
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
      if (p) go(p);
      else if (input.value.trim()) { track('search', 'header', `all results · ${shapeOf(input.value)}`); location.hash = allPlayers.getAttribute('href'); reset(); }
    } else if (e.key === 'Escape') {
      if (!pop.hidden) showPop(false);
      else { input.value = ''; setOpen(false); input.blur(); }
    }
  });
  // mousedown keeps focus in the field, so the click lands before blur closes the list.
  listEl.addEventListener('mousedown', e => e.preventDefault());
  listEl.addEventListener('click', e => {
    const li = e.target.closest('[data-i]');
    if (li) go(results[Number(li.dataset.i)]);
  });
  listEl.addEventListener('mousemove', e => {
    const li = e.target.closest('[data-i]');
    if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i));
  });
  for (const a of [allPlayers, allMaps]) a.addEventListener('click', () => { track('search', 'header', `all results · ${shapeOf(input.value)}`); setTimeout(reset); });
  box.addEventListener('focusout', e => { if (!box.contains(e.relatedTarget)) showPop(false); });
  document.addEventListener('click', e => { if (!box.contains(e.target)) { showPop(false); if (!input.value) setOpen(false); } });

  // "/" focuses the search from anywhere that isn't already a text field.
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    setOpen(true);
    input.focus();
    input.select();
  });
  window.addEventListener('hashchange', () => { if (document.activeElement !== input) { showPop(false); setOpen(false); } });
}
