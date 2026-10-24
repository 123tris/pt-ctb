import { html } from '../core/html.js';
import { players } from '../core/data.js';
import { danRole } from '../core/model.js';
import { setTitle, avatar, paginate } from '../core/ui.js';
import * as fmt from '../core/fmt.js';

const SORTS = {
  cv: ['Converts pp', (a, b) => b.cv - a.cv],
  ul: ['Loved pp', (a, b) => b.ul - a.ul],
  pp: ['Official pp', (a, b) => b.pp - a.pp],
  firsts: ['Number of #1s', (a, b) => (b.firsts.c + b.firsts.u + b.firsts.r) - (a.firsts.c + a.firsts.u + a.firsts.r)],
  last: ['Played most recently', (a, b) => (b.last || 0) - (a.last || 0)],
  name: ['Name', (a, b) => a.name.localeCompare(b.name, 'en')],
};

const card = p => {
  const role = danRole(p.danScore);
  return html`<a class="card card-link" href="#/player/${p.id}">
    <div class="player" style="margin-bottom:12px">${avatar(p.id, 'avatar-md')}<span style="font-size:1.05rem;font-weight:600">${p.name}</span></div>
    <dl class="kv kv-3">
      <div><dt>Converts</dt><dd>${fmt.num(p.cv)}</dd></div>
      <div><dt>Loved</dt><dd>${fmt.num(p.ul)}</dd></div>
      <div><dt>Official</dt><dd>${fmt.num(p.pp)}</dd></div>
    </dl>
    <p class="small faint" style="margin:10px 0 0">${role ? html`<span class="badge badge-gold">${role}</span> ` : ''}${p.last ? `Last played ${fmt.ago(p.last)}` : 'No plays recorded'}</p>
  </a>`;
};

export default async function playersPage(root, { query, isCurrent }) {
  const list = await players();
  if (!isCurrent()) return;
  setTitle('Players');

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Players</span>
      <h1>${fmt.num(list.length)} Portuguese players</h1>
      <p>Everyone the bot tracks. Open a profile to see their plays, Dan course progress and pp history.</p>
    </header>
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="Search players…" value="${query.q || ''}" aria-label="Search players">
      <select class="select" id="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}">${label}</option>`)}</select>
    </div>
    <div id="list"></div>
  `);

  const q = root.querySelector('#q');
  const sort = root.querySelector('#sort');
  const visible = () => {
    const text = q.value.trim().toLowerCase();
    return list.filter(p => !text || p.name.toLowerCase().includes(text)).sort(SORTS[sort.value][1]);
  };
  const redraw = paginate(root.querySelector('#list'), visible(), slice => html`<div class="grid grid-auto">${slice.map(card)}</div>`, 48);
  q.addEventListener('input', () => redraw(visible()));
  sort.addEventListener('change', () => redraw(visible()));
}
