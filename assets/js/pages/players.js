import { html, raw } from '../core/html.js';
import { players } from '../core/data.js';
import { danRole } from '../core/model.js';
import { setTitle, avatar, paginate, pageHead, writeQuery, announce, resultCount, emptyFiltered } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { t } from '../core/i18n.js';

const SORTS = {
  cv: [t('Converts pp'), (a, b) => b.cv - a.cv],
  ul: [t('Loved pp'), (a, b) => b.ul - a.ul],
  pp: [t('Official pp'), (a, b) => b.pp - a.pp],
  firsts: [t('Number of #1s'), (a, b) => (b.firsts.c + b.firsts.u + b.firsts.r) - (a.firsts.c + a.firsts.u + a.firsts.r)],
  last: [t('Played most recently'), (a, b) => (b.last || 0) - (a.last || 0)],
  name: [t('Name'), (a, b) => a.name.localeCompare(b.name, 'en')],
};

const card = p => {
  const role = danRole(p.danScore);
  return html`<a class="card card-link" href="#/player/${p.id}">
    <div class="mb-3 player">${avatar(p.id, 'avatar-md')}<span class="text-lg fw-600">${p.name}</span></div>
    <dl class="kv kv-3">
      <div><dt>${t('Converts')}</dt><dd>${fmt.num(p.cv)}</dd></div>
      <div><dt>${t('Loved')}</dt><dd>${fmt.num(p.ul)}</dd></div>
      <div><dt>${t('Official')}</dt><dd>${fmt.num(p.pp)}</dd></div>
    </dl>
    <p class="m-0 mt-2 small faint">${role ? html`<span class="badge badge-gold">${role}</span> ` : ''}${p.last ? t('Last played {ago}', { ago: fmt.ago(p.last) }) : t('No plays recorded')}</p>
  </a>`;
};

export default async function playersPage(root, { query, isCurrent }) {
  const list = await players();
  if (!isCurrent()) return;
  setTitle(t('Players'));

  const sortKey = SORTS[query.sort] ? query.sort : 'cv';
  root.innerHTML = String(html`
    ${pageHead({ title: t('Players'), intro: t('All {n} Portuguese players the bot tracks. Open a profile to see their plays, Dan course progress and pp history.', { n: fmt.num(list.length) }) })}
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="${t('Search players…')}" value="${query.q || ''}" aria-label="${t('Search players')}">
      <select class="select" id="sort" aria-label="${t('Sort')}">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}" ${k === sortKey ? raw('selected') : ''}>${label}</option>`)}</select>
    </div>
    <p class="result-count" id="count"></p>
    <div id="list"></div>
  `);

  // Search, sort and page live in the URL (the header search's "all results" link fills in q).
  const q = root.querySelector('#q');
  const sort = root.querySelector('#sort');
  const count = root.querySelector('#count');
  let page = Math.max(0, (Number(query.page) || 1) - 1);
  const save = () => writeQuery({ q: q.value.trim(), sort: sort.value, page: page + 1 }, { sort: 'cv', page: 1 });
  const visible = () => {
    const text = q.value.trim().toLowerCase();
    return list.filter(p => !text || p.name.toLowerCase().includes(text)).sort(SORTS[sort.value][1]);
  };
  let items = visible();
  const showCount = speak => {
    count.textContent = resultCount(items.length, list.length, 'player');
    if (speak) announce(count.textContent);
  };
  const redraw = paginate(root.querySelector('#list'), items, slice => html`<div class="grid grid-auto">${slice.map(card)}</div>`, 48, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => emptyFiltered(t('No player’s name contains “{q}”.', { q: q.value.trim() })),
  });
  showCount(false);
  const refilter = () => { items = visible(); redraw(items); showCount(true); };
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refilter, 200); });
  sort.addEventListener('change', refilter);
  root.querySelector('#list').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    q.value = '';
    refilter();
    q.focus();
  });
}
