import { html } from '../core/html.js';
import { players, modRankings, topPlays, meta, records } from '../core/data.js';
import { starKingsBoards } from './star-kings.js';
import { S, parseModFilter, topPlaysView } from '../core/model.js';
import {
  setTitle, tabs, playerLink, mapLink, modsBadges, ppText, empty, emptyFiltered, prefs, SLUG_CAT, CAT_LABEL, pageHead,
  chipGroup, setPressed, writeQuery, announce, resultCount, isInactiveOnOsu, isInactive, isLegend, inactiveTag, legendTag,
  statusTag, officialPp, scoreStats, posBadge, catChip,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';

// `label` is the short tab text; `title` names the page.
const BOARDS = [
  { slug: 'converts', label: 'Converts', title: 'Converts' },
  { slug: 'loved', label: 'Loved', title: 'Loved & Unranked' },
  { slug: 'ranked', label: 'Ranked', title: 'Ranked (official)' },
  { slug: 'mods', label: 'Mods', title: 'By mods' },
  { slug: 'plays', label: 'Top plays', title: 'Top plays' },
  { slug: 'kings', label: 'Star kings', title: 'Star kings' },
];

const INTRO = {
  converts: html`osu!standard maps played in catch mode, weighted the way osu! does it. <a class="help-link" href="#/glossary">What’s pp?</a>`,
  loved: 'Loved, pending and graveyarded maps, with pp the bot works out from the current formula.',
  ranked: 'The official leaderboard, from each player’s osu! profile. Players inactive on osu! keep their last known pp.',
  mods: 'Weighted pp from plays that include the chosen mod. HDDT counts for HD, DT and HDDT. NF is ignored when filtering: NF counts as NM, HRNF as HR.',
  plays: 'Portugal’s best single plays, most pp first. Mod filters include NF: NF counts as NM, HRNF as HR.',
  kings: 'The players holding the most #1s in PT in each star range.',
};

const SOURCES = [['r', 'Ranked'], ['c', 'Converts'], ['u', 'Loved & Unranked']];
/** The top plays' mod choice for no filter at all. */
const ANY = 'Any';
const KEY = { c: 'cv', u: 'ul', r: 'pp' };

// Footnotes in the community's words, per board.
const FOOTNOTE = {
  converts: 'Converts or specifics? Pick a side (and brace for the argument).',
  loved: 'The higher the star rating, the better the #1. NF snipes aren’t real snipes.',
};

/**
 * How a board marks an inactive player: greyed out, and tagged "legend" (lore.js) or a quiet "inactive". On the
 * official (Ranked) boards only being inactive on osu! counts.
 */
function inactiveMark(p, official) {
  if (!p) return { greyed: false, tag: '' };
  const offOsu = official && isInactiveOnOsu(p);
  return {
    greyed: official ? offOsu : isInactive(p),
    tag: official ? (isLegend(p) ? legendTag() : offOsu ? inactiveTag(p) : '') : statusTag(p),
  };
}

/** On phones only rank, player and pp stay; the other numbers move under the name. */
function boardTable(list, cat, me, title, at) {
  const key = KEY[cat];
  const ranked = cat === 'r';
  return html`<div class="table-wrap" data-label="${title} leaderboard"><table>
    <thead><tr>
      <th>#</th><th>Player</th><th class="num">pp</th>
      ${ranked
        ? html`<th class="num col-opt">Global</th><th class="num col-opt">Country</th><th class="num col-opt">Accuracy</th><th class="num col-opt">Level</th>`
        : html`<th class="num col-opt">Scores</th><th class="num col-opt">#1s in PT</th><th class="num col-opt">Last played</th>`}
    </tr></thead>
    <tbody>${list.map((p, i) => {
      // Inactive players stay on the board, greyed out (Ranked: those inactive on osu!, kept with their official pp).
      const offOsu = ranked && isInactiveOnOsu(p);
      const { greyed, tag } = inactiveMark(p, ranked);
      const noRank = html`<span class="faint" title="Inactive on osu!, so no global or country rank">—</span>`;
      return html`<tr class="${p.id === me ? 'me' : ''} ${p.id === at ? 'target' : ''} ${greyed ? 'inactive' : ''}" data-name="${p.name.toLowerCase()}">
        <td class="rank">${ranked ? i + 1 : p.rank[cat]}</td>
        <td class="cell-player">${playerLink(p)}${tag ? html` ${tag}` : ''}
          <span class="cell-sub">${ranked
            ? (offOsu ? `Inactive on osu! · ${p.ppSource === 'estimated' ? 'pp estimated from their plays' : p.ppSeen ? `pp last seen ${fmt.date(p.ppSeen)}` : 'last known pp'}` : `${fmt.rank(p.global)} global · ${fmt.acc(p.acc)}`)
            : `${fmt.plural(p.count[cat], 'score')} · ${fmt.plural(p.firsts[cat], '#1', '#1s')}`}</span></td>
        <td class="num">${ranked ? officialPp(p) : ppText(p[key])}</td>
        ${ranked
          ? html`<td class="num col-opt">${offOsu ? noRank : fmt.rank(p.global)}</td><td class="num col-opt">${offOsu ? noRank : fmt.rank(p.country)}</td><td class="num col-opt">${fmt.acc(p.acc)}</td><td class="num col-opt">${fmt.num(p.level, 0)}</td>`
          : html`<td class="num col-opt">${fmt.num(p.count[cat])}</td><td class="num col-opt">${fmt.num(p.firsts[cat])}</td><td class="num faint col-opt">${p.last ? fmt.ago(p.last) : '—'}</td>`}
      </tr>`;
    })}</tbody>
  </table></div>`;
}

function modsTable(rows, maps, index, me, mod, official) {
  if (!rows.length) return empty('Nobody has plays with this mod combination.');
  return html`<div class="table-wrap" data-label="${mod} leaderboard"><table>
    <thead><tr><th>#</th><th>Player</th><th class="num">Weighted pp</th><th class="num col-opt">Plays</th><th class="col-opt">Best play</th><th class="num col-opt">pp</th></tr></thead>
    <tbody>${rows.map(([id, pp, count, top], i) => {
      const { greyed, tag } = inactiveMark(index.get(id), official);
      return html`<tr class="${id === me ? 'me' : ''} ${greyed ? 'inactive' : ''}" data-name="${(index.get(id)?.name || '').toLowerCase()}">
      <td class="rank">${i + 1}</td>
      <td class="cell-player">${playerLink(id, index)}${tag ? html` ${tag}` : ''}<span class="cell-sub">${fmt.plural(count, 'play')} · best ${fmt.pp(top[S.PP])} pp</span></td>
      <td class="num">${ppText(pp)}</td>
      <td class="num col-opt">${fmt.num(count)}</td>
      <td class="wide col-opt">${mapLink(top[S.MAP], maps[top[S.MAP]])}</td>
      <td class="num col-opt">${modsBadges(top[S.MODS])} ${ppText(top[S.PP])}</td>
    </tr>`;
    })}</tbody>
  </table></div>`;
}

/** The top plays: [userId, category, ...score] rows, best first. Ranked mixes ranked maps and converts, so it says which. */
function playsList(rows, maps, index, me, source) {
  if (!rows.length) return empty('Nobody has plays with this mod combination.');
  return html`<div class="rows">${rows.map(([uid, cat, ...s], i) => {
    const p = index.get(uid);
    const { greyed, tag } = inactiveMark(p, source === 'r');
    return html`<div class="row ${uid === me ? 'me' : ''} ${greyed ? 'inactive' : ''}" data-name="${(p?.name || '').toLowerCase()}">
      <div class="row-main">
        ${mapLink(s[S.MAP], maps[s[S.MAP]])}
        <div>${playerLink(uid, index, 'avatar-sm')}${tag ? html` ${tag}` : ''}</div>
      </div>
      <div class="row-meta">
        ${source === 'r' ? catChip(cat) : ''}
        ${scoreStats(s)}
        <span class="sep"></span>
        ${posBadge(i + 1, 'Place in these top plays')}
        ${ppText(s[S.PP])}
        <span class="faint" title="${fmt.dateTime(s[S.TIME])}">${fmt.date(s[S.TIME])}</span>
      </div>
    </div>`;
  })}</div>`;
}

export default async function rankings(root, { params, query, isCurrent }) {
  const board = BOARDS.find(b => b.slug === params.board) ?? BOARDS[0];
  const slug = board.slug;
  const [list, m, mods, plays, recs] = await Promise.all([
    players(), meta(), slug === 'mods' ? modRankings() : null, slug === 'plays' ? topPlays() : null,
    slug === 'kings' ? records() : null,
  ]);
  if (!isCurrent()) return;
  setTitle(slug === 'plays' ? board.title : `${board.title} leaderboard`);
  const index = new Map(list.map(p => [p.id, p]));
  const me = prefs.get('me', null);

  if (slug === 'kings') {
    root.innerHTML = String(html`
      ${pageHead({ title: 'Leaderboards', extra: html`<p class="page-links"><a href="#/players">All players</a><a href="#/compare">Compare two players</a></p>` })}
      ${tabs(BOARDS.map(b => ({ href: `#/rankings/${b.slug}`, label: b.label, active: b === board })), 'Leaderboard type')}
      <p class="muted">${INTRO.kings}</p>
      ${starKingsBoards(recs?.kings, index, me)}
    `);
    const titles = recs?.kings ? Object.values(recs.kings).reduce((n, rows) => n + rows.length, 0) : 0;
    announce(`${fmt.plural(titles, 'star title')} across catch maps and converts.`);
    return;
  }

  let source = SOURCES.some(([k]) => k === query.src) ? query.src : 'r';
  // Mods ranks players by one mod (HD unless asked); the top plays can also take any mods, and start there.
  const filtered = Boolean(mods || plays);
  const modChoices = mods ? mods.filters : plays ? [ANY, ...plays.filters] : [];
  const defaultMod = slug === 'plays' ? ANY : 'HD';
  let mod = modChoices.includes(query.mod) ? query.mod : defaultMod;

  root.innerHTML = String(html`
    ${pageHead({ title: 'Leaderboards', extra: html`<p class="page-links"><a href="#/players">All players</a><a href="#/compare">Compare two players</a></p>` })}
    ${tabs(BOARDS.map(b => ({ href: `#/rankings/${b.slug}`, label: b.label, active: b === board })), 'Leaderboard type')}
    <p class="muted">${INTRO[slug]}${slug === 'ranked' && m.dump ? html` <span class="faint">Players and plays imported from the osu! data dump of ${m.dump.replaceAll('_', '-')}.</span>` : ''}</p>
    <div class="toolbar">
      <input class="input" type="search" id="filter" placeholder="Search players…" aria-label="Search this leaderboard" value="${query.q || ''}">
      ${slug === 'converts' || slug === 'loved' || filtered ? html`<span class="checks"><label><input type="checkbox" id="legends" ${query.legends === '0' ? '' : 'checked'}> Show inactive players</label></span>` : ''}
      ${slug === 'ranked' && list.some(p => isInactiveOnOsu(p) && p.pp > 0) ? html`<span class="checks"><label><input type="checkbox" id="legends" ${query.legends === '0' ? '' : 'checked'}> Show players inactive on osu!</label></span>` : ''}
    </div>
    ${filtered ? html`
      <div id="sources" class="mb-2">${chipGroup('Plays from', 'src', SOURCES, source)}</div>
      <div id="modchips" class="mb-4">${chipGroup('Mod', 'mod', modChoices.map(f => [f, f]), mod)}</div>` : ''}
    <p class="result-count" id="count"></p>
    <div id="board"></div>
    <div id="board-empty"></div>
    <p class="mt-3 small"><a href="#/players">Browse all ${fmt.num(list.length)} players</a></p>
    ${FOOTNOTE[slug] ? html`<p class="mt-2 small faint">${FOOTNOTE[slug]}</p>` : ''}
  `);

  const boardEl = root.querySelector('#board');
  const filter = root.querySelector('#filter');
  const legends = root.querySelector('#legends');
  const count = root.querySelector('#count');
  const emptyEl = root.querySelector('#board-empty');

  const saveQuery = () => writeQuery({
    q: filter.value.trim(), legends: legends && !legends.checked ? '0' : '',
    ...(filtered ? { src: source, mod } : {}),
  }, { src: 'r', mod: defaultMod });

  const applyFilter = ({ speak = false } = {}) => {
    const q = filter.value.trim().toLowerCase();
    const rows = [...boardEl.querySelectorAll('[data-name]')];
    let shown = 0;
    rows.forEach(tr => {
      const hide = Boolean(q && !tr.dataset.name.includes(q)) || (legends && !legends.checked && tr.classList.contains('inactive'));
      tr.classList.toggle('hidden', hide);
      if (!hide) shown++;
    });
    const text = rows.length ? resultCount(shown, rows.length, slug === 'plays' ? 'play' : 'player') : '';
    count.textContent = text;
    // A filter that matches nobody says so (with the way back) instead of leaving a table of headers.
    boardEl.querySelector('.table-wrap, .rows')?.classList.toggle('hidden', rows.length > 0 && !shown);
    emptyEl.innerHTML = rows.length && !shown ? String(emptyFiltered(q ? `No player ${slug === 'plays' ? 'in these top plays' : 'on this leaderboard'} matches “${filter.value.trim()}”.` : 'Nobody here is active right now.')) : '';
    if (speak) announce(text);
  };
  let timer;
  filter.addEventListener('input', () => {
    applyFilter();
    clearTimeout(timer);
    timer = setTimeout(() => { saveQuery(); announce(count.textContent); }, 400);
  });
  legends?.addEventListener('change', () => { applyFilter({ speak: true }); saveQuery(); });
  emptyEl.addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    filter.value = '';
    if (legends) legends.checked = true;
    applyFilter({ speak: true });
    saveQuery();
    filter.focus();
  });

  if (slug === 'plays' && !plays) {
    // Data exported before the top plays existed (the development site reads the release site's data).
    boardEl.innerHTML = String(empty('The top plays arrive with the next data update.'));
    return;
  }
  if (!filtered) {
    const cat = SLUG_CAT[slug];
    // The official board is everyone with an osu! rank plus players inactive on osu! (kept with their official pp),
    // all ordered by pp; the other boards come ranked from the exporter.
    const rows = cat === 'r'
      ? list.filter(p => p.rank.r || (isInactiveOnOsu(p) && p.pp > 0)).sort((a, b) => b.pp - a.pp || (a.rank.r ?? Infinity) - (b.rank.r ?? Infinity))
      : list.filter(p => p.rank[cat]).sort((a, b) => a.rank[cat] - b.rank[cat]);
    // ?at=<player id> (a profile's rank links here): mark that player's row and bring it into view.
    const at = Number(query.at) || null;
    boardEl.innerHTML = String(rows.length ? boardTable(rows, cat, me, board.title, at) : empty(`Nobody is on the ${CAT_LABEL[cat]} leaderboard yet.`));
    applyFilter();
    boardEl.querySelector('tr.target:not(.hidden)')?.scrollIntoView({ block: 'center' });
    return;
  }

  const draw = ({ speak = false } = {}) => {
    setPressed(root, 'src', source);
    setPressed(root, 'mod', mod);
    boardEl.innerHTML = String(mods
      ? modsTable(mods.sources[source][mod], mods.maps, index, me, mod, source === 'r')
      : playsList(topPlaysView(plays.plays, source, mod === ANY ? null : parseModFilter(mod), plays.cap), plays.maps, index, me, source));
    applyFilter({ speak });
    saveQuery();
  };
  root.querySelector('#sources').addEventListener('click', e => {
    const b = e.target.closest('[data-src]');
    if (b) { source = b.dataset.src; draw({ speak: true }); }
  });
  root.querySelector('#modchips').addEventListener('click', e => {
    const b = e.target.closest('[data-mod]');
    if (b) { mod = b.dataset.mod; draw({ speak: true }); }
  });
  draw();
}
