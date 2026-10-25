// The player search in the top bar: a combobox over players.json, plus a few pages (the Dan course, the glossary…).
// Wide screens show the field inline; narrow ones show a search button that opens the field as a full-width row under
// the bar. "/" anywhere focuses it.

import { html } from './html.js';
import { players } from './data.js';
import { avatar } from './ui.js';
import * as fmt from './fmt.js';

const LIMIT = 8;
const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** Name starts with the text, then a word in the name starts with it, then it appears anywhere; ties go to more pp. */
function rank(list, text) {
  const q = text.toLowerCase();
  const scored = [];
  for (const p of list) {
    const name = p.name.toLowerCase();
    const at = name.indexOf(q);
    if (at < 0) continue;
    const tier = at === 0 ? 0 : /[\s_\-[\].]/.test(name[at - 1]) ? 1 : 2;
    scored.push([tier, Math.max(p.cv, p.ul, p.pp), p]);
  }
  scored.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2].name.localeCompare(b[2].name, 'en'));
  return scored.slice(0, LIMIT).map(s => s[2]);
}

// Pages the search offers above the players, so "dan" finds the Dan course even though it lives under Challenges.
// A page matches when its name contains the text or one of its words starts with it.
const PAGES = [
  { name: 'Dan course', href: '#/challenges/dan', detail: 'Challenges · 19 stages', words: 'dan dans course stage stages zeroth aleph shin updatedan claimdanrole' },
  { name: 'Map of the week', href: '#/challenges/week', detail: 'Challenges', words: 'week weekly challenge challenges' },
  { name: 'Snipe targets', href: '#/challenges/targets', detail: 'Challenges', words: 'snipe snipes sniping targets vulnerable bounty bounties unclaimed' },
  { name: 'Glossary', href: '#/glossary', detail: 'pp, FC, mods explained', words: 'glossary help words meaning new' },
  { name: 'Records', href: '#/records', detail: 'Biggest combos, most #1s', words: 'records record' },
  { name: 'Calculator', href: '#/calculator', detail: 'How much pp is a play worth', words: 'calculator calc pp' },
  { name: 'How to join', href: '#/join', detail: 'Discord, /verify and playing', words: 'join verify verification verified role discord new' },
];

function pageMatches(text) {
  const q = text.toLowerCase();
  if (q.length < 2) return [];
  return PAGES.filter(p => p.name.toLowerCase().includes(q) || p.words.split(' ').some(w => w.startsWith(q))).slice(0, 2);
}

/** The player's name with the matched part in a <mark>. */
function highlight(name, text) {
  const at = name.toLowerCase().indexOf(text.toLowerCase());
  if (at < 0) return name;
  return html`${name.slice(0, at)}<mark>${name.slice(at, at + text.length)}</mark>${name.slice(at + text.length)}`;
}

/** A quiet second line: converts pp when there is some, otherwise whichever pp the player has. */
function detail(p) {
  if (p.cv > 0) return `${fmt.pp(p.cv)} pp · Converts`;
  if (p.pp > 0) return `${fmt.pp(p.pp)} pp · Ranked`;
  if (p.ul > 0) return `${fmt.pp(p.ul)} pp · Loved`;
  return 'No pp yet';
}

export function initSearch() {
  const bar = document.querySelector('.topbar-inner');
  const box = document.createElement('div');
  box.className = 'search';
  box.innerHTML = `
    <button class="search-toggle" type="button" aria-label="Search players" aria-expanded="false" aria-controls="search-panel">${ICON}<span class="search-toggle-label" aria-hidden="true">Search</span></button>
    <div class="search-panel" id="search-panel" role="search">
      <div class="search-field">
        ${ICON}
        <input id="player-search" type="text" placeholder="Search players" autocomplete="off" spellcheck="false"
          role="combobox" aria-label="Search players" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results">
        <kbd class="search-key" aria-hidden="true">/</kbd>
      </div>
      <div class="search-pop" hidden>
        <ul class="search-results" id="search-results" role="listbox" aria-label="Players"></ul>
        <p class="search-status" id="search-status" role="status"></p>
        <a class="search-all" href="#/players">Search all players →</a>
      </div>
    </div>`;
  bar.insertBefore(box, bar.querySelector('.nav-toggle'));

  const toggle = box.querySelector('.search-toggle');
  const input = box.querySelector('input');
  const pop = box.querySelector('.search-pop');
  const listEl = box.querySelector('.search-results');
  const all = box.querySelector('.search-all');
  let list = null, results = [], active = -1;

  const load = () => {
    if (!list) list = players().then(l => (list = l)).catch(() => (list = null, []));
    return Promise.resolve(list);
  };

  const setActive = i => {
    active = i;
    listEl.querySelectorAll('[role="option"]').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    const li = listEl.children[i];
    if (li?.id) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };

  const showPop = open => {
    pop.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) setActive(-1);
  };

  const draw = async () => {
    const text = input.value.trim();
    if (!text) { results = []; showPop(false); return; }
    const l = await load();
    if (text !== input.value.trim()) return; // typed on while loading
    const pages = pageMatches(text);
    const people = rank(l, text).slice(0, LIMIT - pages.length);
    results = [...pages.map(page => ({ page })), ...people];
    listEl.innerHTML = String(html`${results.map((r, i) => (r.page
      ? html`<li role="option" class="search-page" id="search-opt-${i}" data-i="${i}" aria-selected="false">
          <span class="search-page-mark" aria-hidden="true">→</span><span class="search-name">${highlight(r.page.name, text)}</span><span class="search-detail">${r.page.detail}</span>
        </li>`
      : html`<li role="option" id="search-opt-${i}" data-i="${i}" aria-selected="false">
          ${avatar(r.id, 'avatar-sm')}<span class="search-name">${highlight(r.name, text)}</span><span class="search-detail">${detail(r)}</span>
        </li>`))}`);
    listEl.hidden = !results.length;
    // Outside the listbox, in a live region, so screen readers hear "No players found" or how many matched.
    const status = box.querySelector('.search-status');
    status.classList.toggle('sr-only', Boolean(results.length));
    status.textContent = results.length
      ? [pages.length && `${pages.map(p => p.name).join(' and ')} page${pages.length > 1 ? 's' : ''}`,
        people.length && `${fmt.plural(people.length, 'player')}${people.length === LIMIT ? ' (the best 8)' : ''}`].filter(Boolean).join(' and ') + ' found'
      : 'No players found';
    all.href = `#/players?q=${encodeURIComponent(text)}`;
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

  const go = r => {
    location.hash = r.page ? r.page.href : `#/player/${r.id}`;
    reset();
  };

  toggle.addEventListener('click', () => setOpen(!box.classList.contains('open')));
  document.querySelector('.nav-toggle')?.addEventListener('click', () => setOpen(false));
  input.addEventListener('focus', () => { load(); if (input.value.trim()) draw(); });
  input.addEventListener('input', draw);
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
      else if (input.value.trim()) { location.hash = all.getAttribute('href'); reset(); }
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
  all.addEventListener('click', () => setTimeout(reset));
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
