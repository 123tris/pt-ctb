// A player's dossier for a Top 10 year (/top10/dossier/:id/:year?, §4.2): what voters weigh, from the site's own data.
// The year summed up by the recap's summarise() (views/recap.ts) over the player's pack, the official pp and PT rank in
// January against now (history.json and the core pack), the top plays, #1s taken, Dan passes, the mod split and
// converts against catch-specific maps; then the community's showcase of the player, the most endorsed first. Never a
// vote count. The ballot's ⓘ opens the same body in a drawer (compact).

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack, PlayerPack } from '../gen/packs.ts';
import { M, S, MOD, modString } from '../kernel/model.ts';
import { avatar } from '../ui/players.ts';
import { mapLink } from '../ui/maps.ts';
import { catChip, scoreStats } from '../ui/scores.ts';
import { danName } from '../ui/events.ts';
import { stat } from '../ui/page.ts';
import { summarise, type Recap, type YearPlay } from './recap.ts';
import type { History } from './player.ts';
import { ppAt, yearStart, type Candidate, rankLine } from '../ui/top10-players.ts';
import { playRef, scoreCard, top10Tabs, type ShowPlay } from '../ui/top10.ts';
import type { CiteChoice } from './top10-ballot.ts';

export interface Data {
  id: number;
  year: number;
  core: CorePack;
  row: number;
  /** The player's pack: null when it couldn't be read (the summary is left out then). */
  pack: PlayerPack | null;
  history: History | null;
  /** The showcase's entries for the player, or null when the endpoints can't be reached. */
  plays: ShowPlay[] | null;
  /** The picker's view of the player (rank and pp since January). */
  candidate: Candidate | null;
}

/** The year's plays summed up, or null without a pack. */
export const recapOf = (d: Pick<Data, 'pack' | 'year'>): Recap | null => (d.pack ? summarise(d.pack, d.year) : null);

/** How much of the year's plays had each mod. */
function modSplit(plays: readonly YearPlay[]): [string, number][] {
  if (!plays.length) return [];
  const has = (mask: number) => plays.filter(p => p.s[S.MODS] & mask).length / plays.length;
  const nomod = plays.filter(p => !(p.s[S.MODS] & (MOD.HD | MOD.HR | MOD.DT | MOD.NC | MOD.FL | MOD.EZ | MOD.HT))).length / plays.length;
  return ([['HD', has(MOD.HD)], ['HR', has(MOD.HR)], ['DT', has(MOD.DT | MOD.NC)], ['FL', has(MOD.FL)], ['EZ', has(MOD.EZ)], ['NM', nomod]] as [string, number][])
    .filter(([, share]) => share >= 0.01);
}

export const title = (ctx: Ctx, d: Data): string => ctx.t('{name}’s {year}', { name: d.core.players.name.at(d.row), year: d.year });

/** The dossier's body, for the page and the ballot's drawer. */
export function dossierBody(ctx: Ctx, d: Data, { compact = false } = {}): Safe {
  const { t, fmt, tn } = ctx;
  const name = d.core.players.name.at(d.row);
  const w = recapOf(d);
  const ppJan = d.history ? ppAt(d.history, d.id, yearStart(d.year)) : null;
  const pp = d.core.players.pp[d.row] / 100;
  const gain = ppJan === null ? null : pp - ppJan;
  const top = w ? [...w.plays].sort((a, b) => b.s[S.PP] - a.s[S.PP]).slice(0, compact ? 3 : 5) : [];
  const split = w ? modSplit(w.plays) : [];
  const specifics = w ? w.perCat.u + w.perCat.r : 0;
  const shown = (d.plays ?? []).slice(0, compact ? 3 : 20);

  return html`
    <div class="grid grid-auto t10-stats">
      ${stat(t('Scores set in {year}', { year: d.year }), w ? fmt.num(w.plays.length) : '—', w ? t('{fc} FCs · {ss} SS', { fc: fmt.num(w.fc), ss: fmt.num(w.ss) }) : '')}
      ${stat(t('Official pp'), `${fmt.pp(pp)} pp`, gain === null ? '' : t('{sign}{pp} pp since 1 January', { sign: gain >= 0 ? '+' : '−', pp: fmt.pp(Math.abs(gain)) }))}
      ${stat(t('PT rank'), d.candidate?.rank ? `#${fmt.num(d.candidate.rank)}` : '—', d.candidate?.rankJan ? t('#{n} on 1 January', { n: fmt.num(d.candidate.rankJan) }) : '')}
      ${stat(t('#1s taken in {year}', { year: d.year }), w ? fmt.num(w.firsts.length) : '—', t('and still held'))}
      ${w?.dan.length ? stat(t('Dan passed in {year}', { year: d.year }), danName(ctx, Math.max(...w.dan)), w.dan.length > 1 ? tn(w.dan.length, '{n} stage', '{n} stages') : '') : ''}
    </div>

    ${w && w.plays.length ? html`
      <div class="t10-split">
        <div><span class="muted small">${t('Mods')}</span> ${split.map(([mod, share]) => html`<span class="t10-pill">${mod} ${fmt.num(share * 100)}%</span>`)}</div>
        <div><span class="muted small">${t('Maps')}</span>
          <span class="t10-pill">${t('Converts')} ${fmt.num((w.perCat.c / w.plays.length) * 100)}%</span>
          <span class="t10-pill">${t('Catch-specific')} ${fmt.num((specifics / w.plays.length) * 100)}%</span></div>
      </div>` : ''}

    ${top.length ? html`<h3 class="t10-h3">${t('Top plays of {year}', { year: d.year })}</h3>
      <ol class="t10-plays">${top.map(p => html`<li>${mapLink(ctx, p.s[S.MAP], p.meta)}
        <div class="score-line">${catChip(ctx, p.cat)} <span class="pp">${fmt.pp(p.s[S.PP])}<small>pp</small></span> ${scoreStats(ctx, p.s)} <span class="faint">${fmt.date(p.s[S.TIME])}</span></div></li>`)}</ol>`
      : html`<p class="muted">${d.pack ? t('No scores stored in {year}.', { year: d.year }) : t('Their scores couldn’t be loaded.')}</p>`}

    ${w && w.firsts.length && !compact ? html`<h3 class="t10-h3">${t('#1s in Portugal taken in {year}', { year: d.year })}</h3>
      <ul class="t10-plays t10-plays-short">${w.firsts.slice(0, 8).map(p => html`<li>${mapLink(ctx, p.s[S.MAP], p.meta)}</li>`)}</ul>
      ${w.firsts.length > 8 ? html`<p class="small faint">${t('and {n} more', { n: fmt.num(w.firsts.length - 8) })}</p>` : ''}` : ''}

    <h3 class="t10-h3">${t('Showcased by the community')}</h3>
    ${d.plays === null ? html`<p class="muted small">${t('The showcase couldn’t be loaded.')}</p>`
      : shown.length ? html`<ul class="t10-show-list">${shown.map(p => html`<li>${p.score_ref || p.score ? scoreCard(ctx, p.score, p.score_ref) : html`<div class="t10-score t10-score-bare"><a href="${p.clip}" target="_blank" rel="noopener">🎬 ${t('Clip')} ↗</a></div>`}
          ${p.caption ? html`<p class="t10-caption">“${p.caption}”</p>` : ''}<span class="small faint">🔥 ${fmt.num(p.endorsements ?? 0)}</span></li>`)}</ul>`
      : html`<p class="muted small">${t('Nobody has showcased a play of {name}’s yet.', { name })} <a href="/top10/plays?player=${d.id}">${t('Showcase one')}</a></p>`}

    ${compact ? html`<p class="btn-row mt-4"><a class="btn btn-small" href="/top10/dossier/${d.id}/${d.year}">${t('Open the full dossier')}</a></p>`
      : html`<p class="small faint mt-4">${t('Past Top 10 placements show here once the past years are imported.')}</p>`}
  `;
}

export function render(ctx: Ctx, d: Data): Safe {
  const { t } = ctx;
  const name = d.core.players.name.at(d.row);
  return html`${top10Tabs(ctx, '', d.year)}
    <header class="profile-head">
      ${avatar(ctx, d.core.players, d.row, 'avatar-lg')}
      <div><span class="eyebrow">${t('Top 10 of {year} · dossier', { year: d.year })}</span><h1>${title(ctx, d)}</h1>
        ${d.candidate ? html`<p class="muted m-0">${rankLine(ctx, d.candidate)}</p>` : ''}
        <div class="btn-row mt-2"><a class="btn btn-small" href="/player/${d.id}">← ${t('Profile')}</a>
          <a class="btn btn-small" href="/recap/${d.id}/${d.year}">${t('Year in review')}</a>
          <a class="btn btn-small" href="/top10/ballots?player=${d.id}">${t('What voters wrote about {name}', { name })}</a></div></div>
    </header>
    ${dossierBody(ctx, d)}`;
}

/**
 * A player's plays of the year as citable scores, the most pp first. A play's reference is its osu! score id; most
 * stored plays have none (93% of 2026's in the export), and those are referred to as map:<beatmap id>, the player's
 * stored best on that map (ui/top10.ts playRef).
 */
export function yearChoices(pack: PlayerPack | null, year: number): CiteChoice[] {
  if (!pack) return [];
  const w = recapOf({ pack, year });
  if (!w) return [];
  return [...w.plays].sort((a, b) => b.s[S.PP] - a.s[S.PP]).slice(0, 15).map(p => ({
    ref: playRef(p.s[S.ID], p.s[S.MAP]),
    label: '',
    card: {
      map: p.s[S.MAP], title: p.meta?.[M.TITLE], artist: p.meta?.[M.ARTIST], version: p.meta?.[M.VERSION], stars: p.meta?.[M.STARS], set: p.meta?.[M.SET],
      pp: p.s[S.PP], acc: p.s[S.ACC], miss: p.s[S.MISS], mods: modString(p.s[S.MODS]), time: p.s[S.TIME],
    },
  }));
}
