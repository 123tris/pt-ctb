import { html, raw } from '../core/html.js';
import { challenges, bounties, hill, duels, playerIndex, dan, completion, meta } from '../core/data.js';
import { S, M } from '../core/model.js';
import {
  setTitle, mapLink, playerLink, scoreStats, ppText, posBadge, catChip, bannerArt, mapText, starsBadge, empty, osuMap, myId,
  pageHead, scoreWhen, setCover, paginate, writeQuery, announce, resultCount, emptyFiltered, tabs, scrollBehavior,
} from '../core/ui.js';
import { economy } from '../core/bananas.js';
import { bountiesPanel, wireBounties } from './bounties.js';
import { passCounts, topStage } from '../core/ladder.js';
import { danName } from '../core/events.js';
import { ANY_STARS, parseStars, formatStars, starsLabel, inStars, isAnyStars } from '../core/star-range.js';
import { starSlider, bindStarSlider } from '../core/star-slider.js';
import { renderDan, DAN_INTRO } from './dan.js';
import { renderHill } from './hill.js';
import { renderDuels } from './duels.js';
import { timeLeft } from '../core/hill.js';
import { runningNow, challengeChips } from '../core/challenge-chips.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

// Seven sub-pages with their own URLs (/challenges/week, /hill, /duels, /dan, /targets, /bounties, /completion). "Dan" keeps the
// community's own word. They're tabs, like the leaderboards', and each tab shows where that challenge stands right now.
// The week, the month's King of the hill and the bounties are what's on now: a map in more than one of them carries
// the others' chips (core/challenge-chips.js), here and on its map page.
const TABS = [
  { slug: 'week', label: t('This week'), intro: th('A new map every Monday. The community votes for the next one on Discord; the week’s best plays and the vote are on {activity}.', { activity: html`<a href="/activity?view=week">${t('Activity')}</a>` }) },
  // Only once the export has hill.json (the bot started King of the hill): see `shown` below.
  { slug: 'hill', label: t('King of the hill'), intro: th('A pool of maps each month, one per slot, in an Open and an easier Challenger tier (from November 2026: 6–9★ and 4.5–6.5★). Hold a map’s best play when the month ends to keep its crown. {more}', { more: html`<a href="/glossary?at=crown">${t('How crowns work')}</a>` }) },
  // Only once the export has duels.json (the bot started duels), like King of the hill.
  { slug: 'duels', label: t('Duels'), intro: th('Rated 1v1s on random maps of the right difficulty, played in an osu! lobby. Type {command} on the Discord to challenge someone: the bot follows the lobby and scores every round.', { command: html`<code>/duel</code>` }) },
  { slug: 'dan', label: t('Dan course'), intro: DAN_INTRO },
  { slug: 'targets', label: t('Snipe targets'), intro: t('#1s that are begging to be sniped, maps with a single Portuguese player, and maps nobody in Portugal has played yet.') },
  { slug: 'bounties', label: t('Bounties'), intro: t('Prizes the community puts up for hard maps: full combo one, pass it first or take its #1, and the bot announces the claim on Discord.') },
  { slug: 'completion', label: t('Completion'), intro: t('A map counts once any Portuguese player passes it without NF. The goal is every ranked osu!catch-specific difficulty; converts are a separate count.') },
];

/**
 * Each tab's figure: the map of the week's time left, the month's, duels being played, Portugal's highest Dan, #1s up
 * for grabs, open bounties, the share cleared.
 */
function tabFigures(data, board, index, goal, month, duelsNow) {
  const left = data.week ? Math.max(0, data.week.end - Date.now() / 1000) : 0;
  const top = topStage(passCounts(index.values()));
  return {
    week: data.week ? (left >= 86400 ? t('{n}d left', { n: Math.floor(left / 86400) }) : t('{n}h left', { n: Math.floor(left / 3600) })) : undefined,
    hill: month?.status === 'live' ? timeLeft(month.end) : undefined,
    duels: duelsNow?.live ? t('{n} live', { n: fmt.num(duelsNow.live) }) : undefined,
    dan: top >= 0 ? danName(top) : undefined,
    targets: data.beatable.length,
    bounties: board ? board.open.length : undefined,
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

function weekSection(week, maps, index, me, now) {
  if (!week) return empty(t('No map of the week yet.'));
  const meta = maps[week.map];
  const { title, sub } = mapText(week.map, meta);
  return html`
    <section class="banner">
      ${bannerArt(meta?.[M.SET])}
      <div class="banner-body">
        <div class="links">
          <span class="badge badge-accent">${t('Week {n}', { n: week.id.split('-W')[1] })}</span>
          ${catChip(week.cat)} ${meta ? starsBadge(meta[M.STARS]) : ''} ${challengeChips(week.map, now, 'week')}
        </div>
        <h3 class="banner-title"><a href="/map/${week.map}">${title}</a></h3>
        <div class="sub">${sub}</div>
        <p class="m-0 mt-3">${th('Ends in {countdown}', { countdown: html`<span class="countdown" id="countdown">${countdown(week.end)}</span>` })}</p>
      </div>
    </section>
    <div class="mt-3 mb-6 btn-row">
      <a class="btn btn-primary" href="${osuMap(week.map)}" target="_blank" rel="noopener">${t('Open on osu!')} ↗</a>
      <a class="btn" href="/map/${week.map}">${t('Full leaderboard')}</a>
    </div>
    <div class="section-head"><h2>${t('This week’s plays')}</h2></div>
    ${week.weekly.length ? boardTable(week.weekly, index, me, t('This week’s plays on the map of the week')) : empty(t('Nobody has played this map this week. Be the first!'))}
    <div class="mt-6 section-head"><h2>${t('All-time top')}</h2></div>
    ${boardTable(week.board.slice(0, 10), index, me, t('All-time top 10 on the map of the week'))}`;
}

export default async function challengesPage(root, { params, query, isCurrent }) {
  const asked = params.tab;
  // challenges.json (about 12 KB) and bounties.json (smaller), both cached, come on every tab for the tabs' figures and
  // chips; meta.json is already loaded, with the King of the hill month and the duels in brief. hill.json and duels.json
  // only come for their tabs.
  const [data, board, index, danData, goalData, m, crowns, eco, duelData] = await Promise.all([
    challenges(), bounties(), playerIndex(), asked === 'dan' ? dan() : null, asked === 'completion' ? completion() : null, meta(),
    asked === 'hill' ? hill() : null, asked === 'bounties' ? economy().catch(() => null) : null, asked === 'duels' ? duels() : null,
  ]);
  if (!isCurrent()) return;
  const shown = TABS.filter(x => (x.slug !== 'hill' || m.files?.['hill.json']) && (x.slug !== 'duels' || m.files?.['duels.json']));
  const tab = shown.find(x => x.slug === asked) ?? shown[0];
  const goal = tab.slug === 'completion';
  const now = runningNow({ challenges: data, meta: m, bounties: board });
  setTitle(tab.slug === 'week' ? t('Challenges') : `${tab.label} · ${t('Challenges')}`);
  const me = myId();
  const maps = data.maps;
  const figures = tabFigures(data, board, index, m.completion, m.hill, m.duels);

  root.innerHTML = String(html`
    ${pageHead({ title: t('Challenges') })}
    ${tabs(shown.map(x => ({ href: `/challenges/${x.slug}`, label: x.label, count: figures[x.slug], active: x === tab })), t('Challenges'))}
    <p class="muted tabs-intro">${tab.intro}</p>
    <div id="panel">${tab.slug === 'week' ? weekPanel(data, maps, index, me, now) : tab.slug === 'targets' ? targetsPanel(data, maps, index)
      : tab.slug === 'bounties' ? bountiesPanel(board, data, index, now, eco) : ''}</div>
  `);

  if (tab.slug === 'bounties' && eco) wireBounties(root, board, eco, isCurrent);
  if (tab.slug === 'hill') renderHill(root.querySelector('#panel'), { hill: crowns, index, me, query, now });
  if (tab.slug === 'duels') renderDuels(root.querySelector('#panel'), { duels: duelData, index, me, query, generatedAt: m.generatedAt });
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

function weekPanel(data, maps, index, me, now) {
  return html`
    <section>
      <div class="section-head"><h2>${t('Map of the week')}</h2></div>
      ${weekSection(data.week, maps, index, me, now)}
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

// ---- Bounties: pages/bounties.js ----------------------------------------------------------------------------------

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
  return html`<a class="row card-link" href="/map/${id}">
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

/**
 * A year's share as the strip's words say it: a whole year cleared is 100%, and anything short of it stops at 99.9%
 * (99.96% would round up), so the words agree with the column's colour.
 */
const yearPct = (cleared, total, digits = 1) => {
  if (cleared === total) return fmt.num(100, 0);
  const step = 10 ** -digits;
  return fmt.num(Math.min(100 - step, Math.round(percent(cleared, total) / step) * step), digits);
};
const yearFigures = ([year, total, cleared]) => ({ year, cleared: fmt.num(cleared), total: fmt.num(total), pct: yearPct(cleared, total) });
const isFull = ([, total, cleared]) => total > 0 && cleared === total;
/** A year's line under the strip: "2014: all 149 cleared", "2018: 696 of 709 cleared (98.1%)". */
const yearText = y => (!y[1] ? t('{year}: no ranked maps', { year: y[0] })
  : isFull(y) ? t('{year}: all {total} cleared', yearFigures(y)) : t('{year}: {cleared} of {total} cleared ({pct}%)', yearFigures(y)));
/** The unfinished year furthest behind (the lowest share, then the most maps left), for the strip's line at rest. */
const furthestBehind = years => years.filter(y => y[1] && !isFull(y)).reduce((a, b) => (!a || percent(b[2], b[1]) < percent(a[2], a[1])
  || (percent(b[2], b[1]) === percent(a[2], a[1]) && b[1] - b[2] > a[1] - a[2]) ? b : a), null);

/**
 * How far each year's ranked maps are cleared, as a strip of thin columns under the goal's bar: kept short and
 * unlabelled but for a few years, with one line that names the year furthest behind and, on hover or tap, the year
 * under the pointer. A year cleared to the last map is gold (an honour, as everywhere on the site), and a year short of
 * it always keeps a visible gap at the top, so 99% never passes for done and colour isn't the only signal. The line's
 * small gold square is the legend. Data from before completion.json had `years` shows nothing.
 */
function yearStrip(years) {
  if (!years || years.length < 2) return '';
  const n = years.length, last = n - 1;
  const labelled = years.map(([year], i) => i === 0 || i === last || (year % 5 === 0 && i > 2 && i < last - 2));
  const full = years.filter(isFull).length;
  const behind = furthestBehind(years);
  const parts = [
    full ? html`<span class="goal-years-full"><span class="goal-years-key"></span>${tn(full, '{n} year fully cleared', '{n} years fully cleared')}</span>` : '',
    behind ? t('furthest behind is {year}, with {cleared} of {total} cleared ({pct}%)', yearFigures(behind)) : t('every year fully cleared'),
  ].filter(Boolean);
  return html`<div class="goal-years">
    <div class="goal-years-cols" role="img" aria-label="${t('Share cleared by year ranked: {years}', { years: years.filter(y => y[1]).map(([y, total, cleared]) => `${y} ${yearPct(cleared, total, 0)}%`).join(', ') })}">
      ${years.map((y, i) => html`<span class="goal-year${!y[1] ? ' is-none' : isFull(y) ? ' is-full' : ''}" data-i="${i}" style="--done:${percent(y[2], y[1]).toFixed(1)}%"></span>`)}
    </div>
    <div class="goal-years-axis" aria-hidden="true">${years.map(([year], i) => labelled[i] ? html`<span style="left:${(((i + 0.5) / n) * 100).toFixed(2)}%">${year}</span>` : '')}</div>
    <p class="goal-years-note" aria-hidden="true"><span class="faint">${t('By year ranked:')}</span>
      <span id="year-rest">${parts.map((part, i) => html`${i ? ' · ' : ''}${part}`)}</span><span id="year-pick" hidden></span></p>
  </div>`;
}

function bindYearStrip(panel, years) {
  const cols = panel.querySelector('.goal-years-cols');
  if (!cols) return;
  const rest = panel.querySelector('#year-rest'), picked = panel.querySelector('#year-pick');
  let active = null;
  const show = col => {
    if (col === active) return;
    active?.classList.remove('is-active');
    active = col;
    cols.classList.toggle('is-pointing', Boolean(col));
    col?.classList.add('is-active');
    if (col) picked.textContent = yearText(years[col.dataset.i]);
    rest.hidden = Boolean(col);
    picked.hidden = !col;
  };
  // Touch has no hover: a tap picks a year and it stays until the next tap.
  const pick = e => show(e.target.closest('.goal-year') ?? active);
  cols.addEventListener('pointermove', pick);
  cols.addEventListener('pointerdown', pick);
  cols.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') show(null); });
}

/** completion.json's years with the years between them that ranked nothing as [year, 0, 0], so the strip spaces evenly. */
function everyYear(years) {
  if (!years?.length) return years;
  const by = new Map(years.map(y => [y[0], y]));
  const out = [];
  for (let year = years[0][0]; year <= years[years.length - 1][0]; year++) out.push(by.get(year) ?? [year, 0, 0]);
  return out;
}

function renderCompletion(panel, goal, index, query) {
  if (!goal) {
    panel.innerHTML = String(empty(t('The completion goal arrives with the next data update.')));
    return;
  }
  const years = everyYear(goal.years);
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
      ${yearStrip(years)}
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
  bindYearStrip(panel, years);
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
