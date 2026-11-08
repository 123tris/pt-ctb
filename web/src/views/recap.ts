// A player's year in review (/recap/:id/:year?), as assets/js/pages/wrapped.js draws it: the year's scores, fruits,
// SSs and #1s, the play of the year, favourite mods, mapper and artist, month by month, the hardest map and the Dan
// stages passed. From the player's pack, where the old page downloads and parses their whole file, and the core pack.
//
// A year is the calendar year in the visitor's time zone, as on the old page: the plays are each map's stored best, so
// a play improved later counts in the year of the improvement.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack, PlayerPack } from '../gen/packs.ts';
import { S, M, isSS, modString } from '../kernel/model.ts';
import { empty } from '../ui/page.ts';
import { avatar } from '../ui/players.ts';
import { mapLink, mapText, type MapMeta } from '../ui/maps.ts';
import { catChip, catLabel, scoreStats, type Cat, type Play } from '../ui/scores.ts';
import { mapDetails, play } from '../ui/playerpack.ts';
import { eraOf, localEra } from '../ui/badges.ts';
import { barChart } from '../ui/charts.ts';
import { danName } from '../ui/events.ts';

const CATS: Cat[] = ['c', 'u', 'r'];

/** A play of the year: its category, the play as the JSON's tuple (S) and its map's details (M), for the helpers. */
export interface YearPlay {
  cat: Cat;
  s: Play;
  meta: MapMeta;
}

/** A year summed up. `mods`, `mapper` and `artist` are [the most common, how often], or null. */
export interface Recap {
  plays: YearPlay[];
  perCat: Record<Cat, number>;
  fruits: number;
  ss: number;
  fc: number;
  oneMiss: number;
  firsts: YearPlay[];
  best: Record<Cat, YearPlay | null>;
  mods: [string, number] | null;
  mapper: [string, number] | null;
  artist: [string, number] | null;
  hardest: YearPlay | null;
  /** Plays by month, January first. */
  months: number[];
  /** The day of the week with the most plays (0 Sunday). */
  weekday: number;
  /** The Dan stages passed in the year, as the player's list has them. */
  dan: number[];
}

export interface Data {
  id: number;
  core: CorePack;
  /** The player's row in core.players. */
  row: number;
  /** The years with plays, newest first, and the one shown (null: no plays at all). */
  years: number[];
  year: number | null;
  recap: Recap | null;
}

/**
 * The calendar year of a time (unix seconds) in the visitor's time zone, as Date's getFullYear() has it, but found by
 * the bounds of the years already met: a long list of plays takes one Date per year instead of one per play.
 */
function yearFinder(): (time: number) => number {
  const known: [number, number, number][] = []; // [the year's first second, the next year's, year]
  return time => {
    for (const [from, to, year] of known) if (time >= from && time < to) return year;
    const year = new Date(time * 1000).getFullYear();
    known.push([new Date(year, 0, 1).getTime() / 1000, new Date(year + 1, 0, 1).getTime() / 1000, year]);
    return year;
  };
}

const mostCommon = (values: readonly string[]): [string, number] | null => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0] ?? null;
};

/** Every year the player has a play in, newest first. */
export function yearsOf(pack: PlayerPack): number[] {
  const yearOf = yearFinder();
  const years = new Set<number>();
  for (const cat of CATS) for (const time of pack[cat].time) years.add(yearOf(time));
  return [...years].sort((a, b) => b - a);
}

/** The year's plays, worked out as the old page does from the whole file: only the year's rows become tuples. */
export function summarise(pack: PlayerPack, year: number): Recap {
  const yearOf = yearFinder();
  const plays: YearPlay[] = [];
  for (const cat of CATS) {
    const list = pack[cat];
    for (let i = 0; i < list.rows; i++) {
      if (yearOf(list.time[i]) === year) plays.push({ cat, s: play(list, i), meta: mapDetails(pack, list.map[i]) });
    }
  }
  const ofCat = (cat: Cat) => plays.filter(p => p.cat === cat);
  const best = (cat: Cat) => ofCat(cat).sort((a, b) => b.s[S.PP] - a.s[S.PP])[0] ?? null;
  const months = Array<number>(12).fill(0);
  const weekdays = Array<number>(7).fill(0);
  for (const { s } of plays) {
    const d = new Date(s[S.TIME] * 1000);
    months[d.getMonth()]++;
    weekdays[d.getDay()]++;
  }
  const titled = plays.filter(p => p.meta && p.meta[M.TITLE]);
  const dan: number[] = [];
  for (let i = 0; i < pack.dan.rows; i++) if (yearOf(pack.dan.time[i]) === year) dan.push(pack.dan.stage[i]);
  return {
    plays,
    perCat: { c: ofCat('c').length, u: ofCat('u').length, r: ofCat('r').length },
    fruits: plays.reduce((n, p) => n + p.s[S.HITS], 0),
    ss: plays.filter(p => isSS(p.s[S.GRADE])).length,
    fc: plays.filter(p => p.s[S.MISS] === 0).length,
    oneMiss: plays.filter(p => p.s[S.MISS] === 1).length,
    firsts: plays.filter(p => p.s[S.POS] === 1),
    best: { c: best('c'), u: best('u'), r: best('r') },
    mods: mostCommon(plays.map(p => modString(p.s[S.MODS]))),
    mapper: mostCommon(titled.map(p => p.meta![M.CREATOR])),
    artist: mostCommon(titled.map(p => p.meta![M.ARTIST])),
    // Not with EZ or HT, which make a map easier than its stars say.
    hardest: titled.filter(p => !(p.s[S.MODS] & (2 | 256))).sort((a, b) => b.meta![M.STARS] - a.meta![M.STARS])[0] ?? null,
    months,
    weekday: weekdays.indexOf(Math.max(...weekdays)),
    dan,
  };
}

/** The address's year when the player has plays in it, else their latest; the year summed up. */
export function recapOf(pack: PlayerPack, asked: string | undefined): Pick<Data, 'years' | 'year' | 'recap'> {
  const years = yearsOf(pack);
  const year = years.includes(Number(asked)) ? Number(asked) : years[0] ?? null;
  return { years, year, recap: year === null ? null : summarise(pack, year) };
}

/** The best play of the year across the categories, by pp. */
export const playOfTheYear = (w: Recap): YearPlay | undefined =>
  CATS.map(c => w.best[c]).filter((p): p is YearPlay => Boolean(p)).sort((a, b) => b.s[S.PP] - a.s[S.PP])[0];

export const title = (ctx: Ctx, { core, row, year }: Data): string =>
  ctx.t('{name} in {year}', { name: core.players.name.at(row), year: year ?? '' });

/** What "Copy recap" copies: the year in three lines and the page's address (`href`). */
export function shareText(ctx: Ctx, w: Recap, year: number, href: string): string {
  const { t, fmt } = ctx;
  const top = playOfTheYear(w);
  return [
    t('My {year} in osu!catch (PT Catch) ✨', { year }),
    t('{scores} scores · {fruits} fruits caught · {ss} SS · {firsts} #1s in Portugal', { scores: fmt.num(w.plays.length), fruits: fmt.num(w.fruits), ss: fmt.num(w.ss), firsts: fmt.num(w.firsts.length) }),
    top ? t('Best play: {map} — {pp} pp', { map: mapText(ctx, top.s[S.MAP], top.meta).title, pp: fmt.pp(top.s[S.PP]) }) : '',
    href,
  ].filter(Boolean).join('\n');
}

/** The year's "era", in the Discord's terms: what most of the year's plays were (the same rules as the profile's). */
function yearEra(ctx: Ctx, w: Recap): string {
  const era = localEra(ctx, eraOf(w.plays))!;
  return era[0].toUpperCase() + era.slice(1);
}

export function render(ctx: Ctx, data: Data): Safe {
  const { t, th, fmt } = ctx;
  const { id, core, row, years, year, recap: w } = data;
  const players = core.players;
  const name = players.name.at(row);
  if (year === null || !w) return empty(t('{name} has no recorded plays yet.', { name }));
  const weekdays = [t('Sunday'), t('Monday'), t('Tuesday'), t('Wednesday'), t('Thursday'), t('Friday'), t('Saturday')];
  const yearChips = html`<div class="mb-4 chips">${years.map(y => html`<a class="chip ${y === year ? 'active' : ''}" href="/recap/${id}/${y}">${y}</a>`)}</div>`;
  const topBest = playOfTheYear(w);

  return html`
    <header class="profile-head">
      ${avatar(ctx, players, row, 'avatar-lg')}
      <div><span class="eyebrow">${t('Year in review')}</span><h1>${t('{name}’s {year}', { name, year })}</h1>
        <div class="btn-row"><a class="btn btn-small" href="/player/${id}">← ${t('Profile')}</a><button class="btn btn-small btn-primary" id="share" type="button">${t('Copy recap')}</button></div></div>
    </header>
    ${yearChips}
    <p class="small faint">${t('Counts {name}’s stored best scores on each map that were set in {year}. Plays that were improved later show up in the year of the improvement.', { name, year })}</p>

    <div class="wrapped">
      <div class="slide pink">
        <div class="muted">${t('In {year}, {name} set', { name, year })}</div>
        <div class="big">${fmt.plural(w.plays.length, 'score')}</div>
        <div class="mt-2 muted">${CATS.filter(c => w.perCat[c]).map((c, i) => html`${i ? ' · ' : ''}${t('{n} in {category}', { n: fmt.num(w.perCat[c]), category: catLabel(ctx, c) })}`)}</div>
      </div>

      <div class="grid grid-2">
        <div class="slide"><div class="muted">${t('Your era')}</div><div class="big-sm big">${yearEra(ctx, w)}</div></div>
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
        ${mapLink(ctx, topBest.s[S.MAP], topBest.meta)}
        <div class="mt-2 score-line">${catChip(ctx, topBest.cat)} ${scoreStats(ctx, topBest.s)} <span>${fmt.date(topBest.s[S.TIME])}</span></div>
      </div>` : ''}

      <div class="grid grid-3">
        ${w.mods ? html`<div class="slide"><div class="muted">${t('Favourite mods')}</div><div class="big">${w.mods[0]}</div><div class="muted small">${fmt.plural(w.mods[1], 'play')}</div></div>` : ''}
        ${w.mapper ? html`<div class="slide"><div class="muted">${t('Favourite mapper')}</div><div class="big-sm big">${w.mapper[0]}</div><div class="muted small">${fmt.plural(w.mapper[1], 'map')}</div></div>` : ''}
        ${w.artist ? html`<div class="slide"><div class="muted">${t('Favourite artist')}</div><div class="big-sm big">${w.artist[0]}</div><div class="muted small">${fmt.plural(w.artist[1], 'map')}</div></div>` : ''}
      </div>

      <div class="slide">
        <div class="muted">${t('Month by month')}</div>
        ${barChart(ctx, w.months.map((n, m) => ({ label: fmt.monthName(m), value: n, title: `${fmt.monthName(m)}: ${fmt.num(n)}` })))}
        <p class="m-0 mt-2 muted small">${th('Favourite day of the week to play: {day}.', { day: html`<b>${weekdays[w.weekday]}</b>` })}</p>
      </div>

      ${w.hardest ? html`<div class="slide">
        <div class="muted">${t('Hardest map of the year')}</div>
        <div class="mt-2 mb-3 big">★ ${fmt.num(w.hardest.meta![M.STARS], 2)}</div>
        ${mapLink(ctx, w.hardest.s[S.MAP], w.hardest.meta)}
      </div>` : ''}

      ${w.dan.length ? html`<div class="slide gold">
        <div class="muted">${t('Dan course')}</div>
        <div class="big">${w.dan.map(i => danName(ctx, i)).join(' · ')}</div>
      </div>` : ''}
    </div>
  `;
}
