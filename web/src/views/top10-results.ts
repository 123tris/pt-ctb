// /top10/<year> and /top10/<year>/alltime: a Top 10's results (TOP10-DESIGN.md §5, §13.5), for the past editions
// imported from the forum threads (§13.10: 2020, 2021, 2022, 2023–24 keyed 2024, 2025, and the 2020 all-time list,
// §13.11) and for this season's once they're out. /top10 hands off here too from the reveal on.
//
// What it shows, from GET /api/top10/results (score.js's JSON): the ranking with each player's score out of 10, points,
// "on n of m lists", #1 votes and a strip of how many lists put them at each spot; shared spots as "=3", and why two
// players level on score aren't (the tie-breaks); players below 10 as "also received votes"; the honourable mentions
// and ones to watch; the ballot count; for a past edition, its forum thread as the source and each list's post; how
// it's scored; and the chips between editions and between the year's list and the all-time one.
//
// Before the reveal (or for a year with no Top 10) it says when the results come out, as the hub did.
//
// The reveal hook (§6, December's work): revealable() says when the 10 → 1 reveal should play, the ranking is drawn
// with data-t10-reveal then, and top10-results.mount.ts is where the reveal goes. Until then the results are drawn whole.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { avatar, avatarUrl, nameClass, rowOf, type Players } from '../ui/players.ts';
import {
  PAST_EDITIONS, kindName, lisbon, toSec, top10Tabs, troubleNote, type Hub, type Kind, type Phase, type Season, type Trouble,
} from '../ui/top10.ts';

// ---- The results JSON (score.js, §13.5; past editions add the §13.10 fields) -----------------------------------------

/** A ranked player. `positions` counts the lists that put them at each spot, 1 to 10. */
export interface Ranked {
  id: number;
  /** Repeats for a shared spot; the next one skips (1, 2, 3, 3, 5). */
  rank: number;
  /** Average points per list that could have had them, out of 10, to 2 decimals. */
  score: number;
  points: number;
  lists: number;
  /** The lists that could have had them: every counted list but their own. */
  eligible: number;
  firsts: number;
  positions: number[];
  best?: number;
  worst?: number;
  mentions: number;
  watch: number;
}

export interface Count {
  id: number;
  count: number;
}

/** A past edition's list as posted on the forum. */
export interface PastList {
  voter: number;
  post?: string | null;
}

export interface Results {
  year: number;
  kind?: Kind;
  ballots: number;
  finalizedAt?: string;
  ranking: Ranked[];
  mentions?: Count[];
  watch?: Count[];
  /** Past editions (§13.10): "2023-24", its label "2023–24", the forum thread, and every id's name then. */
  edition?: string;
  label?: string;
  thread?: string | null;
  past?: boolean;
  names?: Record<string, string>;
  lists?: PastList[];
}

/** Why there are no results to show: not out yet (this season before the reveal, a year to come), or none for that year. */
export type Missing = 'not_yet' | 'none';

export interface Data {
  year: number;
  kind: Kind;
  season: Season;
  phase: Phase;
  hub: Hub | null;
  results: Results | null;
  missing: Missing | null;
  trouble: Trouble;
  /** The site's player index (the core pack), for avatars, today's names and profile links; null without it. */
  players: Players | null;
}

/** What GET /api/top10/results answered, as the page's results, missing or trouble. */
export function answerOf(status: number, body: unknown): Pick<Data, 'results' | 'missing' | 'trouble'> {
  const b = body as Partial<Results> & { code?: string } | null;
  if (status >= 200 && status < 300 && b && Array.isArray(b.ranking)) return { results: b as Results, missing: null, trouble: null };
  // 404 is "not out yet" (not_yet) or "no results for that year and kind" (not_published, or no endpoint at all).
  if (status === 404) return { results: null, missing: b?.code === 'not_yet' ? 'not_yet' : 'none', trouble: null };
  return { results: null, missing: null, trouble: status === 503 ? 'off' : status === 0 ? 'offline' : 'error' };
}

// ---- Editions --------------------------------------------------------------------------------------------------------

export interface Edition {
  year: number;
  label: string;
  kind: Kind;
}

/** The editions whose results are out (GET /api/top10's), or the known past years when it can't be asked; by year, the year's list first. */
export function editionsOf(hub: Hub | null): Edition[] {
  const all: Edition[] = hub?.editions ? hub.editions.map(e => ({ year: e.year, label: e.label, kind: e.kind === 'alltime' ? 'alltime' : 'year' }))
    : PAST_EDITIONS.map(([year, label]) => ({ year, label, kind: 'year' }));
  return all.sort((a, b) => a.year - b.year || (a.kind === 'alltime' ? 1 : 0) - (b.kind === 'alltime' ? 1 : 0));
}

/**
 * A year's name, "2023–24" for 2024: the year's own edition's label. An all-time edition's label ("All time (2020)")
 * names the list, not the year, so it isn't used.
 */
export function yearLabel(year: number, hub: Hub | null, results?: Results | null): string {
  return hub?.editions?.find(e => e.year === year && (e.kind ?? 'year') === 'year')?.label
    ?? PAST_EDITIONS.find(([y]) => y === year)?.[1]
    ?? (results && (results.kind ?? 'year') === 'year' && results.year === year ? results.label : undefined)
    ?? String(year);
}

/** An edition's chip text: "2023–24", or "2020, all time". */
const editionText = (ctx: Ctx, e: Edition, hub: Hub | null): string =>
  (e.kind === 'alltime' ? ctx.t('{label}, all time', { label: yearLabel(e.year, hub) }) : e.label);

/** The page's address for a year and kind. */
export const resultsHref = (year: number, kind: Kind): string => `/top10/${year}${kind === 'alltime' ? '/alltime' : ''}`;

// ---- Players ---------------------------------------------------------------------------------------------------------

/** A player's name: today's on the site, else the one the edition kept (`names`), else #id. */
export function nameOf(d: Pick<Data, 'players' | 'results'>, id: number): string {
  const row = d.players ? rowOf(d.players, id) : -1;
  if (row >= 0) return d.players!.name.at(row);
  return d.results?.names?.[id] ?? `#${id}`;
}

/** A player with their avatar: a link to their profile when the site has them, plain otherwise (osu!'s avatar). */
export function who(ctx: Ctx, d: Pick<Data, 'players' | 'results'>, id: number): Safe {
  const row = d.players ? rowOf(d.players, id) : -1;
  if (row >= 0) {
    const p = d.players!;
    return html`<a class="player t10-res-name" href="/player/${id}">${avatar(ctx, p, row)}<span class="${nameClass(ctx, p, row)}">${p.name.at(row)}</span></a>`;
  }
  return html`<span class="player t10-res-name"><img class="avatar" src="${avatarUrl(id)}" alt="" width="32" height="32" loading="lazy" decoding="async" data-hide-broken><span>${nameOf(d, id)}</span></span>`;
}

// ---- The ranking -----------------------------------------------------------------------------------------------------

/** "3", or "=3" for a shared spot. */
export function spotText(ranking: readonly Ranked[], i: number): string {
  const rank = ranking[i].rank;
  return `${ranking.some((r, j) => j !== i && r.rank === rank) ? '=' : ''}${rank}`;
}

/** The median spot from `positions`, when every list they're on is in it (spots past 10 aren't); null otherwise. */
function medianOf(r: Ranked): number | null {
  const spots = r.positions.flatMap((n, i) => Array<number>(n).fill(i + 1));
  if (spots.length !== r.lists || !spots.length) return null;
  const m = spots.length >> 1;
  return spots.length % 2 ? spots[m] : (spots[m - 1] + spots[m]) / 2;
}

export type TieBreak = 'lists' | 'firsts' | 'median' | 'mentions' | 'shared';

/**
 * Why `a` is above `b` when they're level on score (score.js's order, §13.5): more lists, then more #1s, then the
 * better median spot, then more honourable mentions; 'shared' when they share the spot; null when the scores differ.
 */
export function tieBreak(a: Ranked, b: Ranked): TieBreak | null {
  if (a.score !== b.score) return null;
  if (a.rank === b.rank) return 'shared';
  if (a.lists !== b.lists) return 'lists';
  if (a.firsts !== b.firsts) return 'firsts';
  const ma = medianOf(a), mb = medianOf(b);
  if (ma === null || mb === null || ma !== mb) return 'median';
  return 'mentions';
}

function tieText(ctx: Ctx, why: TieBreak, name: string): string {
  const { t } = ctx;
  return ({
    lists: t('Same score as {name}, ahead for being on more lists.', { name }),
    firsts: t('Same score as {name}, ahead on #1 votes.', { name }),
    median: t('Same score as {name}, ahead on the median spot.', { name }),
    mentions: t('Same score as {name}, ahead on honourable mentions.', { name }),
    shared: t('Shares the spot with {name}: level on every tie-break.', { name }),
  })[why];
}

/** Points as they are: 69, or 33.5 where a shared spot split them. */
const pointsText = (ctx: Ctx, n: number): string => ctx.fmt.num(n, Number.isInteger(n) ? 0 : 1);

/** The strip of spots 1–10: how many lists put the player at each, darker for more. */
export function positionsBar(ctx: Ctx, r: Ranked): Safe {
  const most = Math.max(1, ...r.positions);
  const said = r.positions.map((n, i) => (n ? `#${i + 1} ×${n}` : '')).filter(Boolean).join(', ');
  return html`<span class="t10-pos" role="img" aria-label="${ctx.t('Spots on the lists')}: ${said || '—'}">${r.positions.slice(0, 10).map((n, i) =>
    html`<i class="${n ? 'on' : ''}" style="--a:${n ? (0.25 + 0.75 * (n / most)).toFixed(2) : 0}" title="#${i + 1}: ${n}">${n || ''}</i>`)}</span>`;
}

function row(ctx: Ctx, d: Data, ranking: readonly Ranked[], i: number): Safe {
  const { tn, fmt } = ctx;
  const r = ranking[i];
  const below = ranking[i + 1];
  const above = ranking[i - 1];
  // The note goes on the higher of two players level on score; a shared spot is said on both.
  const why = below ? tieBreak(r, below) : null;
  const shared = !why && above && tieBreak(above, r) === 'shared' ? 'shared' : null;
  const note = why ? tieText(ctx, why, nameOf(d, below.id)) : shared ? tieText(ctx, 'shared', nameOf(d, above.id)) : '';
  const podium = r.rank <= 3 ? `t10-res-p${r.rank}` : '';
  return html`<li class="t10-res-row ${podium}" data-rank="${r.rank}">
    <span class="t10-spot">${spotText(ranking, i)}</span>
    <span class="t10-res-who">${who(ctx, d, r.id)}</span>
    <span class="t10-res-score"><b>${fmt.num(r.score, 2)}</b><small>/10</small></span>
    <span class="t10-res-figs">${tn(r.points, '{n} point', '{n} points', { n: pointsText(ctx, r.points) })}
      · ${tn(r.eligible, 'on {k} of {n} list', 'on {k} of {n} lists', { k: fmt.num(r.lists) })}${r.firsts ? html` · <b>${tn(r.firsts, '{n} #1 vote', '{n} #1 votes')}</b>` : ''}</span>
    ${positionsBar(ctx, r)}
    ${note ? html`<span class="t10-res-tie">${note}</span>` : ''}
  </li>`;
}

/** Whether the 10 → 1 reveal (§6, December) should play: this season's results, not a past edition's. */
export const revealable = (d: Pick<Data, 'results' | 'year' | 'season'>): boolean =>
  Boolean(d.results && !d.results.past && d.year === d.season.year);

function counts(ctx: Ctx, d: Data, list: readonly Count[] | undefined, title: string, id: string): Safe | '' {
  if (!list?.length) return '';
  return html`<section class="section" aria-labelledby="${id}">
    <h2 id="${id}">${title}</h2>
    <ul class="t10-res-counts">${list.map(c => html`<li>${who(ctx, d, c.id)}${c.count > 1 ? html` <span class="t10-pill">×${c.count}</span>` : ''}</li>`)}</ul>
  </section>`;
}

/** How it's scored (§5), short. */
function howNote(ctx: Ctx, past: boolean): Safe {
  const { t } = ctx;
  return html`<section class="section t10-res-how" aria-labelledby="t10-how-h">
    <h2 id="t10-how-h">${t('How it’s scored')}</h2>
    <p>${t('Each list gives 10 points to its #1, 9 to its #2 and so on, down to 1 for its #10. Players sharing a spot split the points of the spots they cover.')}</p>
    <p>${t('A player’s score is their average points per list, out of 10: their points divided by every list that could have had them, which is all of them but their own, as nobody votes for themselves. Not being on a list counts as 0.')}</p>
    <p>${t('Level scores go to whoever is on more lists, then has more #1 votes, then the better median spot, then more honourable mentions.')}</p>
    ${past ? html`<p class="small faint">${t('Past editions are counted with today’s formula, so the order can differ from the one posted back then.')}</p>` : ''}
  </section>`;
}

/** Every edition, the one shown marked. */
function editionChips(ctx: Ctx, d: Data): Safe | '' {
  const all = editionsOf(d.hub);
  if (!all.length) return '';
  return html`<nav class="chips t10-past" aria-label="${ctx.t('All editions')}"><span class="chips-label">${ctx.t('All editions')}</span>
    ${all.map(e => {
      const on = e.year === d.year && e.kind === d.kind;
      return html`<a class="chip ${on ? 'active' : ''}" href="${resultsHref(e.year, e.kind)}" ${on ? html`aria-current="page"` : ''}>${editionText(ctx, e, d.hub)}</a>`;
    })}</nav>`;
}

/** The year's list and the all-time one, when the year has both (2020). */
function kindChips(ctx: Ctx, d: Data, label: string): Safe | '' {
  const kinds = editionsOf(d.hub).filter(e => e.year === d.year).map(e => e.kind);
  if (!kinds.includes('year') || !kinds.includes('alltime')) return '';
  return html`<nav class="chips t10-kinds" aria-label="${ctx.t('Which ballot')}">${(['year', 'alltime'] as const).map(k =>
    html`<a class="chip ${k === d.kind ? 'active' : ''}" href="${resultsHref(d.year, k)}" ${k === d.kind ? html`aria-current="page"` : ''}>${k === 'alltime' ? html`👑 ${ctx.t('Top 10 of all time')}` : html`🏆 ${ctx.t('Top 10 of {year}', { year: label })}`}</a>`)}</nav>`;
}

export function title(ctx: Ctx, d: Data): string {
  const label = yearLabel(d.year, d.hub, d.results);
  return d.kind === 'alltime' ? `${kindName(ctx, 'alltime', d.year)} · ${label}` : ctx.t('Top 10 of {year}', { year: label });
}

export function render(ctx: Ctx, d: Data): Safe {
  const { t, th, tn } = ctx;
  const label = yearLabel(d.year, d.hub, d.results);
  const season = d.season.year;
  const head = (lead: Safe | '' = '') => html`${top10Tabs(ctx, 'hub', season)}
    <header class="page-head"><span class="eyebrow">${d.kind === 'alltime' ? t('Top 10 of all time · {year}', { year: label }) : t('Top 10 of {year}', { year: label })}</span><h1>${t('The results')}</h1>${lead}</header>
    ${kindChips(ctx, d, label)}`;

  const r = d.results;
  if (!r) {
    const ballots = d.kind === 'alltime' ? '?kind=alltime' : '';
    // This season before the reveal: when they come out, and what to read meanwhile (as the hub said).
    const soon = d.year === season && d.phase !== 'revealed';
    const text = d.trouble ? '' : d.year > season ? t('There’s no Top 10 of {year} yet.', { year: label })
      : soon ? t('The results come out {when}, Lisbon time.', { when: lisbon(ctx, toSec(d.season.reveal)) })
        : t('There are no results for this one.');
    return html`${head()}${troubleNote(ctx, d.trouble)}
      <div class="empty t10-soon"><p class="t10-done-big">🏆</p>
        ${text ? html`<p>${text}</p>` : ''}
        <div class="btn-row justify-center">${soon ? html`<a class="btn" href="/top10/ballots${ballots}">${t('Read the ballots')}</a><a class="btn" href="/top10/plays${d.kind === 'alltime' ? '?scope=alltime' : ''}">${d.kind === 'alltime' ? t('Legendary plays') : t('Plays of {year}', { year: season })}</a>`
          : html`<a class="btn" href="/top10">${t('Top 10 of {year}', { year: season })}</a>`}</div>
        ${editionChips(ctx, d)}</div>`;
  }

  const past = Boolean(r.past);
  const top = r.ranking.filter(x => x.rank <= 10);
  const more = r.ranking.filter(x => x.rank > 10);
  const lists = past ? (r.lists ?? []).filter(l => l.post) : [];
  const lead = html`<p>${past
      ? tn(r.ballots, 'Combined from the one list posted in the osu! forum thread, with the same formula as today’s ballots.', 'Combined from the {n} lists posted in the osu! forum thread, with the same formula as today’s ballots.')
      : tn(r.ballots, '{n} ballot counted.', '{n} ballots counted.')}
      ${past && r.thread ? th('Source: {link}. The write-ups are there, in each voter’s post.', { link: html`<a href="${r.thread}" target="_blank" rel="noopener">${t('the original thread on osu!')} ↗</a>` }) : ''}</p>`;
  return html`${head(lead)}

    <p class="small faint t10-res-key">${t('The squares count the lists that put each player #1, #2 and so on, to #10.')}</p>
    <ol class="t10-res" ${revealable(d) ? html`data-t10-reveal` : ''} aria-label="${t('The results')}">
      ${top.map((_, i) => row(ctx, d, r.ranking, i))}
    </ol>

    ${more.length ? html`<section class="section" aria-labelledby="t10-more-h">
      <h2 id="t10-more-h">${t('Also received votes')}</h2>
      <ol class="t10-res t10-res-more">${more.map((_, i) => row(ctx, d, r.ranking, top.length + i))}</ol>
    </section>` : ''}

    ${counts(ctx, d, r.mentions, t('Honourable mentions'), 't10-mentions-h')}
    ${d.kind === 'alltime' ? '' : counts(ctx, d, r.watch, t('Ones to watch'), 't10-watch-h')}

    ${lists.length ? html`<section class="section" aria-labelledby="t10-lists-h">
      <h2 id="t10-lists-h">${t('The lists')}</h2>
      <p class="muted">${t('Each voter’s post in the thread, with their list and what they wrote.')}</p>
      <ul class="t10-res-counts">${lists.map(l => html`<li><a href="${l.post!}" target="_blank" rel="noopener">${nameOf(d, l.voter)} ↗</a></li>`)}</ul>
    </section>` : !past && d.year === season ? html`<p><a class="btn btn-small" href="/top10/ballots${d.kind === 'alltime' ? '?kind=alltime' : ''}">${t('Read the ballots')}</a></p>` : ''}

    ${howNote(ctx, past)}
    ${editionChips(ctx, d)}`;
}
