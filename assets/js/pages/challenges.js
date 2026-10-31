import { html, raw } from '../core/html.js';
import { challenges, playerIndex, dan, completion, meta } from '../core/data.js';
import { S, M } from '../core/model.js';
import {
  setTitle, mapLink, playerLink, scoreStats, ppText, posBadge, catChip, bannerArt, mapText, starsBadge, empty, osuMap, prefs,
  pageHead, scoreWhen, setCover, paginate, writeQuery, announce, resultCount, emptyFiltered, tabs,
} from '../core/ui.js';
import { passCounts, topStage } from '../core/ladder.js';
import { danName } from '../core/events.js';
import { ANY_STARS, parseStars, formatStars, starsLabel, inStars, isAnyStars } from '../core/star-range.js';
import { starSlider, bindStarSlider } from '../core/star-slider.js';
import { renderDan, DAN_INTRO } from './dan.js';
import * as fmt from '../core/fmt.js';
import { t, th } from '../core/i18n.js';

// Four sub-pages with their own URLs (#/challenges/week, /dan, /targets, /completion). "Dan" keeps the community's own
// word. They're tabs, like the leaderboards', and each tab shows where that challenge stands right now.
const TABS = [
  { slug: 'week', label: t('This week'), intro: th('A new map every Monday. The community votes for the next one on Discord; the week’s best plays and the vote are on {activity}.', { activity: html`<a href="#/activity?view=week">${t('Activity')}</a>` }) },
  { slug: 'dan', label: t('Dan course'), intro: DAN_INTRO },
  { slug: 'targets', label: t('Snipe targets'), intro: t('#1s that are begging to be sniped, boss maps nobody has FC’d, and maps nobody in Portugal has played yet.') },
  { slug: 'completion', label: t('Completion'), intro: t('A map counts once any Portuguese player passes it without NF. The goal is every ranked osu!catch-specific difficulty; converts are a separate count.') },
];

/** Each tab's figure: the map of the week's time left, Portugal's highest Dan, #1s up for grabs, the share cleared. */
function tabFigures(data, index, goal) {
  const left = data.week ? Math.max(0, data.week.end - Date.now() / 1000) : 0;
  const top = topStage(passCounts(index.values()));
  return {
    week: data.week ? (left >= 86400 ? t('{n}d left', { n: Math.floor(left / 86400) }) : t('{n}h left', { n: Math.floor(left / 3600) })) : undefined,
    dan: top >= 0 ? danName(top) : undefined,
    targets: data.beatable.length,
    completion: goal?.total ? `${fmt.num((goal.cleared / goal.total) * 100, 1)}%` : undefined,
  };
}

function countdown(end) {
  const left = Math.max(0, end - Date.now() / 1000);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = Math.floor(left % 60);
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

/** On phones: rank, player (with the play under the name) and pp; score, play and time are desktop columns. */
function boardTable(rows, index, me, label) {
  return html`<div class="table-wrap" data-label="${label}"><table class="table-compact">
    <thead><tr><th>#</th><th>${t('Player')}</th><th class="num col-opt">${t('Score')}</th><th class="col-opt">${t('Play')}</th><th class="num">pp</th><th class="num col-opt">${t('When')}</th></tr></thead>
    <tbody>${rows.map(([uid, ...s], i) => html`<tr class="${uid === me ? 'me' : ''}">
      <td>${posBadge(i + 1)}</td>
      <td class="cell-player">${playerLink(uid, index, 'avatar-sm')}<span class="cell-sub"><span class="score-line">${scoreStats(s)}</span></span></td>
      <td class="num col-opt">${fmt.num(s[S.SCORE])}</td>
      <td class="col-opt"><span class="score-line">${scoreStats(s)}</span></td><td class="num">${ppText(s[S.PP])}</td>
      <td class="num faint col-opt">${scoreWhen(s, fmt.ago(s[S.TIME]))}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

function weekSection(week, maps, index, me) {
  if (!week) return empty(t('No map of the week yet.'));
  const meta = maps[week.map];
  const { title, sub } = mapText(week.map, meta);
  return html`
    <section class="banner">
      ${bannerArt(meta?.[M.SET])}
      <div class="banner-body">
        <div class="links">
          <span class="badge badge-accent">${t('Week {n}', { n: week.id.split('-W')[1] })}</span>
          ${catChip(week.cat)} ${meta ? starsBadge(meta[M.STARS]) : ''}
        </div>
        <h3 class="banner-title"><a href="#/map/${week.map}">${title}</a></h3>
        <div class="sub">${sub}</div>
        <p class="m-0 mt-3">${th('Ends in {countdown}', { countdown: html`<span class="countdown" id="countdown">${countdown(week.end)}</span>` })}</p>
      </div>
    </section>
    <div class="mt-3 mb-6 btn-row">
      <a class="btn btn-primary" href="${osuMap(week.map)}" target="_blank" rel="noopener">${t('Open on osu!')} ↗</a>
      <a class="btn" href="#/map/${week.map}">${t('Full leaderboard')}</a>
    </div>
    <div class="section-head"><h2>${t('This week’s plays')}</h2></div>
    ${week.weekly.length ? boardTable(week.weekly, index, me, t('This week’s plays on the map of the week')) : empty(t('Nobody has played this map this week. Be the first!'))}
    <div class="mt-6 section-head"><h2>${t('All-time top')}</h2></div>
    ${boardTable(week.board.slice(0, 10), index, me, t('All-time top 10 on the map of the week'))}`;
}

export default async function challengesPage(root, { params, query, isCurrent }) {
  const tab = TABS.find(x => x.slug === params.tab) ?? TABS[0];
  const goal = tab.slug === 'completion';
  // challenges.json (about 12 KB, and cached) comes on every tab for the tabs' figures; meta.json is already loaded.
  const [data, index, danData, goalData, m] = await Promise.all([
    challenges(), playerIndex(), tab.slug === 'dan' ? dan() : null, goal ? completion() : null, meta(),
  ]);
  if (!isCurrent()) return;
  setTitle(tab.slug === 'week' ? t('Challenges') : `${tab.label} · ${t('Challenges')}`);
  const me = prefs.get('me', null);
  const maps = data.maps;
  const figures = tabFigures(data, index, m.completion);

  root.innerHTML = String(html`
    ${pageHead({ title: t('Challenges') })}
    ${tabs(TABS.map(x => ({ href: `#/challenges/${x.slug}`, label: x.label, count: figures[x.slug], active: x === tab })), t('Challenges'))}
    <p class="muted tabs-intro">${tab.intro}</p>
    <div id="panel">${tab.slug === 'week' ? weekPanel(data, maps, index, me) : tab.slug === 'targets' ? targetsPanel(data, maps, index) : ''}</div>
  `);

  if (tab.slug === 'dan') renderDan(root.querySelector('#panel'), danData, index, query);
  if (goal) renderCompletion(root.querySelector('#panel'), goalData, index, query);
  if (tab.slug === 'week' && data.week) {
    const el = root.querySelector('#countdown');
    const timer = setInterval(() => {
      if (!isCurrent() || !el.isConnected) return clearInterval(timer);
      el.textContent = countdown(data.week.end);
    }, 1000);
  }
}

function weekPanel(data, maps, index, me) {
  return html`
    <section>
      <div class="section-head"><h2>${t('Map of the week')}</h2></div>
      ${weekSection(data.week, maps, index, me)}
    </section>`;
}

function targetsPanel(data, maps, index) {
  return html`
    <section>
      <div class="section-head"><h2>${t('Vulnerable #1s')}</h2><span class="muted small">${t('Contested maps where the #1 has misses or under 97% accuracy.')}</span></div>
      ${data.beatable.length ? html`<div class="rows">${data.beatable.map(([id, cat, n, [uid, ...s]]) => html`<div class="row">
        <div>${mapLink(id, maps[id])}</div>
        <div class="row-meta">${catChip(cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span class="faint">#1</span> ${playerLink(uid, index, 'avatar-sm')} ${scoreStats(s, { combo: false })} ${ppText(s[S.PP])}</div>
      </div>`)}</div>` : empty(t('Every #1 is well defended. For now.'))}
    </section>

    ${data.bounties?.length ? html`<section class="section">
      <div class="section-head"><h2>${t('Bounty board')}</h2><span class="muted small">${t('Boss maps (6.5★ and up) that several Portuguese players have passed but nobody has FC’d.')}</span></div>
      <div class="rows">${data.bounties.map(([id, cat, n, fewest]) => html`<div class="row">
        <div>${mapLink(id, maps[id])}</div>
        <div class="row-meta">${catChip(cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span>${t('closest: {misses}', { misses: fmt.plural(fewest, 'miss', 'misses') })}</span><span class="bounty-tag">${t('Nobody’s FC’d this. Yet.')}</span></div>
      </div>`)}</div>
    </section>` : ''}

    <section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('One-player maps')}</h2></div>
        <p class="muted small">${t('Hard maps (5★ and up; loved and unranked ones under 10★) with a single Portuguese player. Just pass to take #2, or beat them for #1.')}</p>
        ${data.lonely.length ? html`<div class="rows">${data.lonely.map(([id, cat, [uid, ...s]]) => html`<div class="row-1col row">
          ${mapLink(id, maps[id])}
          <div class="justify-start row-meta">${catChip(cat)} ${playerLink(uid, index, 'avatar-sm')} ${ppText(s[S.PP])}</div>
        </div>`)}</div>` : empty(t('No one-player maps.'))}
      </div>
      <div>
        <div class="section-head"><h2>${t('Unclaimed')}</h2></div>
        <p class="muted small">${t('Popular ranked osu!catch maps with no Portuguese score recorded.')}</p>
        ${data.unclaimed.length ? html`<div class="rows">${data.unclaimed.map(([id, plays, favs]) => html`<div class="row-1col row">
          ${mapLink(id, maps[id])}
          <div class="justify-start row-meta">${t('{plays} plays on osu! · {favs} favourites', { plays: fmt.num(plays), favs: fmt.num(favs) })}</div>
        </div>`)}</div>` : empty(t('Nothing left to claim. Impressive.'))}
      </div>
    </section>`;
}

// ---- Completion ------------------------------------------------------------------------------------------------------
// completion.json (tools/lib/completion.mjs): how many ranked catch-specific maps Portugal has cleared, and the rest as a
// to-do list. Rows of `left`: [mapId, setId, version, stars, rankedDay, osu! plays, length]; `sets`: { setId: [artist,
// title] }. Length (drain seconds) is newer than the rest: data from before it has none, and then the length sorts hide.

const byPlays = (a, b) => b[5] - a[5] || a[0] - b[0];
/** Shortest (1) or longest (-1) first; maps without a length go last either way, ties keep the default order. */
const byLength = dir => (a, b) => !a[6] - !b[6] || dir * ((a[6] ?? 0) - (b[6] ?? 0)) || byPlays(a, b);
/** key: [label, compare, needs lengths] */
const LEFT_SORTS = {
  popular: [t('Most played on osu!'), byPlays],
  easy: [t('Fewest stars'), (a, b) => a[3] - b[3] || a[0] - b[0]],
  hard: [t('Most stars'), (a, b) => b[3] - a[3] || a[0] - b[0]],
  new: [t('Newest ranked'), (a, b) => (b[4] ?? 0) - (a[4] ?? 0) || b[0] - a[0]],
  short: [t('Shortest first'), byLength(1), true],
  long: [t('Longest first'), byLength(-1), true],
};
const LEFT_PAGE = 50;
const percent = (n, total) => (total ? (n / total) * 100 : 0);

function leftRow([id, set, version, stars, rankedDay, plays, length], sets) {
  const named = sets[set];
  const title = named ? `${named[0]} - ${named[1]}` : t('Map #{id}', { id });
  return html`<a class="row card-link" href="#/map/${id}">
    <span class="map">
      ${setCover(set)}
      <span class="map-text">
        <span class="map-title" title="${title}">${title}</span>
        <span class="map-sub">${starsBadge(stars)} [${version}]</span>
      </span>
    </span>
    <span class="row-meta">
      ${length ? html`<span>${fmt.duration(length)}</span><span class="sep"></span>` : ''}
      ${rankedDay ? html`<span>${t('Ranked {date}', { date: fmt.monthYear(rankedDay * 86400) })}</span><span class="sep"></span>` : ''}
      <span>${t('{plays} on osu!', { plays: fmt.plural(plays, 'play') })}</span>
    </span>
  </a>`;
}

function renderCompletion(panel, goal, index, query) {
  if (!goal) {
    panel.innerHTML = String(empty(t('The completion goal arrives with the next data update.')));
    return;
  }
  const pct = percent(goal.cleared, goal.total);
  const conv = goal.converts;
  let stars = parseStars(query);
  const timed = goal.left.some(r => r[6]);
  const sorts = Object.entries(LEFT_SORTS).filter(([, [, , needsLength]]) => timed || !needsLength);
  let sortKey = sorts.some(([k]) => k === query.sort) ? query.sort : 'popular';
  let page = Math.max(0, (Number(query.page) || 1) - 1);

  panel.innerHTML = String(html`
    <section class="goal">
      <p class="goal-figure">${fmt.num(pct, 1)}%</p>
      <p class="goal-of">${goal.players
        ? th('{cleared} of {total} ranked osu!catch maps cleared, by {players}', { cleared: html`<b>${fmt.num(goal.cleared)}</b>`, total: html`<b>${fmt.num(goal.total)}</b>`, players: fmt.plural(goal.players, 'player') })
        : th('{cleared} of {total} ranked osu!catch maps cleared', { cleared: html`<b>${fmt.num(goal.cleared)}</b>`, total: html`<b>${fmt.num(goal.total)}</b>` })}</p>
      <div class="goal-bar" role="meter" aria-label="${t('Ranked osu!catch maps cleared')}" aria-valuemin="0" aria-valuemax="${goal.total}"
        aria-valuenow="${goal.cleared}" aria-valuetext="${t('{pct}% cleared', { pct: fmt.num(pct, 1) })}" style="--done:${pct.toFixed(2)}%"><span></span></div>
      ${conv?.total ? html`<p class="goal-aside">${t('Converts, the long road: {cleared} of {total} ranked osu!standard maps ({pct}%).', { cleared: fmt.num(conv.cleared), total: fmt.num(conv.total), pct: fmt.num(percent(conv.cleared, conv.total), 1) })}</p>` : ''}
    </section>

    ${goal.recent.length || goal.sole.length ? html`<section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('Recently cleared')}</h2></div>
        <p class="muted small">${t('The newest first clears: the earliest pass on record for each map.')}</p>
        ${goal.recent.length ? html`<div class="rows">${goal.recent.map(([id, uid, t]) => html`<div class="row">
          ${mapLink(id, goal.maps[id])}
          <div class="row-meta">${playerLink(uid, index, 'avatar-sm')} <span class="faint">${fmt.ago(t)}</span></div>
        </div>`)}</div>` : empty(t('No dated clears yet.'))}
      </div>
      <div>
        <div class="section-head"><h2>${t('Only they have cleared')}</h2></div>
        <p class="muted small">${t('Ranked maps no other Portuguese player has passed.')}</p>
        ${goal.sole.length ? html`<div class="rows">${goal.sole.map(([uid, n], i) => html`<div class="row">
          <span class="goal-who"><span class="faint">${i + 1}</span> ${playerLink(uid, index, 'avatar-sm')}</span>
          <span class="row-meta">${fmt.plural(n, 'map')}</span>
        </div>`)}</div>` : empty(t('Every cleared map has at least two players on it.'))}
      </div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>${t('Not cleared yet')}</h2><span class="muted small">${t('Ranked maps no Portuguese player has passed.')}</span></div>
      ${goal.left.length ? html`
        <div class="toolbar">
          <select class="select" id="left-sort" aria-label="${t('Sort')}">${sorts.map(([k, [label]]) => html`<option value="${k}" ${k === sortKey ? raw('selected') : ''}>${label}</option>`)}</select>
        </div>
        ${starSlider(stars)}
        <p class="result-count" id="left-count"></p>
        <div id="left-list"></div>` : empty(t('Every ranked osu!catch map is cleared. Converts next?'))}
    </section>
  `);
  if (!goal.left.length) return;

  const sort = panel.querySelector('#left-sort');
  const count = panel.querySelector('#left-count');
  const visible = () => goal.left.filter(r => inStars(r[3], stars)).sort(LEFT_SORTS[sortKey][1]);
  const save = () => writeQuery({ sort: sortKey, stars: formatStars(stars), page: page + 1 }, { sort: 'popular', page: 1 });
  let items = visible();
  const showCount = speak => {
    count.textContent = resultCount(items.length, goal.left.length, 'map');
    if (speak) announce(count.textContent);
  };
  const redraw = paginate(panel.querySelector('#left-list'), items, slice => html`<div class="rows">${slice.map(r => leftRow(r, goal.sets))}</div>`, LEFT_PAGE, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => emptyFiltered(t('No uncleared maps at {stars}.', { stars: starsLabel(stars) })),
  });
  showCount(false);
  // A new sort or range starts again from the first page (paginate's redraw, which saves it).
  const refilter = () => {
    items = visible();
    redraw(items);
    showCount(true);
  };
  sort.addEventListener('change', () => { sortKey = sort.value; refilter(); });
  const slider = bindStarSlider(panel, stars, next => { stars = next; refilter(); });
  panel.querySelector('#left-list').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    stars = [...ANY_STARS];
    slider.set(stars);
    refilter();
  });
}
