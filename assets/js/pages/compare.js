import { html } from '../core/html.js';
import { players, playerFile } from '../core/data.js';
import { S, M, CATS, CAT, boardComparator } from '../core/model.js';
import {
  setTitle, avatar, playerPicker, pickedPlayer, prefs, mapLink, modsBadges, ppText, gradeBadge, paginate, empty, CAT_LABEL, tabs,
} from '../core/ui.js';
import { RIVALRIES } from '../core/lore.js';
import * as fmt from '../core/fmt.js';

/** The joke row: full combos on 7★ and up, from the player's own file. Data-backed, but still silly. */
const aura = file => CATS.reduce((n, cat) => n + file.scores[cat].filter(s => s[S.MISS] === 0 && file.maps[s[S.MAP]]?.[M.STARS] >= 7).length, 0);

/** Stat rows: label, value, how to show it, and whether lower wins (ranks). */
const ROWS = [
  ['Converts pp', p => p.cv, v => `${fmt.pp(v)} pp`],
  ['Loved pp', p => p.ul, v => `${fmt.pp(v)} pp`],
  ['Official pp', p => p.pp, v => `${fmt.pp(v)} pp`],
  ['Global rank', p => p.global || null, v => fmt.rank(v), true],
  ['Accuracy', p => p.acc, v => fmt.acc(v)],
  ['#1s in Portugal', p => p.firsts.c + p.firsts.u + p.firsts.r, v => fmt.num(v)],
  ['Scores', p => p.count.c + p.count.u + p.count.r, v => fmt.num(v)],
  ['SS', p => p.grades[0], v => fmt.num(v)],
  ['Dan points', p => p.danScore, v => fmt.num(v)],
  ['Play count', p => p.plays, v => fmt.num(v)],
];

function statRows(a, b) {
  return html`${ROWS.map(([label, value, show, lowerWins]) => {
    const va = value(a), vb = value(b);
    const aWins = va !== null && (vb === null || (lowerWins ? va < vb : va > vb));
    const bWins = vb !== null && (va === null || (lowerWins ? vb < va : vb > va));
    return html`<div class="cmp-row">
      <span class="a ${aWins ? 'win' : ''}">${va === null ? '—' : show(va)}</span>
      <span class="label">${label}</span>
      <span class="${bWins ? 'win' : ''}">${vb === null ? '—' : show(vb)}</span>
    </div>`;
  })}`;
}

/** Maps both played in a category, with who's ahead by the bot's ordering for that board. */
function shared(fa, fb, cat) {
  const theirs = new Map(fb.scores[cat].map(s => [s[S.MAP], s]));
  const compare = boardComparator(cat);
  const out = [];
  for (const sa of fa.scores[cat]) {
    const sb = theirs.get(sa[S.MAP]);
    if (!sb) continue;
    const order = compare([0, ...sa], [0, ...sb]);
    out.push({ map: sa[S.MAP], meta: fa.maps[sa[S.MAP]], a: sa, b: sb, winner: order < 0 ? 'a' : order > 0 ? 'b' : null });
  }
  return out.sort((x, y) => Math.max(y.a[S.TIME], y.b[S.TIME]) - Math.max(x.a[S.TIME], x.b[S.TIME]));
}

const side = (s, cat, win, who) => html`<span class="score-line side-play ${win ? '' : 'lost'}">
  <span class="win-mark">${win ? '#1' : ''}</span> ${avatar(who, 'avatar-sm')} ${modsBadges(s[S.MODS])} ${gradeBadge(s[S.GRADE])} ${fmt.acc(s[S.ACC])}
  ${cat === CAT.LOVED ? ppText(s[S.PP]) : html`<b>${fmt.num(s[S.SCORE])}</b>`}
</span>`;

export default async function compare(root, { params, query, isCurrent }) {
  const list = await players();
  if (!isCurrent()) return;
  const byId = new Map(list.map(p => [p.id, p]));
  const a = byId.get(Number(params.a)) ?? byId.get(prefs.get('me', null)) ?? null;
  const b = byId.get(Number(params.b)) ?? null;
  setTitle(a && b ? `${a.name} vs ${b.name}` : 'Compare');

  const pickers = html`<div class="toolbar">
    ${playerPicker('pick-a', list, a, 'First player…')}
    <span class="faint">vs</span>
    ${playerPicker('pick-b', list, b, 'Second player…')}
  </div>`;

  if (!a || !b) {
    const rivals = a ? list.filter(p => p.id !== a.id && p.cv > 0).sort((x, y) => Math.abs(x.cv - a.cv) - Math.abs(y.cv - a.cv)).slice(0, 6) : [];
    const presets = RIVALRIES.filter(([x, y]) => byId.has(x) && byId.has(y));
    root.innerHTML = String(html`
      <header class="page-head"><h1>Compare two players</h1>
        <p>Pick two players to compare their stats and see who wins on the maps they’ve both played.</p></header>
      ${pickers}
      ${!a && presets.length ? html`<section class="section"><h2>Classic rivalries</h2>
        <div class="grid grid-3">${presets.map(([x, y, label]) => html`<a class="card card-link" href="#/compare/${x}/${y}">
          <span class="eyebrow">${label}</span>
          <div class="mt-1 versus">
            <span class="side">${avatar(x, 'avatar-sm')}<b>${byId.get(x).name}</b></span>
            <span class="faint small">vs</span>
            <span class="side right"><b>${byId.get(y).name}</b>${avatar(y, 'avatar-sm')}</span>
          </div>
        </a>`)}</div></section>` : ''}
      ${rivals.length ? html`<section class="section"><h2>Rivals for ${a.name}</h2>
        <p class="muted small">The players closest in Converts pp.</p>
        <div class="grid grid-3">${rivals.map(r => html`<a class="card card-link" href="#/compare/${a.id}/${r.id}">
          <span class="player">${avatar(r.id, 'avatar-md')}<span><b>${r.name}</b><br><span class="small muted">${fmt.pp(r.cv)} pp (${r.cv >= a.cv ? '+' : ''}${fmt.num(r.cv - a.cv)})</span></span></span>
        </a>`)}</div></section>` : ''}
    `);
    wirePickers(root, list, a, b);
    return;
  }

  const [fa, fb] = await Promise.all([playerFile(a.id), playerFile(b.id)]);
  if (!isCurrent()) return;
  const cat = CATS.includes(query.cat) ? query.cat : CAT.CONVERT;
  const both = shared(fa, fb, cat);
  const winsA = both.filter(x => x.winner === 'a').length;
  const winsB = both.filter(x => x.winner === 'b').length;

  root.innerHTML = String(html`
    <header class="page-head"><span class="eyebrow">Compare</span><h1>${a.name} vs ${b.name}</h1></header>
    ${pickers}
    <section class="card">
      <div class="mb-3 versus">
        <a class="plain-link side" href="#/player/${a.id}">${avatar(a.id, 'avatar-md')}<b>${a.name}</b></a>
        <span class="faint">vs</span>
        <a class="plain-link side right" href="#/player/${b.id}"><b>${b.name}</b>${avatar(b.id, 'avatar-md')}</a>
      </div>
      ${statRows(a, b)}
      ${(() => {
        const [xa, xb] = [aura(fa), aura(fb)];
        return html`<div class="cmp-row cmp-aura" title="Full combos on 7★ and up. Purely scientific.">
          <span class="a ${xa > xb ? 'win' : ''}">${fmt.num(xa)}</span><span class="label">Aura</span><span class="${xb > xa ? 'win' : ''}">${fmt.num(xb)}</span>
        </div>`;
      })()}
    </section>

    <section class="section">
      <h2>Maps in common</h2>
      ${tabs(CATS.map(c => ({ href: `#/compare/${a.id}/${b.id}?cat=${c}`, label: CAT_LABEL[c], count: shared(fa, fb, c).length, active: c === cat })))}
      ${both.length ? html`
        <div class="mb-2 versus">
          <b class="side">${a.name}: ${fmt.num(winsA)}</b>
          <span class="faint small">${cat === CAT.LOVED ? 'by pp' : 'by score'}</span>
          <b class="side right">${fmt.num(winsB)}: ${b.name}</b>
        </div>
        <div class="mb-4 split"><div class="a" style="flex:${winsA || 0.0001}"></div><div class="b" style="flex:${winsB || 0.0001}"></div></div>
        <div id="shared"></div>` : empty(`There are no ${CAT_LABEL[cat]} maps they’ve both played.`)}
    </section>
  `);
  wirePickers(root, list, a, b);
  if (!both.length) return;
  paginate(root.querySelector('#shared'), both, slice => html`<div class="rows">${slice.map(x => html`<div class="row">
    <div>${mapLink(x.map, x.meta)}</div>
    <div class="meta-stack row-meta">
      ${side(x.a, cat, x.winner === 'a', a.id)}
      ${side(x.b, cat, x.winner === 'b', b.id)}
    </div>
  </div>`)}</div>`, 30);
}

function wirePickers(root, list, a, b) {
  const go = () => {
    const pa = pickedPlayer(root.querySelector('#pick-a'), list) ?? a;
    const pb = pickedPlayer(root.querySelector('#pick-b'), list) ?? b;
    if (pa && pb && pa.id !== pb.id) location.hash = `#/compare/${pa.id}/${pb.id}`;
    else if (pa && pa !== a) location.hash = `#/compare/${pa.id}`;
  };
  root.querySelector('#pick-a').addEventListener('change', go);
  root.querySelector('#pick-b').addEventListener('change', go);
}
