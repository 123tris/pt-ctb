import { html, raw } from '../core/html.js';
import { playerFile, playerHead, playerIndex, history, records } from '../core/data.js';
import { S, CATS, DAN_STAGES, DAN_MAPS, danRole } from '../core/model.js';
import { danName } from '../core/events.js';
import { lineChart, chartHover } from '../core/charts.js';
import { playerBadges, era, signatureMap } from '../core/badges.js';
import { THRONE_PLAYER } from '../core/lore.js';
import {
  setTitle, tabs, avatar, stat, scoreRow, paginate, empty, mapText, prefs, osuUser, CAT_LABEL, SLUG_CAT, funChips,
  mapLink, scoreStats, catChip, writeQuery, announce, resultCount, emptyFiltered, isInactiveOnOsu, inactiveTag, officialPpNote,
  isLegend, legendTag, gradeBadge, chipGroup, setPressed, placeholderRows,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';

const SORTS = {
  pp: ['Most pp', (a, b) => b[S.PP] - a[S.PP]],
  recent: ['Most recent', (a, b) => b[S.TIME] - a[S.TIME]],
  pos: ['Best position in PT', (a, b) => (a[S.POS] || 1e9) - (b[S.POS] || 1e9) || b[S.PP] - a[S.PP]],
  acc: ['Best accuracy', (a, b) => b[S.ACC] - a[S.ACC]],
  combo: ['Highest combo', (a, b) => b[S.COMBO] - a[S.COMBO]],
};

const TAB_LIST = [
  { slug: 'converts', label: 'Converts', list: f => f.scores.c },
  { slug: 'loved', label: 'Loved', list: f => f.scores.u },
  { slug: 'ranked', label: 'Ranked', list: f => f.scores.r },
  { slug: 'top', label: 'Top pp', list: f => f.top },
  { slug: 'dan', label: 'Dan', list: f => f.dan },
  { slug: 'pre', label: 'Pre-rank', list: f => f.pre || [] },
];

function danGrid(file) {
  const passes = new Map(file.dan.map(([i, s]) => [i, s]));
  return html`<div class="dan-ladder">${DAN_STAGES.map(stage => {
    const s = passes.get(stage.index);
    return html`<a class="dan-stage ${stage.index > 10 ? 'hebrew' : ''} ${s ? '' : 'locked'}" href="#/map/${DAN_MAPS[stage.index]}">
      <span class="points">${stage.points} pts</span>
      <div class="dan-glyph">${stage.glyph}</div>
      <b>${danName(stage.index)}</b>
      <div class="small ${s ? 'dan-pass' : 'faint'}">${s ? `${fmt.acc(s[S.ACC])} · ${fmt.date(s[S.TIME])}` : `Needs ${stage.passAcc}%`}</div>
    </a>`;
  })}</div>`;
}

const HISTORY_LINES = [['Converts', 'var(--cat-c)', 1], ['Loved', 'var(--cat-u)', 2], ['Official', 'var(--cat-r)', 3]];
const REBUILT_TIP = 'Rebuilt month by month from the dates of this player’s stored scores. Only their best play on each map is '
  + 'kept, and past totals use today’s pp values, so the real numbers back then were different.';

/** The ranges the chart offers: everything, the last 12 months, or only the days the site recorded itself. */
function historyRanges(recorded, rebuilt) {
  const all = [...rebuilt, ...recorded];
  if (all.length < 2) return [];
  const end = all[all.length - 1][0];
  const ranges = [['all', 'All', -Infinity]];
  if (end - all[0][0] > 400 * 86400) ranges.push(['year', 'Last 12 months', end - 365 * 86400]);
  if (rebuilt.length && recorded.length >= 2) ranges.push(['tracked', 'Since tracking', recorded[0][0]]);
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
  if (shown.length < 2) return html`<p class="muted small">Not enough points in this range.</p>`;
  const span = shown.map(p => p[0]);
  const summary = `pp over time, ${fmt.date(Math.min(...span))} to ${fmt.date(Math.max(...span))}: ${lines
    .map(l => [...l.dashed, ...l.solid]).map((pts, i) => pts.length && `${HISTORY_LINES[i][0]} ${fmt.num(pts[0][1])} to ${fmt.num(pts[pts.length - 1][1])}`)
    .filter(Boolean).join(', ')}.`;
  const anyDashed = lines.some(l => l.dashed.length);
  return html`${lineChart(lines.flatMap(l => [
    { label: `${l.label} (reconstructed)`, color: l.color, points: l.dashed, dashed: true, step: true },
    { label: l.label, color: l.color, points: l.solid },
  ]), { format: v => fmt.num(v), label: anyDashed ? `${summary} Dashed parts are reconstructed from score dates and approximate.` : summary })}
    <div class="legend">${lines.filter(l => l.dashed.length || l.solid.length).map(l => html`<span><i style="background:${l.color}"></i>${l.label}</span>`)}
      ${anyDashed ? html`<span class="legend-dashed" title="${REBUILT_TIP}"><i aria-hidden="true"></i>dashed = reconstructed from score dates (approximate)<span class="sr-only">. ${REBUILT_TIP}</span></span>` : ''}</div>`;
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
    <summary><h2 class="card-h">pp over time</h2><span class="history-toggle" aria-hidden="true"></span></summary>
    <div class="history-body">
      ${ranges.length > 1 ? chipGroup('Range', 'range', ranges, 'all') : ''}
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
  const badges = extras ? extras.badges : playerBadges(p, file, recs);
  const playerEra = extras ? extras.era : era(p, file);
  const signature = extras ? extras.signature : signatureMap(file);

  const counts = file.counts ? { ...file.counts, converts: file.counts.c, loved: file.counts.u, ranked: file.counts.r } : {
    converts: file.scores.c.length, loved: file.scores.u.length, ranked: file.scores.r.length, top: file.top.length, dan: file.dan.length,
    pre: file.pre?.length ?? 0,
  };
  const tab = TAB_LIST.find(t => t.slug === params.tab) ?? TAB_LIST.find(t => !['dan', 'pre'].includes(t.slug) && counts[t.slug]) ?? TAB_LIST[0];
  // Only lists with something in them get a tab (so they fit on a phone), plus whichever one is open.
  const shownTabs = TAB_LIST.filter(t => counts[t.slug] || t === tab);
  const role = danRole(p.danScore);
  const firsts = p.firsts.c + p.firsts.u + p.firsts.r;
  const years = extras?.years ?? [...new Set(CATS.flatMap(c => file.scores[c].map(s => new Date(s[S.TIME] * 1000).getFullYear())))].sort((a, b) => b - a);
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
      <a class="avatar-link" href="${osuUser(id)}" target="_blank" rel="noopener" aria-label="${p.name} on osu!" title="${p.name} on osu!">${avatar(id, 'avatar-lg')}</a>
      <div style="min-width:0">
        <h1>${p.name}${isLegend(p) ? legendTag() : ''}</h1>
        <div class="links" style="margin-bottom:10px">
          ${role ? html`<span class="badge badge-gold">${role}</span>` : ''}
          ${firsts ? html`<span class="badge badge-accent">${fmt.plural(firsts, '#1', '#1s')} in Portugal</span>` : ''}
          ${p.last ? html`<span class="badge">Last played ${fmt.ago(p.last)}</span>` : ''}
          ${playerEra ? html`<span class="badge badge-era">Era: ${playerEra}</span>` : ''}
        </div>
        ${funChips(badges)}
        <div class="links">
          <a class="btn btn-small" href="${osuUser(id)}" target="_blank" rel="noopener">osu! profile ↗</a>
          <a class="btn btn-small" href="#/compare/${id}">Compare</a>
          ${years.length ? html`<a class="btn btn-small" href="#/recap/${id}/${years[0]}">${years[0]} recap</a>` : ''}
          <button class="btn btn-small" id="me" type="button" aria-pressed="false">This is me</button>
          <a class="not-you" id="not-you" href="#/player/${id}" hidden>Not you?</a>
        </div>
        <p class="small faint" id="me-hint" style="margin:8px 0 0">Mark your own profile to highlight your rows on every leaderboard (saved in this browser).</p>
      </div>
    </header>

    <div class="stats">
      ${stat('Converts', html`${fmt.pp(p.cv)} pp`, p.rank.c ? `${fmt.rank(p.rank.c)} in Portugal` : 'Unranked', 'stat-c')}
      ${stat('Loved & Unranked', html`${fmt.pp(p.ul)} pp`, p.rank.u ? `${fmt.rank(p.rank.u)} in Portugal` : 'Unranked', 'stat-u')}
      ${!isInactiveOnOsu(p)
        ? stat('Official pp', html`${fmt.pp(p.pp)} pp`, p.global ? `${fmt.rank(p.global)} global · ${fmt.rank(p.country)} PT` : 'No official rank', 'stat-r')
        : p.pp > 0
          ? stat('Official pp', p.ppSource === 'estimated'
            // "(estimated)" is only for screen readers here: the subtitle already says it, and the value stays one line.
            ? html`<span title="Estimated from their stored plays, so probably a little low"><span aria-hidden="true">≈ </span>${fmt.pp(p.pp)} pp</span><span class="sr-only"> (estimated)</span>`
            : html`${fmt.pp(p.pp)} pp`,
            html`${inactiveTag()} ${officialPpNote(p)}`, 'stat-r')
          // Inactive with nothing to go on (no last-known value, no plays to estimate from).
          : stat('Official pp', '—', html`${inactiveTag()} no official pp known`, 'stat-r')}
      ${stat('Accuracy', fmt.acc(p.acc), `Level ${fmt.num(p.level, 0)}`)}
      ${stat('Play count', fmt.num(p.plays), html`<span class="grade-counts">${['X', 'S', 'A'].map((g, i) => html`<span>${gradeBadge(g)}${fmt.num(p.grades[i])}</span>`)}</span>`)}
      ${stat('Dan points', fmt.num(p.danScore), `${p.dan.length} of ${DAN_STAGES.length} stages`)}    </div>

    ${id === THRONE_PLAYER ? html`<p class="notice" style="margin-top:16px">Every #1 on this profile is up for grabs. <a href="#/records?at=throne">Dethrone Tris →</a></p>` : ''}

    ${signature ? html`<section class="section card signature">
      <h2 class="card-h">Signature map <span class="faint">· ${signature.kind}</span></h2>
      ${mapLink(signature.s[S.MAP], signature.meta)}
      <div class="score-line" style="margin-top:10px">${catChip(signature.cat)} ${scoreStats(signature.s)} <span>${fmt.pp(signature.s[S.PP])} pp</span> <span class="faint">${fmt.date(signature.s[S.TIME])}</span></div>
    </section>` : ''}

    ${historySection(points, rebuilt)}

    <section class="section">
      <h2 class="sr-only">Plays</h2>
      ${tabs(shownTabs.map(t => ({ href: `#/player/${id}/${t.slug}`, label: t.label, count: counts[t.slug], active: t === tab })), 'Score lists')}
      ${tab.slug === 'dan' ? danGrid(file) : html`
        ${tab.slug === 'top' ? html`<p class="muted small">The best ranked plays (converts included) with their official pp, taken from osu!’s monthly data dump.</p>` : ''}
        ${tab.slug === 'pre' ? html`<p class="muted small">Plays set before their map was ranked. They’re kept for the record but count toward nothing: no pp, no leaderboard spot.</p>` : ''}
        <div class="toolbar">
          <input class="input" type="search" id="q" placeholder="Search maps…" aria-label="Search these plays" value="${query.q || ''}">
          <select class="select" id="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}" ${k === query.sort ? raw('selected') : ''}>${label}</option>`)}</select>
          ${!['top', 'pre'].includes(tab.slug) ? html`<span class="checks"><label><input type="checkbox" id="firsts" ${query.firsts ? raw('checked') : ''}> Only #1s</label></span>` : ''}
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
  // undoes it without having to guess that the same button does.
  const meButton = root.querySelector('#me');
  const notYou = root.querySelector('#not-you');
  const hint = root.querySelector('#me-hint');
  const drawMe = () => {
    const mine = prefs.get('me', null) === id;
    meButton.setAttribute('aria-pressed', String(mine));
    notYou.hidden = !mine;
    hint.textContent = mine
      ? 'Your rows are highlighted on every leaderboard, and your avatar sits in the top bar.'
      : 'Mark your own profile to highlight your rows on every leaderboard (saved in this browser).';
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

  if (tab.slug === 'dan') return;
  const cat = SLUG_CAT[tab.slug] ?? null;
  let all = tab.list(file);
  const total = counts[tab.slug];
  // A head file holds this list's first page only (in the default order). Until the whole file is in, `items` is that
  // page padded with nulls to the list's real length, so the pager and the count are right from the start.
  let partial = all.length < total;
  if (!total) {
    const where = { top: 'imported from the osu! data dump', pre: 'from before their map was ranked' }[tab.slug] ?? `in ${CAT_LABEL[cat]}`;
    root.querySelector('#scores').innerHTML = String(empty(`${p.name} has no plays ${where} yet.`));
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
    count.textContent = `Couldn’t load all plays (${e.message}). Try again.`;
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
    empty: () => emptyFiltered(q.value.trim() ? `No play matches “${q.value.trim()}”${onlyFirsts?.checked ? ' among the #1s' : ''}.` : 'No #1s in this list.'),
  });
  showCount(false);
  const refilter = () => {
    if (partial) {
      count.textContent = 'Loading all plays…';
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
