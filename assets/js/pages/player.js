import { html, raw } from '../core/html.js';
import { playerFile, playerHead, playerIndex, history, records } from '../core/data.js';
import { S, CATS, DAN_STAGES, DAN_MAPS, danRole } from '../core/model.js';
import { danName } from '../core/events.js';
import { lineChart, chartHover } from '../core/charts.js';
import { playerBadges, era, signatureMap, localBadge, localEra } from '../core/badges.js';
import { THRONE_PLAYER } from '../core/lore.js';
import { jersey } from '../core/ladder.js';
import {
  setTitle, tabs, avatar, stat, scoreRow, paginate, empty, mapText, prefs, osuUser, CAT_LABEL, SLUG_CAT,
  mapLink, scoreStats, catChip, writeQuery, announce, resultCount, emptyFiltered, isInactiveOnOsu, inactiveTag, officialPpNote,
  isLegend, legendTag, gradeBadge, chipGroup, setPressed, placeholderRows,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

const SORTS = {
  pp: [t('Most pp'), (a, b) => b[S.PP] - a[S.PP]],
  recent: [t('Most recent'), (a, b) => b[S.TIME] - a[S.TIME]],
  pos: [t('Best position in PT'), (a, b) => (a[S.POS] || 1e9) - (b[S.POS] || 1e9) || b[S.PP] - a[S.PP]],
  acc: [t('Best accuracy'), (a, b) => b[S.ACC] - a[S.ACC]],
  combo: [t('Highest combo'), (a, b) => b[S.COMBO] - a[S.COMBO]],
};

const TAB_LIST = [
  { slug: 'converts', label: t('Converts'), list: f => f.scores.c },
  { slug: 'loved', label: t('Loved'), list: f => f.scores.u },
  { slug: 'ranked', label: t('Ranked'), list: f => f.scores.r },
  { slug: 'top', label: 'Top pp', list: f => f.top },
  { slug: 'dan', label: 'Dan', list: f => f.dan },
  { slug: 'pre', label: t('Pre-rank'), list: f => f.pre || [] },
];

/**
 * A pp tile that leads with the rank: the rank big ("#5 PT") and the pp under it, before `sub` if there is one. With
 * no rank (unranked, or no official rank) the pp stays the big figure and `noRank` says why. The rank links to its
 * leaderboard (`board`, a slug of rankings.js), which scrolls to and marks this player's row (`at`).
 */
function rankStat(label, rank, where, pp, { sub = '', noRank, cls, board, id }) {
  const ppText = `${fmt.pp(pp)} pp`;
  const boardName = t('{board} leaderboard', { board: board === 'ranked' ? t('Ranked') : label }); // as the Leaderboards page names it
  return rank
    ? stat(label, html`<a class="stat-link" href="#/rankings/${board}?at=${id}" aria-label="${boardName}, ${fmt.rank(rank)} ${where}" title="${t('See the {board}', { board: boardName })}">${fmt.rank(rank)} <span class="stat-unit">${where}</span></a>`, sub ? html`<span class="keep">${ppText}</span> · <span class="keep">${sub}</span>` : ppText, cls)
    : stat(label, ppText, noRank, cls);
}

/** Two arrows facing each other: "compare". */
const COMPARE_ICON = raw('<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5h10M9 2l3 3-3 3M14 11H4M7 8l-3 3 3 3"/></svg>');

/**
 * The in-joke badges, folded into one small "6 badges" button beside the others: hovering or keyboard focus opens a
 * card with each badge and what earned it; on touch a tap toggles it (wired up in the page, with Escape and an
 * outside click to close).
 */
const badgePeek = badges => html`<span class="peek">
  <button type="button" class="peek-btn" aria-expanded="false" aria-controls="badge-pop">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>
    ${fmt.plural(badges.length, 'badge')}
  </button>
  <span class="peek-pop" id="badge-pop" role="group" aria-label="${t('Badges')}">
    <ul class="badge-list">${badges.map(b => html`<li><b>${b.name}</b><span>${b.tip}</span></li>`)}</ul>
  </span>
</span>`;

function danGrid(file) {
  const passes = new Map(file.dan.map(([i, s]) => [i, s]));
  return html`<div class="dan-ladder">${DAN_STAGES.map(stage => {
    const s = passes.get(stage.index);
    return html`<a class="dan-stage ${stage.index > 10 ? 'hebrew' : ''} ${s ? '' : 'locked'}" href="#/map/${DAN_MAPS[stage.index]}">
      <span class="points">${stage.points} pts</span>
      <div class="dan-glyph">${stage.glyph}</div>
      <b>${danName(stage.index)}</b>
      <div class="small ${s ? 'dan-pass' : 'faint'}">${s ? `${fmt.acc(s[S.ACC])} · ${fmt.date(s[S.TIME])}` : t('Needs {acc}', { acc: `${fmt.num(stage.passAcc)}%` })}</div>
    </a>`;
  })}</div>`;
}

const HISTORY_LINES = [[t('Converts'), 'var(--cat-c)', 1], [t('Loved'), 'var(--cat-u)', 2], [t('Official'), 'var(--cat-r)', 3]];
const REBUILT_TIP = t('Rebuilt month by month from the dates of this player’s stored scores. Only their best play on each map is kept, and past totals use today’s pp values, so the real numbers back then were different.');

/** The ranges the chart offers: everything, the last 12 months, or only the days the site recorded itself. */
function historyRanges(recorded, rebuilt) {
  const all = [...rebuilt, ...recorded];
  if (all.length < 2) return [];
  const end = all[all.length - 1][0];
  const ranges = [['all', t('All|time'), -Infinity]];
  if (end - all[0][0] > 400 * 86400) ranges.push(['year', t('Last 12 months'), end - 365 * 86400]);
  if (rebuilt.length && recorded.length >= 2) ranges.push(['tracked', t('Since tracking'), recorded[0][0]]);
  return ranges;
}

/** Only the points from `from` on, starting with the value the line had at `from` (so it begins at the left edge). */
function clipFrom(points, from) {
  const before = points.filter(p => p[0] < from).at(-1);
  const rest = points.filter(p => p[0] >= from);
  return before ? [[from, before[1]], ...rest] : rest;
}

/**
 * `recorded` = [[time, convertPp, lovedPp, officialPp]], one per day something changed since the site started
 * tracking; `rebuilt` = the same, monthly, rebuilt from score dates for the time before. Any value can be null (no
 * official pp for an inactive player): those points are skipped, never drawn as 0. Each rebuilt line is dashed and
 * holds its last value until its solid line starts (or to the last recorded day if it never does); the two may not
 * join exactly.
 */
function historyLines(recorded, rebuilt, from) {
  const lastDay = recorded[recorded.length - 1]?.[0];
  return HISTORY_LINES.map(([label, color, k]) => {
    const pick = list => list.filter(p => p[k] != null).map(p => [p[0], p[k]]);
    const solid = pick(recorded);
    const dashed = pick(rebuilt);
    const until = solid[0]?.[0] ?? lastDay;
    if (dashed.length && until > dashed[dashed.length - 1][0]) dashed.push([until, dashed[dashed.length - 1][1]]);
    const clipped = clipFrom(dashed, from);
    // A dashed line needs some length: from where its solid line starts, all that's left of it is that one point.
    return { label, color, dashed: clipped.length > 1 && clipped[clipped.length - 1][0] > clipped[0][0] ? clipped : [], solid: clipFrom(solid, from) };
  });
}

function historyChart(lines) {
  const shown = lines.flatMap(l => [...l.dashed, ...l.solid]);
  if (shown.length < 2) return html`<p class="muted small">${t('Not enough points in this range.')}</p>`;
  const span = shown.map(p => p[0]);
  const summary = t('pp over time, {from} to {to}: {lines}.', {
    from: fmt.date(Math.min(...span)),
    to: fmt.date(Math.max(...span)),
    lines: lines.map(l => [...l.dashed, ...l.solid])
      .map((pts, i) => pts.length && t('{line} {from} to {to}', { line: HISTORY_LINES[i][0], from: fmt.num(pts[0][1]), to: fmt.num(pts[pts.length - 1][1]) }))
      .filter(Boolean).join(', '),
  });
  const anyDashed = lines.some(l => l.dashed.length);
  return html`${lineChart(lines.flatMap(l => [
    { label: t('{line} (reconstructed)', { line: l.label }), color: l.color, points: l.dashed, dashed: true, step: true },
    { label: l.label, color: l.color, points: l.solid },
  ]), { format: v => fmt.num(v), label: anyDashed ? `${summary} ${t('Dashed parts are reconstructed from score dates and approximate.')}` : summary })}
    <div class="legend">${lines.filter(l => l.dashed.length || l.solid.length).map(l => html`<span><i style="background:${l.color}"></i>${l.label}</span>`)}
      ${anyDashed ? html`<span class="legend-dashed" title="${REBUILT_TIP}"><i aria-hidden="true"></i>${t('dashed = reconstructed from score dates (approximate)')}<span class="sr-only">. ${REBUILT_TIP}</span></span>` : ''}</div>`;
}

/** The value a line has at `t`: its last point at or before `t`. */
const valueAt = (points, t) => {
  let value = null;
  for (const p of points) { if (p[0] > t) break; value = p[1]; }
  return value;
};

/**
 * What the hover readout steps through: every time any line has a point, with each line's value then (from the solid
 * line once it has started, otherwise the dashed one, marked approximate). Rows where everything is approximate are
 * monthly reconstructions, so they're dated by month.
 */
function historyRows(lines) {
  const times = [...new Set(lines.flatMap(l => [...l.dashed, ...l.solid].map(p => p[0])))].sort((a, b) => a - b);
  return times.map(t => {
    const items = lines.map(l => {
      const exact = l.solid.length && t >= l.solid[0][0];
      return { name: l.label, color: l.color, value: valueAt(exact ? l.solid : l.dashed, t), approx: !exact };
    }).filter(item => item.value != null);
    return { t, title: items.every(item => item.approx) ? fmt.monthYear(t) : fmt.date(t), items };
  }).filter(row => row.items.length);
}

/** Collapsed by default (the choice is remembered); the chart is only drawn once it's opened. */
function historySection(recorded, rebuilt) {
  const ranges = historyRanges(recorded, rebuilt);
  if (!ranges.length) return '';
  return html`<details class="section card history" id="history" ${prefs.get('ppchart', false) ? raw('open') : ''}>
    <summary><h2 class="card-h">${t('pp over time')}</h2><span class="history-toggle" aria-hidden="true"></span></summary>
    <div class="history-body">
      ${ranges.length > 1 ? chipGroup(t('Range'), 'range', ranges, 'all') : ''}
      <div class="chart-wrap" id="history-chart"></div>
    </div>
  </details>`;
}

/** The last full player file this page loaded, so switching tabs on that profile doesn't go back to the head file. */
let lastFull = null;

export default async function player(root, { params, query, isCurrent }) {
  const id = Number(params.id);
  // The small head file shows the first page in the default order. A link straight to a search, sort, filter or later
  // page needs the whole file, as does data from before head files (playerHead gives null).
  const needsAll = Boolean(query.q || query.firsts || (query.sort && query.sort !== 'pp') || Number(query.page) > 1);
  const loaded = lastFull?.id === id ? lastFull : null;
  const head = needsAll || loaded ? null : playerHead(id);
  const filePromise = loaded ? Promise.resolve(loaded) : head ? head.then(h => h ?? playerFile(id)) : playerFile(id);
  // Records only feed the badges, which a head file brings already worked out.
  const recsPromise = (head ?? Promise.resolve(null)).then(h => (h ? null : records().catch(() => null)));
  let [file, index, hist, recs] = await Promise.all([filePromise, playerIndex(), history(), recsPromise]);
  if (!isCurrent()) return;
  if (!file.head) lastFull = file;
  const p = index.get(id);
  setTitle(p.name);
  const extras = file.extras;
  const badges = (extras ? extras.badges : playerBadges(p, file, recs)).map(localBadge);
  const playerEra = localEra(extras ? extras.era : era(p, file));
  const signature = extras ? extras.signature : signatureMap(file);

  const counts = file.counts ? { ...file.counts, converts: file.counts.c, loved: file.counts.u, ranked: file.counts.r } : {
    converts: file.scores.c.length, loved: file.scores.u.length, ranked: file.scores.r.length, top: file.top.length, dan: file.dan.length,
    pre: file.pre?.length ?? 0,
  };
  const tab = TAB_LIST.find(item => item.slug === params.tab) ?? TAB_LIST.find(item => !['dan', 'pre'].includes(item.slug) && counts[item.slug]) ?? TAB_LIST[0];
  // Only lists with something in them get a tab (so they fit on a phone), plus whichever one is open.
  const shownTabs = TAB_LIST.filter(item => counts[item.slug] || item === tab);
  const role = danRole(p.danScore);
  const firsts = p.firsts.c + p.firsts.u + p.firsts.r;
  const dayTime = d => Date.parse(`${d}T12:00:00Z`) / 1000;
  const points = (hist.series[id] || []).map(([d, cv, ul, pp]) => [dayTime(hist.days[d]), cv, ul, pp]);
  // Monthly points rebuilt from score dates (history.json `reconstructed`, as of 00:00 UTC), only for the time before
  // the site's own records begin. Older data has no `reconstructed`.
  const rebuiltDays = hist.reconstructed?.days ?? [];
  const rebuilt = (hist.reconstructed?.series?.[id] ?? [])
    .map(([d, cv, ul, pp]) => [Date.parse(`${rebuiltDays[d]}T00:00:00Z`) / 1000, cv, ul, pp])
    .filter(p => Number.isFinite(p[0]) && (!points.length || p[0] < points[0][0]));

  root.innerHTML = String(html`
    <header class="profile-head">
      <a class="avatar-link" href="${osuUser(id)}" target="_blank" rel="noopener" aria-label="${t('{name} on osu!', { name: p.name })}" title="${t('{name} on osu!', { name: p.name })}">${avatar(id, 'avatar-lg')}</a>
      <div class="profile-info">
        <h1><a class="title-link" href="${osuUser(id)}" target="_blank" rel="noopener" title="${t('{name} on osu!', { name: p.name })}">${p.name}</a>${isLegend(p) ? legendTag() : ''}</h1>
        <p class="profile-line">${[
          role && html`<span class="profile-role">${role}</span>`,
          firsts && tn(firsts, '{n} #1 in Portugal', '{n} #1s in Portugal'),
          p.last && t('last played {ago}', { ago: fmt.ago(p.last) }),
          playerEra && t('era: {era}', { era: playerEra }),
        ].filter(Boolean).map((part, i) => html`${i ? html`<span class="sep-dot" aria-hidden="true"> · </span>` : ''}${part}`)}</p>
        <div class="links">
          <button class="btn btn-small" id="me" type="button" aria-pressed="false" title="${t('Highlights your rows on every leaderboard (saved in this browser)')}">${t('This is me')}</button>
          <a class="not-you" id="not-you" href="#/player/${id}" hidden>${t('Not you?')}</a>
          <a class="btn btn-small btn-icon" href="#/compare/${id}" aria-label="${t('Compare {name} with another player', { name: p.name })}" title="${t('Compare with another player')}">${COMPARE_ICON}</a>
          ${badges.length ? badgePeek(badges) : ''}
        </div>
      </div>
      ${jersey(p)}
    </header>

    <div class="stats">
      ${rankStat(t('Converts'), p.rank.c, 'PT', p.cv, { noRank: t('Unranked'), cls: 'stat-c', board: 'converts', id })}
      ${rankStat(t('Loved & Unranked'), p.rank.u, 'PT', p.ul, { noRank: t('Unranked'), cls: 'stat-u', board: 'loved', id })}
      ${!isInactiveOnOsu(p)
        // osu!'s own country rank leads, like the two tiles before it; the global rank goes under the pp.
        ? p.country
          ? rankStat(t('Official pp'), p.country, 'PT', p.pp, { sub: p.global ? `${fmt.rank(p.global)} global` : '', cls: 'stat-r', board: 'ranked', id })
          : rankStat(t('Official pp'), p.global, 'global', p.pp, { noRank: t('No official rank'), cls: 'stat-r', board: 'ranked', id })
        : p.pp > 0
          ? stat(t('Official pp'), p.ppSource === 'estimated'
            // "(estimated)" is only for screen readers here: the subtitle already says it, and the value stays one line.
            ? html`<span title="${t('Estimated from their stored plays, so probably a little low')}"><span aria-hidden="true">≈ </span>${fmt.pp(p.pp)} pp</span><span class="sr-only"> (${t('estimated')})</span>`
            : html`${fmt.pp(p.pp)} pp`,
            html`${inactiveTag(p)} ${officialPpNote(p)}`, 'stat-r')
          // Inactive with nothing to go on (no last-known value, no plays to estimate from).
          : stat(t('Official pp'), '—', html`${inactiveTag(p)} ${t('no official pp known')}`, 'stat-r')}
      ${stat(t('Accuracy'), fmt.acc(p.acc), t('Level {level}', { level: fmt.num(p.level, 0) }))}
      ${stat(t('Play count'), fmt.num(p.plays), html`<span class="grade-counts">${['X', 'S', 'A'].map((g, i) => html`<span>${gradeBadge(g)}${fmt.num(p.grades[i])}</span>`)}</span>`)}
      ${stat(t('Dan points'), fmt.num(p.danScore), t('{done} of {total} stages', { done: fmt.num(p.dan.length), total: fmt.num(DAN_STAGES.length) }))}    </div>

    ${id === THRONE_PLAYER ? html`<p class="mt-4 notice">${th('Every #1 on this profile is up for grabs. {link}', { link: html`<a href="#/records?at=throne">${t('Dethrone Tris')}</a>` })}</p>` : ''}

    ${signature ? html`<section class="section card signature">
      <h2 class="card-h">${t('Signature map')} <span class="faint">· ${t(signature.kind)}</span></h2>
      ${mapLink(signature.s[S.MAP], signature.meta)}
      <div class="mt-2 score-line">${catChip(signature.cat)} ${scoreStats(signature.s)} <span>${fmt.pp(signature.s[S.PP])} pp</span> <span class="faint">${fmt.date(signature.s[S.TIME])}</span></div>
    </section>` : ''}


    ${historySection(points, rebuilt)}

    <section class="section">
      <h2 class="sr-only">${t('Plays')}</h2>
      ${tabs(shownTabs.map(item => ({ href: `#/player/${id}/${item.slug}`, label: item.label, count: counts[item.slug], active: item === tab })), t('Score lists'))}
      ${tab.slug === 'dan' ? danGrid(file) : html`
        ${tab.slug === 'top' ? html`<p class="muted small">${t('The best ranked plays (converts included) with their official pp, taken from osu!’s monthly data dump.')}</p>` : ''}
        ${tab.slug === 'pre' ? html`<p class="muted small">${t('Plays set before their map was ranked. They’re kept for the record but count toward nothing: no pp, no leaderboard spot.')}</p>` : ''}
        <div class="toolbar">
          <input class="input" type="search" id="q" placeholder="${t('Search maps…')}" aria-label="${t('Search these plays')}" value="${query.q || ''}">
          <select class="select" id="sort" aria-label="${t('Sort')}">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}" ${k === query.sort ? raw('selected') : ''}>${label}</option>`)}</select>
          ${!['top', 'pre'].includes(tab.slug) ? html`<span class="checks"><label><input type="checkbox" id="firsts" ${query.firsts ? raw('checked') : ''}> ${t('Only #1s')}</label></span>` : ''}
        </div>
        <p class="result-count" id="count"></p>
        <div id="scores"></div>`}
    </section>
  `);

  // The pp chart: drawn when its section is first opened, redrawn (chart only) when the range changes.
  const ranges = historyRanges(points, rebuilt);
  const historyEl = root.querySelector('#history');
  let range = ranges[0], drawn = false;
  const drawHistory = () => {
    drawn = true;
    const lines = historyLines(points, rebuilt, range[2]);
    const wrap = root.querySelector('#history-chart');
    wrap.innerHTML = String(historyChart(lines));
    chartHover(wrap, historyRows(lines), { onKey: announce });
  };
  historyEl?.addEventListener('toggle', () => {
    prefs.set('ppchart', historyEl.open);
    if (historyEl.open && !drawn) drawHistory();
  });
  if (historyEl?.open) drawHistory();
  historyEl?.querySelector('.chips')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-range]');
    const picked = chip && ranges.find(r => r[0] === chip.dataset.range);
    if (!picked) return;
    range = picked;
    setPressed(historyEl, 'range', range[0]);
    drawHistory();
  });

  // "This is me" is a toggle: the label stays the same, aria-pressed and a check mark show the state, and "Not you?"
  // undoes it without having to guess that the same button does. Its tooltip says what it's for.
  const meButton = root.querySelector('#me');
  const notYou = root.querySelector('#not-you');
  const drawMe = () => {
    const me = prefs.get('me', null);
    meButton.setAttribute('aria-pressed', String(me === id));
    notYou.hidden = me !== id;
  };
  meButton.addEventListener('click', () => {
    prefs.set('me', prefs.get('me', null) === id ? null : id);
    drawMe();
  });
  notYou.addEventListener('click', e => {
    e.preventDefault();
    prefs.set('me', null);
    drawMe();
    meButton.focus();
  });
  drawMe();

  // The badges card opens on hover (site.css, pointers only); a click or tap opens it until a second click, Escape or a
  // click anywhere else.
  const peek = root.querySelector('.peek');
  if (peek) {
    const peekButton = peek.querySelector('.peek-btn');
    const setOpen = open => {
      peek.classList.toggle('open', open);
      peekButton.setAttribute('aria-expanded', String(open));
    };
    peekButton.addEventListener('click', () => setOpen(!peek.classList.contains('open')));
    const outside = e => {
      if (!peek.isConnected) document.removeEventListener('click', outside);
      else if (!peek.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', outside);
    peek.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      peek.classList.add('shut');
      peekButton.focus();
    });
    peek.addEventListener('mouseleave', () => peek.classList.remove('shut'));
  }

  if (tab.slug === 'dan') return;
  const cat = SLUG_CAT[tab.slug] ?? null;
  let all = tab.list(file);
  const total = counts[tab.slug];
  // A head file holds this list's first page only (in the default order). Until the whole file is in, `items` is that
  // page padded with nulls to the list's real length, so the pager and the count are right from the start.
  let partial = all.length < total;
  if (!total) {
    const none = {
      top: t('{name} has no plays imported from the osu! data dump yet.', { name: p.name }),
      pre: t('{name} has no plays from before their map was ranked yet.', { name: p.name }),
    }[tab.slug] ?? t('{name} has no plays in {category} yet.', { name: p.name, category: CAT_LABEL[cat] });
    root.querySelector('#scores').innerHTML = String(empty(none));
    return;
  }
  const q = root.querySelector('#q');
  const sort = root.querySelector('#sort');
  const onlyFirsts = root.querySelector('#firsts');
  const label = s => {
    const { title, sub } = mapText(s[S.MAP], file.maps[s[S.MAP]]);
    return `${title} ${sub}`.toLowerCase();
  };
  // The lowercase labels are built once per list, on the first search, not again on every keystroke.
  let labels = null;
  const visible = () => {
    if (partial) return [...all, ...new Array(total - all.length).fill(null)];
    const text = q.value.trim().toLowerCase();
    if (text) labels ??= new Map(all.map(s => [s, label(s)]));
    return all
      .filter(s => (!text || labels.get(s).includes(text)) && (!onlyFirsts?.checked || s[S.POS] === 1))
      .sort(SORTS[sort.value][1]);
  };
  // The whole file, loaded on the first search, sort, filter or page change of a list that came from the head.
  let fullPromise = null;
  const loadAll = () => (fullPromise ??= playerFile(id).then(full => {
    if (!isCurrent()) return false;
    lastFull = full;
    file = full;
    all = tab.list(full);
    labels = null;
    partial = false;
    return true;
  }, e => {
    fullPromise = null;
    count.textContent = t('Couldn’t load all plays ({error}). Try again.', { error: e.message });
    return false;
  }));
  // Search, sort, "Only #1s" and page live in the URL, so Back from a map comes back to the same list.
  const count = root.querySelector('#count');
  let page = Math.max(0, (Number(query.page) || 1) - 1);
  const save = () => writeQuery({ q: q.value.trim(), sort: sort.value, firsts: Boolean(onlyFirsts?.checked), page: page + 1 }, { sort: 'pp', page: 1 });
  let items = visible();
  const showCount = speak => {
    count.textContent = resultCount(items.length, partial ? total : all.length, 'play');
    if (speak) announce(count.textContent);
  };
  // A page of nulls (past the head's first page) shows placeholder rows until the whole file is in.
  const redraw = paginate(root.querySelector('#scores'), items, slice => (slice[0]
    ? html`<div class="rows">${slice.map(s => scoreRow({ s, meta: file.maps[s[S.MAP]], pos: ['top', 'pre'].includes(tab.slug) ? null : s[S.POS] }))}</div>`
    : placeholderRows(slice.length)), 50, {
    page,
    onPage: n => {
      page = n;
      save();
      if (partial) loadAll().then(ok => { if (ok) { items = visible(); redraw(items, true); } });
    },
    empty: () => emptyFiltered(q.value.trim()
      ? (onlyFirsts?.checked ? t('No play matches “{q}” among the #1s.', { q: q.value.trim() }) : t('No play matches “{q}”.', { q: q.value.trim() }))
      : t('No #1s in this list.')),
  });
  showCount(false);
  const refilter = () => {
    if (partial) {
      count.textContent = t('Loading all plays…');
      loadAll().then(ok => { if (ok) refilter(); });
      return;
    }
    items = visible();
    redraw(items);
    showCount(true);
  };
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refilter, 120); });
  sort.addEventListener('change', refilter);
  onlyFirsts?.addEventListener('change', refilter);
  root.querySelector('#scores').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    q.value = '';
    if (onlyFirsts) onlyFirsts.checked = false;
    refilter();
    q.focus();
  });
}
