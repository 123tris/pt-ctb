import { html } from '../core/html.js';
import { playerFile, playerIndex } from '../core/data.js';
import { S, M, CATS, isSS, modString } from '../core/model.js';
import { danName } from '../core/events.js';
import { barChart } from '../core/charts.js';
import { setTitle, avatar, mapLink, scoreStats, catChip, CAT_LABEL, mapText, empty } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { eraOf } from '../core/badges.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const mostCommon = values => {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0] ?? null;
};

/** The year's "era", in the Discord's terms: what most of the year's plays were (the same rules as the profile's). */
function yearEra(w) {
  const era = eraOf(w.plays);
  return era[0].toUpperCase() + era.slice(1);
}

function summarise(file, year) {
  const inYear = s => new Date(s[S.TIME] * 1000).getFullYear() === year;
  const plays = CATS.flatMap(cat => file.scores[cat].filter(inYear).map(s => ({ cat, s, meta: file.maps[s[S.MAP]] })));
  const best = cat => plays.filter(p => p.cat === cat).sort((a, b) => b.s[S.PP] - a.s[S.PP])[0] ?? null;
  const months = Array(12).fill(0);
  const weekdays = Array(7).fill(0);
  for (const { s } of plays) {
    const d = new Date(s[S.TIME] * 1000);
    months[d.getMonth()]++;
    weekdays[d.getDay()]++;
  }
  const titled = plays.filter(p => p.meta && p.meta[M.TITLE]);
  return {
    plays,
    perCat: Object.fromEntries(CATS.map(cat => [cat, plays.filter(p => p.cat === cat).length])),
    fruits: plays.reduce((n, p) => n + p.s[S.HITS], 0),
    ss: plays.filter(p => isSS(p.s[S.GRADE])).length,
    fc: plays.filter(p => p.s[S.MISS] === 0).length,
    oneMiss: plays.filter(p => p.s[S.MISS] === 1).length,
    firsts: plays.filter(p => p.s[S.POS] === 1),
    best: Object.fromEntries(CATS.map(cat => [cat, best(cat)])),
    mods: mostCommon(plays.map(p => modString(p.s[S.MODS]))),
    mapper: mostCommon(titled.map(p => p.meta[M.CREATOR])),
    artist: mostCommon(titled.map(p => p.meta[M.ARTIST])),
    hardest: titled.filter(p => !(p.s[S.MODS] & (2 | 256))).sort((a, b) => b.meta[M.STARS] - a.meta[M.STARS])[0] ?? null,
    months,
    weekday: weekdays.indexOf(Math.max(...weekdays)),
    dan: file.dan.filter(([, s]) => inYear(s)),
  };
}

export default async function wrapped(root, { params, isCurrent }) {
  const id = Number(params.id);
  const [file, index] = await Promise.all([playerFile(id), playerIndex()]);
  if (!isCurrent()) return;
  const p = index.get(id);
  const years = [...new Set(CATS.flatMap(c => file.scores[c].map(s => new Date(s[S.TIME] * 1000).getFullYear())))].sort((a, b) => b - a);
  const year = years.includes(Number(params.year)) ? Number(params.year) : years[0];
  setTitle(`${p.name} in ${year ?? ''}`);

  const yearChips = html`<div class="chips" style="margin-bottom:18px">${years.map(y => html`<a class="chip ${y === year ? 'active' : ''}" href="#/recap/${id}/${y}">${y}</a>`)}</div>`;
  if (!year) {
    root.innerHTML = String(empty(`${p.name} has no recorded plays yet.`));
    return;
  }
  const w = summarise(file, year);
  const topBest = CATS.map(c => w.best[c]).filter(Boolean).sort((a, b) => b.s[S.PP] - a.s[S.PP])[0];
  const share = [
    `My ${year} in osu!catch (PT-CTB) ✨`,
    `${w.plays.length} scores · ${fmt.num(w.fruits)} fruits caught · ${w.ss} SS · ${w.firsts.length} #1s in Portugal`,
    topBest ? `Best play: ${mapText(topBest.s[S.MAP], topBest.meta).title} — ${fmt.pp(topBest.s[S.PP])} pp` : '',
    `${location.href}`,
  ].filter(Boolean).join('\n');

  root.innerHTML = String(html`
    <header class="profile-head">
      ${avatar(id, 'avatar-lg')}
      <div><span class="eyebrow">Year in review</span><h1>${p.name}’s ${year}</h1>
        <div class="btn-row"><a class="btn btn-small" href="#/player/${id}">← Profile</a><button class="btn btn-small btn-primary" id="share" type="button">Copy recap</button></div></div>
    </header>
    ${yearChips}
    <p class="small faint">Counts ${p.name}’s stored best scores on each map that were set in ${year}. Plays that were improved later show up in the year of the improvement.</p>

    <div class="wrapped">
      <div class="slide pink">
        <div class="muted">In ${year}, ${p.name} set</div>
        <div class="big">${fmt.plural(w.plays.length, 'score')}</div>
        <div class="muted" style="margin-top:8px">${CATS.filter(c => w.perCat[c]).map((c, i) => html`${i ? ' · ' : ''}${fmt.num(w.perCat[c])} in ${CAT_LABEL[c]}`)}</div>
      </div>

      <div class="grid grid-2">
        <div class="slide"><div class="muted">Your era</div><div class="big" style="font-size:2rem">${yearEra(w)}</div></div>
        <div class="slide"><div class="muted">1-miss plays</div><div class="big">${fmt.num(w.oneMiss)}</div><div class="muted small">${w.oneMiss ? 'The 1-miss gods have been busy.' : 'Not a single one. Suspicious.'}</div></div>
      </div>

      <div class="grid grid-3">
        <div class="slide green"><div class="muted">Fruits caught</div><div class="big">${fmt.num(w.fruits)}</div></div>
        <div class="slide gold"><div class="muted">SS plays</div><div class="big">${fmt.num(w.ss)}</div><div class="muted small">and ${fmt.plural(w.fc, 'full combo')}</div></div>
        <div class="slide blue"><div class="muted">#1s in Portugal won</div><div class="big">${fmt.num(w.firsts.length)}</div><div class="muted small">and still held</div></div>
      </div>

      ${topBest ? html`<div class="slide">
        <div class="muted">Play of the year</div>
        <div class="big" style="margin:6px 0 14px">${fmt.pp(topBest.s[S.PP])} pp</div>
        ${mapLink(topBest.s[S.MAP], topBest.meta)}
        <div class="score-line" style="margin-top:10px">${catChip(topBest.cat)} ${scoreStats(topBest.s)} <span>${fmt.date(topBest.s[S.TIME])}</span></div>
      </div>` : ''}

      <div class="grid grid-3">
        ${w.mods ? html`<div class="slide"><div class="muted">Favourite mods</div><div class="big">${w.mods[0]}</div><div class="muted small">${fmt.plural(w.mods[1], 'play')}</div></div>` : ''}
        ${w.mapper ? html`<div class="slide"><div class="muted">Favourite mapper</div><div class="big" style="font-size:1.8rem">${w.mapper[0]}</div><div class="muted small">${fmt.plural(w.mapper[1], 'map')}</div></div>` : ''}
        ${w.artist ? html`<div class="slide"><div class="muted">Favourite artist</div><div class="big" style="font-size:1.8rem">${w.artist[0]}</div><div class="muted small">${fmt.plural(w.artist[1], 'map')}</div></div>` : ''}
      </div>

      <div class="slide">
        <div class="muted">Month by month</div>
        ${barChart(w.months.map((n, m) => ({ label: fmt.monthName(m), value: n, title: `${fmt.monthName(m)}: ${fmt.num(n)}` })))}
        <p class="muted small" style="margin:8px 0 0">Favourite day of the week to play: <b>${WEEKDAYS[w.weekday]}</b>.</p>
      </div>

      ${w.hardest ? html`<div class="slide">
        <div class="muted">Hardest map of the year</div>
        <div class="big" style="margin:6px 0 14px">★ ${fmt.num(w.hardest.meta[M.STARS], 2)}</div>
        ${mapLink(w.hardest.s[S.MAP], w.hardest.meta)}
      </div>` : ''}

      ${w.dan.length ? html`<div class="slide gold">
        <div class="muted">Dan course</div>
        <div class="big">${w.dan.map(([i]) => danName(i)).join(' · ')}</div>
      </div>` : ''}
    </div>
  `);

  root.querySelector('#share').addEventListener('click', async e => {
    try {
      await navigator.clipboard.writeText(share);
      e.target.textContent = 'Copied!';
    } catch {
      e.target.textContent = 'Couldn’t copy';
    }
  });
}
