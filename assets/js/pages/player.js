import { html, raw } from '../core/html.js';
import { playerFile, playerIndex, history, records } from '../core/data.js';
import { S, CATS, DAN_STAGES, DAN_MAPS, danRole } from '../core/model.js';
import { danName } from '../core/events.js';
import { lineChart } from '../core/charts.js';
import { playerBadges, era, playerCard, cardPosition, signatureMap } from '../core/badges.js';
import { THRONE_PLAYER } from '../core/lore.js';
import {
  setTitle, tabs, avatar, stat, scoreRow, paginate, empty, mapText, prefs, osuUser, CAT_LABEL, SLUG_CAT, funChips,
  mapLink, scoreStats, catChip, writeQuery, announce, resultCount, emptyFiltered,
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

/** `points` = [[time, convertPp, lovedPp, officialPp]], one per day something changed. */
function historyChart(points) {
  if (points.length < 2) return '';
  const first = points[0], last = points[points.length - 1];
  const summary = `pp over time, ${fmt.date(first[0])} to ${fmt.date(last[0])}: Converts ${fmt.num(first[1])} to ${fmt.num(last[1])}, `
    + `Loved ${fmt.num(first[2])} to ${fmt.num(last[2])}, official ${fmt.num(first[3])} to ${fmt.num(last[3])}.`;
  return html`<section class="section card">
    <h2 class="card-h">pp over time</h2>
    ${lineChart([
      { label: 'Converts', color: 'var(--cat-c)', points: points.map(p => [p[0], p[1]]) },
      { label: 'Loved', color: 'var(--cat-u)', points: points.map(p => [p[0], p[2]]) },
      { label: 'Official', color: 'var(--cat-r)', points: points.map(p => [p[0], p[3]]) },
    ], { format: v => fmt.num(v), label: summary })}
    <div class="legend"><span><i style="background:var(--cat-c)"></i>Converts</span><span><i style="background:var(--cat-u)"></i>Loved</span><span><i style="background:var(--cat-r)"></i>Official</span></div>
  </section>`;
}

export default async function player(root, { params, query, isCurrent }) {
  const id = Number(params.id);
  const [file, index, hist, recs] = await Promise.all([playerFile(id), playerIndex(), history(), records().catch(() => null)]);
  if (!isCurrent()) return;
  const p = index.get(id);
  setTitle(p.name);
  const badges = playerBadges(p, file, recs);
  const playerEra = era(p, file);
  const card = playerCard(p, [...index.values()]);
  const position = cardPosition(file);
  const signature = signatureMap(file);

  const counts = {
    converts: file.scores.c.length, loved: file.scores.u.length, ranked: file.scores.r.length, top: file.top.length, dan: file.dan.length,
    pre: file.pre?.length ?? 0,
  };
  const tab = TAB_LIST.find(t => t.slug === params.tab) ?? TAB_LIST.find(t => !['dan', 'pre'].includes(t.slug) && counts[t.slug]) ?? TAB_LIST[0];
  // Only lists with something in them get a tab (so they fit on a phone), plus whichever one is open.
  const shownTabs = TAB_LIST.filter(t => counts[t.slug] || t === tab);
  const role = danRole(p.danScore);
  const firsts = p.firsts.c + p.firsts.u + p.firsts.r;
  const years = [...new Set(CATS.flatMap(c => file.scores[c].map(s => new Date(s[S.TIME] * 1000).getFullYear())))].sort((a, b) => b - a);
  const dayTime = d => Date.parse(`${d}T12:00:00Z`) / 1000;
  const points = (hist.series[id] || []).map(([d, cv, ul, pp]) => [dayTime(hist.days[d]), cv, ul, pp]);

  root.innerHTML = String(html`
    <header class="profile-head">
      <a class="avatar-link" href="${osuUser(id)}" target="_blank" rel="noopener" aria-label="${p.name} on osu!" title="${p.name} on osu!">${avatar(id, 'avatar-lg')}</a>
      <div style="min-width:0">
        <h1>${p.name}</h1>
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
      ${stat('Official pp', html`${fmt.pp(p.pp)} pp`, p.global ? `${fmt.rank(p.global)} global · ${fmt.rank(p.country)} PT` : 'No official rank', 'stat-r')}
      ${stat('Accuracy', fmt.acc(p.acc), `Level ${fmt.num(p.level, 0)}`)}
      ${stat('Play count', fmt.num(p.plays), `${fmt.num(p.grades[0])} SS · ${fmt.num(p.grades[1])} S · ${fmt.num(p.grades[2])} A`)}
      ${stat('Dan points', fmt.num(p.danScore), `${p.dan.length} of ${DAN_STAGES.length} stages`)}
      ${card && position ? stat('Player card', `${card.ovr} OVR`, `${position.position} (${position.mod})`, 'stat-card') : ''}
    </div>

    ${id === THRONE_PLAYER ? html`<p class="notice" style="margin-top:16px">Every #1 on this profile is up for grabs. <a href="#/records?at=throne">Dethrone Tris →</a></p>` : ''}

    ${signature ? html`<section class="section card signature">
      <h2 class="card-h">Signature map <span class="faint">· ${signature.kind}</span></h2>
      ${mapLink(signature.s[S.MAP], signature.meta)}
      <div class="score-line" style="margin-top:10px">${catChip(signature.cat)} ${scoreStats(signature.s)} <span>${fmt.pp(signature.s[S.PP])} pp</span> <span class="faint">${fmt.date(signature.s[S.TIME])}</span></div>
    </section>` : ''}

    ${historyChart(points)}

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
  const all = tab.list(file);
  if (!all.length) {
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
  const visible = () => {
    const text = q.value.trim().toLowerCase();
    return all
      .filter(s => (!text || label(s).includes(text)) && (!onlyFirsts?.checked || s[S.POS] === 1))
      .sort(SORTS[sort.value][1]);
  };
  // Search, sort, "Only #1s" and page live in the URL, so Back from a map comes back to the same list.
  const count = root.querySelector('#count');
  let page = Math.max(0, (Number(query.page) || 1) - 1);
  const save = () => writeQuery({ q: q.value.trim(), sort: sort.value, firsts: Boolean(onlyFirsts?.checked), page: page + 1 }, { sort: 'pp', page: 1 });
  let items = visible();
  const showCount = speak => {
    count.textContent = resultCount(items.length, all.length, 'play');
    if (speak) announce(count.textContent);
  };
  const redraw = paginate(root.querySelector('#scores'), items, slice => html`<div class="rows">${slice.map(s =>
    scoreRow({ s, meta: file.maps[s[S.MAP]], pos: ['top', 'pre'].includes(tab.slug) ? null : s[S.POS] }))}</div>`, 50, {
    page,
    onPage: n => { page = n; save(); },
    empty: () => emptyFiltered(q.value.trim() ? `No play matches “${q.value.trim()}”${onlyFirsts?.checked ? ' among the #1s' : ''}.` : 'No #1s in this list.'),
  });
  showCount(false);
  const refilter = () => { items = visible(); redraw(items); showCount(true); };
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refilter, 200); });
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
