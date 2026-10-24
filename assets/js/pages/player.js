import { html } from '../core/html.js';
import { playerFile, playerIndex, history, records } from '../core/data.js';
import { S, CATS, DAN_STAGES, DAN_MAPS, danRole } from '../core/model.js';
import { danName } from '../core/events.js';
import { lineChart } from '../core/charts.js';
import { playerBadges, era, playerCard, cardPosition, signatureMap } from '../core/badges.js';
import { THRONE_PLAYER } from '../core/lore.js';
import {
  setTitle, tabs, avatar, stat, scoreRow, paginate, empty, mapText, prefs, osuUser, CAT_LABEL, SLUG_CAT, funChips,
  mapLink, scoreStats, catChip,
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
  { slug: 'loved', label: 'Loved & Unranked', list: f => f.scores.u },
  { slug: 'ranked', label: 'Ranked', list: f => f.scores.r },
  { slug: 'top', label: 'Official top pp', list: f => f.top },
  { slug: 'dan', label: 'Dan', list: f => f.dan },
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
  return html`<section class="section card">
    <h3>pp over time</h3>
    ${lineChart([
      { label: 'Converts', color: 'var(--cat-c)', points: points.map(p => [p[0], p[1]]) },
      { label: 'Loved', color: 'var(--cat-u)', points: points.map(p => [p[0], p[2]]) },
      { label: 'Official', color: 'var(--cat-r)', points: points.map(p => [p[0], p[3]]) },
    ], { format: v => fmt.num(v) })}
    <div class="legend"><span><i style="background:var(--cat-c)"></i>Converts</span><span><i style="background:var(--cat-u)"></i>Loved</span><span><i style="background:var(--cat-r)"></i>Official</span></div>
  </section>`;
}

export default async function player(root, { params, isCurrent }) {
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

  const counts = { converts: file.scores.c.length, loved: file.scores.u.length, ranked: file.scores.r.length, top: file.top.length, dan: file.dan.length };
  const tab = TAB_LIST.find(t => t.slug === params.tab) ?? TAB_LIST.find(t => t.slug !== 'dan' && counts[t.slug]) ?? TAB_LIST[0];
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
          <button class="btn btn-small" id="me" type="button"></button>
        </div>
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
      <h3>Signature map <span class="faint">· ${signature.kind}</span></h3>
      ${mapLink(signature.s[S.MAP], signature.meta)}
      <div class="score-line" style="margin-top:10px">${catChip(signature.cat)} ${scoreStats(signature.s)} <span>${fmt.pp(signature.s[S.PP])} pp</span> <span class="faint">${fmt.date(signature.s[S.TIME])}</span></div>
    </section>` : ''}

    ${historyChart(points)}

    <section class="section">
      ${tabs(TAB_LIST.map(t => ({ href: `#/player/${id}/${t.slug}`, label: t.label, count: counts[t.slug], active: t === tab })))}
      ${tab.slug === 'dan' ? danGrid(file) : html`
        ${tab.slug === 'top' ? html`<p class="muted small">The best ranked plays (converts included) with their official pp, taken from osu!’s monthly data dump.</p>` : ''}
        <div class="toolbar">
          <input class="input" type="search" id="q" placeholder="Search maps…" aria-label="Search maps">
          <select class="select" id="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}">${label}</option>`)}</select>
          ${tab.slug !== 'top' ? html`<span class="checks"><label><input type="checkbox" id="firsts"> Only #1s</label></span>` : ''}
        </div>
        <div id="scores"></div>`}
    </section>
  `);

  const meButton = root.querySelector('#me');
  const drawMe = () => {
    const mine = prefs.get('me', null) === id;
    meButton.textContent = mine ? 'Your profile' : 'This is me';
    meButton.classList.toggle('btn-on', mine);
    meButton.title = mine ? 'Click to unmark' : 'Mark this profile as yours to highlight it on the leaderboards';
  };
  meButton.addEventListener('click', () => {
    prefs.set('me', prefs.get('me', null) === id ? null : id);
    drawMe();
  });
  drawMe();

  if (tab.slug === 'dan') return;
  const cat = SLUG_CAT[tab.slug] ?? null;
  const all = tab.list(file);
  if (!all.length) {
    root.querySelector('#scores').innerHTML = String(empty(`${p.name} has no plays ${tab.slug === 'top' ? 'imported from the osu! data dump' : `in ${CAT_LABEL[cat]}`} yet.`));
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
  const redraw = paginate(root.querySelector('#scores'), visible(), slice => html`<div class="rows">${slice.map(s =>
    scoreRow({ s, meta: file.maps[s[S.MAP]], pos: tab.slug === 'top' ? null : s[S.POS] }))}</div>`);
  q.addEventListener('input', () => redraw(visible()));
  sort.addEventListener('change', () => redraw(visible()));
  onlyFirsts?.addEventListener('change', () => redraw(visible()));
}
