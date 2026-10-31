import { html } from '../core/html.js';
import { playerFile, playerIndex } from '../core/data.js';
import { S, M, CATS, isSS, modString } from '../core/model.js';
import { danName } from '../core/events.js';
import { barChart } from '../core/charts.js';
import { setTitle, avatar, mapLink, scoreStats, catChip, CAT_LABEL, mapText, empty } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { eraOf, localEra } from '../core/badges.js';
import { t, th } from '../core/i18n.js';

const WEEKDAYS = [t('Sunday'), t('Monday'), t('Tuesday'), t('Wednesday'), t('Thursday'), t('Friday'), t('Saturday')];

const mostCommon = values => {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0] ?? null;
};

/** The year's "era", in the Discord's terms: what most of the year's plays were (the same rules as the profile's). */
function yearEra(w) {
  const era = localEra(eraOf(w.plays));
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
  setTitle(t('{name} in {year}', { name: p.name, year: year ?? '' }));

  const yearChips = html`<div class="mb-4 chips">${years.map(y => html`<a class="chip ${y === year ? 'active' : ''}" href="#/recap/${id}/${y}">${y}</a>`)}</div>`;
  if (!year) {
    root.innerHTML = String(empty(t('{name} has no recorded plays yet.', { name: p.name })));
    return;
  }
  const w = summarise(file, year);
  const topBest = CATS.map(c => w.best[c]).filter(Boolean).sort((a, b) => b.s[S.PP] - a.s[S.PP])[0];
  const share = [
    t('My {year} in osu!catch (PT Catch) ✨', { year }),
    t('{scores} scores · {fruits} fruits caught · {ss} SS · {firsts} #1s in Portugal', { scores: fmt.num(w.plays.length), fruits: fmt.num(w.fruits), ss: fmt.num(w.ss), firsts: fmt.num(w.firsts.length) }),
    topBest ? t('Best play: {map} — {pp} pp', { map: mapText(topBest.s[S.MAP], topBest.meta).title, pp: fmt.pp(topBest.s[S.PP]) }) : '',
    `${location.href}`,
  ].filter(Boolean).join('\n');

  root.innerHTML = String(html`
    <header class="profile-head">
      ${avatar(id, 'avatar-lg')}
      <div><span class="eyebrow">${t('Year in review')}</span><h1>${t('{name}’s {year}', { name: p.name, year })}</h1>
        <div class="btn-row"><a class="btn btn-small" href="#/player/${id}">← ${t('Profile')}</a><button class="btn btn-small btn-primary" id="share" type="button">${t('Copy recap')}</button></div></div>
    </header>
    ${yearChips}
    <p class="small faint">${t('Counts {name}’s stored best scores on each map that were set in {year}. Plays that were improved later show up in the year of the improvement.', { name: p.name, year })}</p>

    <div class="wrapped">
      <div class="slide pink">
        <div class="muted">${t('In {year}, {name} set', { name: p.name, year })}</div>
        <div class="big">${fmt.plural(w.plays.length, 'score')}</div>
        <div class="mt-2 muted">${CATS.filter(c => w.perCat[c]).map((c, i) => html`${i ? ' · ' : ''}${t('{n} in {category}', { n: fmt.num(w.perCat[c]), category: CAT_LABEL[c] })}`)}</div>
      </div>

      <div class="grid grid-2">
        <div class="slide"><div class="muted">${t('Your era')}</div><div class="big-sm big">${yearEra(w)}</div></div>
        <div class="slide"><div class="muted">${t('1-miss plays')}</div><div class="big">${fmt.num(w.oneMiss)}</div><div class="muted small">${w.oneMiss ? t('The 1-miss gods have been busy.') : t('Not a single one. Suspicious.')}</div></div>
      </div>

      <div class="grid grid-3">
        <div class="slide"><div class="muted">${t('Fruits caught')}</div><div class="big">${fmt.num(w.fruits)}</div></div>
        <div class="slide gold"><div class="muted">${t('SS plays')}</div><div class="big">${fmt.num(w.ss)}</div><div class="muted small">${t('and {fcs}', { fcs: fmt.plural(w.fc, 'full combo') })}</div></div>
        <div class="slide blue"><div class="muted">${t('#1s in Portugal won')}</div><div class="big">${fmt.num(w.firsts.length)}</div><div class="muted small">${t('and still held')}</div></div>
      </div>

      ${topBest ? html`<div class="slide">
        <div class="muted">${t('Play of the year')}</div>
        <div class="mt-2 mb-3 big">${fmt.pp(topBest.s[S.PP])} pp</div>
        ${mapLink(topBest.s[S.MAP], topBest.meta)}
        <div class="mt-2 score-line">${catChip(topBest.cat)} ${scoreStats(topBest.s)} <span>${fmt.date(topBest.s[S.TIME])}</span></div>
      </div>` : ''}

      <div class="grid grid-3">
        ${w.mods ? html`<div class="slide"><div class="muted">${t('Favourite mods')}</div><div class="big">${w.mods[0]}</div><div class="muted small">${fmt.plural(w.mods[1], 'play')}</div></div>` : ''}
        ${w.mapper ? html`<div class="slide"><div class="muted">${t('Favourite mapper')}</div><div class="big-sm big">${w.mapper[0]}</div><div class="muted small">${fmt.plural(w.mapper[1], 'map')}</div></div>` : ''}
        ${w.artist ? html`<div class="slide"><div class="muted">${t('Favourite artist')}</div><div class="big-sm big">${w.artist[0]}</div><div class="muted small">${fmt.plural(w.artist[1], 'map')}</div></div>` : ''}
      </div>

      <div class="slide">
        <div class="muted">${t('Month by month')}</div>
        ${barChart(w.months.map((n, m) => ({ label: fmt.monthName(m), value: n, title: `${fmt.monthName(m)}: ${fmt.num(n)}` })))}
        <p class="m-0 mt-2 muted small">${th('Favourite day of the week to play: {day}.', { day: html`<b>${WEEKDAYS[w.weekday]}</b>` })}</p>
      </div>

      ${w.hardest ? html`<div class="slide">
        <div class="muted">${t('Hardest map of the year')}</div>
        <div class="mt-2 mb-3 big">★ ${fmt.num(w.hardest.meta[M.STARS], 2)}</div>
        ${mapLink(w.hardest.s[S.MAP], w.hardest.meta)}
      </div>` : ''}

      ${w.dan.length ? html`<div class="slide gold">
        <div class="muted">${t('Dan course')}</div>
        <div class="big">${w.dan.map(([i]) => danName(i)).join(' · ')}</div>
      </div>` : ''}
    </div>
  `);

  root.querySelector('#share').addEventListener('click', async e => {
    try {
      await navigator.clipboard.writeText(share);
      e.target.textContent = t('Copied!');
    } catch {
      e.target.textContent = t('Couldn’t copy');
    }
  });
}
