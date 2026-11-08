// A player's profile (/player/:id/:tab?), the same page as assets/js/pages/player.js drew: the head with its stats, the
// signature play, trophies, duels, Bananas, the pp chart and the score lists. The player is a row in the core pack; the rest
// is the JSON the old page reads: their file (the small head file first, the whole one when a list needs it),
// bounties.json, economy.json, records.json (badges, only without a head file) and history.json (the chart, only once
// it's opened: it's every player's).
//
// render() is pure: the whole page, with the address's list already searched, sorted, filtered and paged, so the first
// paint is final. The browser half (the list's controls, the chart, the wallet's forms, the badges card) is
// player.mount.ts.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { S, CATS, PLAY_SOURCES, DAN_STAGES, DAN_MAPS, HILL_SLOTS, HILL_TIERS, THRONE_PLAYER, danRole } from '../kernel/model.ts';
import { tabs, stat, empty, emptyFiltered, resultCount, chipGroup, placeholderRows, paged } from '../ui/page.ts';
import { avatar, nameClass, isLegend, legendTag, isInactiveOnOsu, inactiveTag, officialPpNote, playerName, type Players } from '../ui/players.ts';
import { mapLink, mapText, mapLabel, osuUser, osuMap, type MapMeta } from '../ui/maps.ts';
import { scoreRow, scoreStats, scoreUrl, catChip, catLabel, gradeBadge, SLUG_CAT, type Play, type Cat } from '../ui/scores.ts';
import { playerBadges, localBadge, era, localEra, signatureMap, type Badge, type BadgeRecords, type Signature } from '../ui/badges.ts';
import { danName } from '../ui/events.ts';
import { jersey, danPasses } from '../ui/ladder.ts';
import { slotName, tierName, titleName, titleWhen, slotTally, type HillTitle } from '../ui/hill.ts';
import { goalLabel, type Goal } from '../ui/bounty.ts';
import { deltaText, duelistClass, experimentalTag, provisionalTag, recordWords, streakWords, type ProfileDuel, type ProfileDuels } from '../ui/duels.ts';
import { RULES, bananas, ledgerList, signInButton, type Wallet, type LedgerRow } from '../ui/bananas.ts';
import { lineChart } from '../ui/charts.ts';

export type Query = Record<string, string | undefined>;

/** A player's file: players/{id}.json, or the head file players/{id}-head.json (tools/lib/build.mjs). */
export interface PlayerFile {
  id: number;
  name: string;
  /** A head file: each list's first page only (HEAD_ROWS), the lengths in `counts`, and `extras` worked out. */
  head?: boolean;
  counts?: { c: number; u: number; r: number; dan: number; pre: number };
  scores: Record<Cat, Play[]>;
  /** Dan passes: [stage, play]. */
  dan: [number, Play][];
  /** Plays set before their map was ranked. */
  pre?: Play[];
  maps: Record<string, MapMeta>;
  /** The wallet's latest lines. */
  ledger?: LedgerRow[];
  /** The signature play pinned with bananas: [category, ...play]. */
  pinned?: [Cat, ...unknown[]];
  /** King of the hill (tools/lib/hill.mjs): crowns by slot, titles, and the slots held this month ([slot, tier, map]). */
  crowns?: { total: number; slots: number[]; titles: HillTitle[]; holding: [string, string, number][] };
  /** Duels (tools/lib/duels.mjs): their rating and place, their latest duels and who they've played most. */
  duels?: ProfileDuels;
  extras?: { badges: Badge[]; era: string | null; signature: Signature | null };
}

/** [day, converts pp, loved pp, official pp]: a day's index in `days` and the totals then (null: none known). */
export type HistoryRow = [number, number | null, number | null, number | null];

/** history.json: each player's totals by day since the site started recording, and monthly before, rebuilt. */
export interface History {
  days: string[];
  series: Record<string, HistoryRow[]>;
  reconstructed?: { days: string[]; series: Record<string, HistoryRow[]> } | null;
}

/** bounties.json's hall of fame ([map, …, goal, status, player, when]) and the maps it names. */
export interface Bounties {
  hall?: [number, unknown, Goal, string, number, number | null][];
  maps?: Record<string, MapMeta>;
}

export interface Economy {
  players?: Record<string, Wallet>;
}

export interface Data {
  id: number;
  core: CorePack;
  /** The player's row in core.players. */
  row: number;
  file: PlayerFile;
  /** records.json, for badges worked out here (a file without `extras`); null otherwise. */
  records: BadgeRecords | null;
  bounties: Bounties | null;
  economy: Economy | null;
  /** history.json, or null while the chart is shut: it's loaded when it's opened. */
  history: History | null;
}

export interface State {
  /** The score list in the address (/player/:id/:tab). */
  tab: string | undefined;
  /** ?q, ?sort, ?firsts and ?page for the list; ?tip to start a tip. */
  query: Query;
  /** The chart is open (the visitor's choice, which the browser keeps). */
  chartOpen: boolean;
  /** Signing in works on this address (client/bananas.ts signInHere()). */
  signInHere: boolean;
}

export const readState = (params: Query, query: Query, visitor: { chartOpen: boolean; signInHere: boolean }): State =>
  ({ tab: params.tab, query, ...visitor });

/** The page's title: the player's name. */
export const title = (data: Data): string => data.core.players.name.at(data.row);

/** How many claimed bounties the trophies list by name before linking to the rest. */
const CLAIMS_SHOWN = 3;

/** Rows per list in a head file (HEAD_ROWS in tools/lib/build.mjs): one page of the list. */
export const HEAD_ROWS = 50;

// ---- Score lists ----------------------------------------------------------------------------------------------------

export const SORT_KEYS = ['pp', 'recent', 'pos', 'acc', 'combo'] as const;
export type SortKey = typeof SORT_KEYS[number];

const sortLabel = (ctx: Ctx, key: SortKey): string => ({
  pp: ctx.t('Most pp'), recent: ctx.t('Most recent'), pos: ctx.t('Best position in PT'), acc: ctx.t('Best accuracy'), combo: ctx.t('Highest combo'),
})[key];

const SORTS: Record<SortKey, (a: Play, b: Play) => number> = {
  pp: (a, b) => b[S.PP] - a[S.PP],
  recent: (a, b) => b[S.TIME] - a[S.TIME],
  pos: (a, b) => (a[S.POS] || 1e9) - (b[S.POS] || 1e9) || b[S.PP] - a[S.PP],
  acc: (a, b) => b[S.ACC] - a[S.ACC],
  combo: (a, b) => b[S.COMBO] - a[S.COMBO],
};

/** Each play's category, for the lists that mix them (a score tuple doesn't carry its own). */
const playCat = new WeakMap<Play, Cat>();

/**
 * The plays of several categories in one list. A head file has only each category's first page, so there it's the
 * first page of them together: the 50 with most pp of those first pages, which are the whole list's 50 too.
 */
function mixedPlays(file: PlayerFile, cats: readonly Cat[]): Play[] {
  const list = cats.flatMap(cat => file.scores[cat].map(s => { playCat.set(s, cat); return s; }));
  const whole = !file.head || !file.counts || list.length >= cats.reduce((n, cat) => n + file.counts![cat], 0);
  return whole ? list : list.sort(SORTS.pp).slice(0, HEAD_ROWS);
}

export type ListSlug = 'all' | 'converts' | 'loved' | 'ranked' | 'dan' | 'pre';

/** A score list. `cats` marks one that mixes categories, whose rows say which each play is. */
export interface ListTab {
  slug: ListSlug;
  label(ctx: Ctx): string;
  cats?: readonly Cat[];
  list?(file: PlayerFile): readonly Play[];
}

export const TAB_LIST: readonly ListTab[] = [
  { slug: 'all', label: ctx => ctx.t('All|plays'), cats: CATS as Cat[] },
  { slug: 'converts', label: ctx => ctx.t('Converts'), list: f => f.scores.c },
  { slug: 'loved', label: ctx => ctx.t('Loved'), list: f => f.scores.u },
  // Ranked is what osu! gives pp for: ranked catch-specific maps and converts (every convert here is of a ranked map).
  { slug: 'ranked', label: ctx => ctx.t('Ranked'), cats: PLAY_SOURCES.r as Cat[] },
  { slug: 'dan', label: () => 'Dan' },
  { slug: 'pre', label: ctx => ctx.t('Pre-rank'), list: f => f.pre || [] },
];

/** Each list's length, by slug and by category: the head file's `counts`, or the whole file's lists. */
export function countsOf(file: PlayerFile): Record<string, number> {
  const counts: Record<string, number> = file.counts ? { ...file.counts } : {
    c: file.scores.c.length, u: file.scores.u.length, r: file.scores.r.length, dan: file.dan.length, pre: file.pre?.length ?? 0,
  };
  Object.assign(counts, { converts: counts.c, loved: counts.u });
  for (const item of TAB_LIST) if (item.cats) counts[item.slug] = item.cats.reduce((n, cat) => n + counts[cat], 0);
  return counts;
}

/** The list the address names, or the first with plays in it (not Dan or Pre-rank), or All. */
export const pickTab = (slug: string | undefined, counts: Record<string, number>): ListTab =>
  TAB_LIST.find(item => item.slug === slug) ?? TAB_LIST.find(item => !['dan', 'pre'].includes(item.slug) && counts[item.slug]) ?? TAB_LIST[0];

/** A list's plays as `file` has them: its first page from a head file, all of them from the whole one. */
export const listOf = (file: PlayerFile, tab: ListTab): readonly Play[] => (tab.cats ? mixedPlays(file, tab.cats) : tab.list?.(file) ?? []);

/**
 * Whether an address needs the whole player file: the small head file shows only the first page in the default order,
 * not a search, sort, filter or later page.
 */
export const needsAll = (query: Query): boolean => Boolean(query.q || query.firsts || (query.sort && query.sort !== 'pp') || Number(query.page) > 1);

export interface ListFilter {
  q: string;
  sort: SortKey;
  firsts: boolean;
}

/** The address's search, sort and "Only #1s" (which Pre-rank doesn't have), as the list's controls start. */
export const readFilter = (query: Query, tab: ListTab): ListFilter => ({
  q: query.q || '',
  sort: (SORT_KEYS as readonly string[]).includes(query.sort ?? '') ? query.sort as SortKey : 'pp',
  firsts: tab.slug !== 'pre' && Boolean(query.firsts),
});

/** What a search matches in a play: its map's title, difficulty and mapper, lowercase. */
export function playLabel(ctx: Ctx, file: PlayerFile, s: Play): string {
  const { title, sub } = mapText(ctx, s[S.MAP], file.maps[s[S.MAP]]);
  return `${title} ${sub}`.toLowerCase();
}

/**
 * The plays a list shows: searched, filtered and sorted. While only a head file is in (`partial`), its first page padded
 * with nulls to the list's real length, so the pager and the count are right from the start.
 */
export function shownPlays(all: readonly Play[], total: number, partial: boolean, filter: ListFilter, label: (s: Play) => string): (Play | null)[] {
  if (partial) return [...all, ...new Array<null>(total - all.length).fill(null)];
  const text = filter.q.trim().toLowerCase();
  return all
    .filter(s => (!text || label(s).includes(text)) && (!filter.firsts || s[S.POS] === 1))
    .sort(SORTS[filter.sort]);
}

/** The count line: "6,632 plays", or "12 of 6,632 plays". */
export const playsCount = (ctx: Ctx, shown: number, total: number): string => resultCount(ctx, shown, total, 'play');

/** One page of a list's plays; a page of nulls (past the head's first page) is placeholder rows until the whole file is in. */
export const playRows = (ctx: Ctx, file: PlayerFile, tab: ListTab, slice: readonly (Play | null)[]): Safe => (slice[0]
  ? html`<div class="rows">${(slice as Play[]).map(s => scoreRow(ctx, {
    s, meta: file.maps[s[S.MAP]], pos: tab.slug === 'pre' ? null : s[S.POS], cat: tab.cats ? playCat.get(s) : undefined,
  }))}</div>`
  : placeholderRows(slice.length));

/** What a search or "Only #1s" that matches nothing says, with the way back. */
export function noMatch(ctx: Ctx, q: string, firsts: boolean): Safe {
  const { t } = ctx;
  const query = q.trim();
  return emptyFiltered(ctx, query
    ? (firsts ? t('No play matches “{q}” among the #1s.', { q: query }) : t('No play matches “{q}”.', { q: query }))
    : t('No #1s in this list.'));
}

/** The list's page from the address (0-based). */
export const pageOf = (query: Query): number => Math.max(0, (Number(query.page) || 1) - 1);

/** The score lists' tabs: only lists with something in them get one (so they fit on a phone), plus whichever is open. */
export function listTabs(ctx: Ctx, id: number, counts: Record<string, number>, tab: ListTab): Safe {
  const shown = TAB_LIST.filter(item => counts[item.slug] || item === tab);
  return tabs(shown.map(item => ({
    href: `/player/${id}/${item.slug}`, label: item.label(ctx), count: ctx.fmt.num(counts[item.slug]), active: item === tab,
  })), ctx.t('Score lists'));
}

function danGrid(ctx: Ctx, file: PlayerFile): Safe {
  const { t, fmt } = ctx;
  const passes = new Map(file.dan.map(([i, s]) => [i, s]));
  return html`<div class="dan-ladder">${DAN_STAGES.map(stage => {
    const s = passes.get(stage.index);
    return html`<a class="dan-stage ${stage.index > 10 ? 'hebrew' : ''} ${s ? '' : 'locked'}" href="/map/${DAN_MAPS[stage.index]}">
      <span class="points">${stage.points} pts</span>
      <div class="dan-glyph">${stage.glyph}</div>
      <b>${danName(ctx, stage.index)}</b>
      <div class="small ${s ? 'dan-pass' : 'faint'}">${s ? `${fmt.acc(s[S.ACC])} · ${fmt.date(s[S.TIME])}` : t('Needs {acc}', { acc: `${fmt.num(stage.passAcc)}%` })}</div>
    </a>`;
  })}</div>`;
}

/**
 * The open list (`tab`): the Dan grid, or the toolbar, the count and the page of plays the address asks for. `file` is
 * the head or the whole file; a head file shows the first page in the default order (needsAll says when that's not
 * enough), and placeholders for the pages after it.
 */
export function listBody(ctx: Ctx, file: PlayerFile, name: string, counts: Record<string, number>, tab: ListTab, query: Query): Safe {
  const { t } = ctx;
  if (tab.slug === 'dan') return danGrid(ctx, file);
  const filter = readFilter(query, tab);
  const total = counts[tab.slug];
  let count = '';
  let scores: Safe;
  if (!total) {
    const cat = (SLUG_CAT as Record<string, Cat>)[tab.slug];
    scores = empty(tab.slug === 'pre' ? t('{name} has no plays from before their map was ranked yet.', { name })
      : tab.slug === 'all' ? t('{name} has no plays yet.', { name })
        : t('{name} has no plays in {category} yet.', { name, category: catLabel(ctx, cat) }));
  } else {
    const all = listOf(file, tab);
    const partial = all.length < total;
    const items = shownPlays(all, total, partial, filter, s => playLabel(ctx, file, s));
    count = playsCount(ctx, items.length, partial ? total : all.length);
    scores = paged(ctx, items, slice => playRows(ctx, file, tab, slice), { page: pageOf(query), empty: () => noMatch(ctx, filter.q, filter.firsts) });
  }
  return html`
    ${tab.slug === 'pre' ? html`<p class="muted small">${t('Plays set before their map was ranked. They’re kept for the record but count toward nothing: no pp, no leaderboard spot.')}</p>` : ''}
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="${t('Search maps…')}" aria-label="${t('Search these plays')}" value="${query.q || ''}">
      <select class="select" id="sort" aria-label="${t('Sort')}">${SORT_KEYS.map(k => html`<option value="${k}" ${k === query.sort ? raw('selected') : ''}>${sortLabel(ctx, k)}</option>`)}</select>
      ${tab.slug !== 'pre' ? html`<span class="checks"><label><input type="checkbox" id="firsts" ${query.firsts ? raw('checked') : ''}> ${t('Only #1s')}</label></span>` : ''}
    </div>
    <p class="result-count" id="count">${count}</p>
    <div id="scores">${scores}</div>`;
}

// ---- The pp chart ---------------------------------------------------------------------------------------------------

/** A line's points: [time, value]. */
type Points = [number, number | null][];
/** [time, converts, loved, official]: a day's totals. */
export type HistoryPoint = [number, number | null, number | null, number | null];

export interface HistoryLine {
  label: string;
  color: string;
  dashed: Points;
  solid: Points;
}

const historyLineSpecs = (ctx: Ctx): [string, string, 1 | 2 | 3][] =>
  [[ctx.t('Converts'), 'var(--cat-c)', 1], [ctx.t('Loved'), 'var(--cat-u)', 2], [ctx.t('Official'), 'var(--cat-r)', 3]];
const rebuiltTip = (ctx: Ctx) => ctx.t('Rebuilt month by month from the dates of this player’s stored scores. Only their best play on each map is kept, and past totals use today’s pp values, so the real numbers back then were different.');

/**
 * A player's points in history.json: `recorded`, one per day something changed since the site started tracking, at
 * noon UTC; `rebuilt`, monthly from score dates (`reconstructed`, as of 00:00 UTC), only for the time before the site's
 * own records begin. Older data has no `reconstructed`.
 */
export function historyPoints(history: History, id: number): { recorded: HistoryPoint[]; rebuilt: HistoryPoint[] } {
  const dayTime = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000;
  const recorded = (history.series[id] || []).map(([d, cv, ul, pp]): HistoryPoint => [dayTime(history.days[d]), cv, ul, pp]);
  const rebuiltDays = history.reconstructed?.days ?? [];
  const rebuilt = (history.reconstructed?.series?.[id] ?? [])
    .map(([d, cv, ul, pp]): HistoryPoint => [Date.parse(`${rebuiltDays[d]}T00:00:00Z`) / 1000, cv, ul, pp])
    .filter(p => Number.isFinite(p[0]) && (!recorded.length || p[0] < recorded[0][0]));
  return { recorded, rebuilt };
}

/** A range the chart offers: [key, label, from]. */
export type HistoryRange = [string, string, number];

/** The ranges the chart offers: everything, the last 12 months, or only the days the site recorded itself. */
export function historyRanges(ctx: Ctx, recorded: HistoryPoint[], rebuilt: HistoryPoint[]): HistoryRange[] {
  const all = [...rebuilt, ...recorded];
  if (all.length < 2) return [];
  const end = all[all.length - 1][0];
  const ranges: HistoryRange[] = [['all', ctx.t('All|time'), -Infinity]];
  if (end - all[0][0] > 400 * 86400) ranges.push(['year', ctx.t('Last 12 months'), end - 365 * 86400]);
  if (rebuilt.length && recorded.length >= 2) ranges.push(['tracked', ctx.t('Since tracking'), recorded[0][0]]);
  return ranges;
}

/** Only the points from `from` on, starting with the value the line had at `from` (so it begins at the left edge). */
function clipFrom(points: Points, from: number): Points {
  const before = points.filter(p => p[0] < from).at(-1);
  const rest = points.filter(p => p[0] >= from);
  return before ? [[from, before[1]], ...rest] : rest;
}

/**
 * The chart's three lines from `from` on. Any value can be null (no official pp for an inactive player): those points
 * are skipped, never drawn as 0. Each rebuilt line is dashed and holds its last value until its solid line starts (or
 * to the last recorded day if it never does); the two may not join exactly.
 */
export function historyLines(ctx: Ctx, recorded: HistoryPoint[], rebuilt: HistoryPoint[], from: number): HistoryLine[] {
  const lastDay = recorded[recorded.length - 1]?.[0];
  return historyLineSpecs(ctx).map(([label, color, k]) => {
    const pick = (list: HistoryPoint[]): Points => list.filter(p => p[k] != null).map(p => [p[0], p[k]]);
    const solid = pick(recorded);
    const dashed = pick(rebuilt);
    const until = solid[0]?.[0] ?? lastDay;
    if (dashed.length && until > dashed[dashed.length - 1][0]) dashed.push([until, dashed[dashed.length - 1][1]]);
    const clipped = clipFrom(dashed, from);
    // A dashed line needs some length: from where its solid line starts, all that's left of it is that one point.
    return { label, color, dashed: clipped.length > 1 && clipped[clipped.length - 1][0] > clipped[0][0] ? clipped : [], solid: clipFrom(solid, from) };
  });
}

export function historyChart(ctx: Ctx, lines: HistoryLine[]): Safe {
  const { t, fmt } = ctx;
  const shown = lines.flatMap(l => [...l.dashed, ...l.solid]);
  if (shown.length < 2) return html`<p class="muted small">${t('Not enough points in this range.')}</p>`;
  const span = shown.map(p => p[0]);
  const names = historyLineSpecs(ctx);
  const summary = t('pp over time, {from} to {to}: {lines}.', {
    from: fmt.date(Math.min(...span)),
    to: fmt.date(Math.max(...span)),
    lines: lines.map(l => [...l.dashed, ...l.solid])
      .map((pts, i) => pts.length && t('{line} {from} to {to}', { line: names[i][0], from: fmt.num(pts[0][1]), to: fmt.num(pts[pts.length - 1][1]) }))
      .filter(Boolean).join(', '),
  });
  const anyDashed = lines.some(l => l.dashed.length);
  const tip = rebuiltTip(ctx);
  return html`${lineChart(ctx, lines.flatMap(l => [
    { label: t('{line} (reconstructed)', { line: l.label }), color: l.color, points: l.dashed, dashed: true, step: true },
    { label: l.label, color: l.color, points: l.solid },
  ]), { format: v => fmt.num(v), label: anyDashed ? `${summary} ${t('Dashed parts are reconstructed from score dates and approximate.')}` : summary })}
    <div class="legend">${lines.filter(l => l.dashed.length || l.solid.length).map(l => html`<span><i style="background:${l.color}"></i>${l.label}</span>`)}
      ${anyDashed ? html`<span class="legend-dashed" title="${tip}"><i aria-hidden="true"></i>${t('dashed = reconstructed from score dates (approximate)')}<span class="sr-only">. ${tip}</span></span>` : ''}</div>`;
}

/** The value a line has at `time`: its last point at or before it. */
const valueAt = (points: Points, time: number) => {
  let value: number | null = null;
  for (const p of points) { if (p[0] > time) break; value = p[1]; }
  return value;
};

/** A row of the chart's hover readout (client/chart-hover.ts). */
export interface HistoryReadout {
  t: number;
  title: string;
  items: { name: string; color: string; value: number; approx: boolean }[];
}

/**
 * What the hover readout steps through: every time any line has a point, with each line's value then (from the solid
 * line once it has started, otherwise the dashed one, marked approximate). Rows where everything is approximate are
 * monthly reconstructions, so they're dated by month.
 */
export function historyRows(ctx: Ctx, lines: HistoryLine[]): HistoryReadout[] {
  const times = [...new Set(lines.flatMap(l => [...l.dashed, ...l.solid].map(p => p[0])))].sort((a, b) => a - b);
  return times.map(time => {
    const items = lines.map(l => {
      const exact = l.solid.length > 0 && time >= l.solid[0][0];
      return { name: l.label, color: l.color, value: valueAt(exact ? l.solid : l.dashed, time), approx: !exact };
    }).filter((item): item is HistoryReadout['items'][number] => item.value != null);
    return { t: time, title: items.every(item => item.approx) ? ctx.fmt.monthYear(time) : ctx.fmt.date(time), items };
  }).filter(row => row.items.length);
}

/**
 * Collapsed unless the visitor left it open (the choice is remembered); the chart is drawn once it's opened. With
 * history.json in (`history`), as the old page drew it: the range chips, the chart if open, and nothing for a player
 * with too few points. Without it, the section alone: the chips and chart come with history.json, when it's opened.
 */
function historySection(ctx: Ctx, history: History | null, id: number, open: boolean): Safe | '' {
  const { t } = ctx;
  const summary = html`<summary><h2 class="card-h">${t('pp over time')}</h2><span class="history-toggle" aria-hidden="true"></span></summary>`;
  if (!history) {
    return html`<details class="section card history" id="history" ${open ? raw('open') : ''}>
    ${summary}
    <div class="history-body">
      <div class="chart-wrap" id="history-chart"></div>
    </div>
  </details>`;
  }
  const { recorded, rebuilt } = historyPoints(history, id);
  const ranges = historyRanges(ctx, recorded, rebuilt);
  if (!ranges.length) return '';
  return html`<details class="section card history" id="history" ${open ? raw('open') : ''}>
    ${summary}
    <div class="history-body">
      ${ranges.length > 1 ? historyChips(ctx, ranges) : ''}
      <div class="chart-wrap" id="history-chart">${open ? historyChart(ctx, historyLines(ctx, recorded, rebuilt, ranges[0][2])) : ''}</div>
    </div>
  </details>`;
}

export const historyChips = (ctx: Ctx, ranges: HistoryRange[]): Safe => chipGroup(ctx.t('Range'), 'range', ranges.map(([key, label]) => [key, label]), 'all');

// ---- The head ---------------------------------------------------------------------------------------------------------

/**
 * A pp tile that leads with the rank: the rank big ("#5 PT") and the pp under it, before `sub` if there is one. With
 * no rank (unranked, or no official rank) the pp stays the big figure and `noRank` says why. The rank links to its
 * leaderboard (`board`, a slug of the Leaderboards page), which scrolls to and marks this player's row (`at`).
 */
function rankStat(ctx: Ctx, label: string, rank: number, where: string, pp: number,
  { sub = '', noRank, cls, board, id }: { sub?: string; noRank?: string; cls: string; board: string; id: number }): Safe {
  const { t, fmt } = ctx;
  const ppText = `${fmt.pp(pp)} pp`;
  const boardName = t('{board} leaderboard', { board: board === 'ranked' ? t('Ranked') : label }); // as the Leaderboards page names it
  return rank
    ? stat(label, html`<a class="stat-link" href="/rankings/${board}?at=${id}" aria-label="${boardName}, ${fmt.rank(rank)} ${where}" title="${t('See the {board}', { board: boardName })}">${fmt.rank(rank)} <span class="stat-unit">${where}</span></a>`, sub ? html`<span class="keep">${ppText}</span> · <span class="keep">${sub}</span>` : ppText, cls)
    : stat(label, ppText, noRank, cls);
}

/** Two arrows facing each other: "compare". */
const COMPARE_ICON = raw('<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5h10M9 2l3 3-3 3M14 11H4M7 8l-3 3 3 3"/></svg>');

/**
 * The in-joke badges, folded into one small "6 badges" button beside the others: hovering or keyboard focus opens a
 * card with each badge and what earned it; on touch a tap toggles it (player.mount.ts, with Escape and an outside
 * click to close).
 */
const badgePeek = (ctx: Ctx, badges: Badge[]): Safe => html`<span class="peek">
  <button type="button" class="peek-btn" aria-expanded="false" aria-controls="badge-pop">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>
    ${ctx.fmt.plural(badges.length, 'badge')}
  </button>
  <span class="peek-pop" id="badge-pop" role="group" aria-label="${ctx.t('Badges')}">
    <ul class="badge-list">${badges.map(b => html`<li><b>${b.name}</b><span>${b.tip}</span></li>`)}</ul>
  </span>
</span>`;

function profileHead(ctx: Ctx, data: Data, state: State, badges: Badge[]): Safe {
  const { t, tn, fmt } = ctx;
  const { id, row } = data;
  const players = data.core.players;
  const name = players.name.at(row);
  const wallet = data.economy?.players?.[id] ?? null;
  const extras = data.file.extras;
  const playerEra = localEra(ctx, extras ? extras.era : era(ctx, data.file));
  const role = danRole(players.danScore[row]);
  const firsts = players.firstsC[row] + players.firstsU[row] + players.firstsR[row];
  const last = players.last[row];
  const onOsu = t('{name} on osu!', { name });
  return html`<header class="profile-head">
      <a class="avatar-link" href="${osuUser(id)}" target="_blank" rel="noopener" aria-label="${onOsu}" title="${onOsu}">${avatar(ctx, players, row, 'avatar-lg')}</a>
      <div class="profile-info">
        <h1><a class="title-link ${nameClass(ctx, players, row)}" href="${osuUser(id)}" target="_blank" rel="noopener" title="${onOsu}">${name}</a>${isLegend(ctx, players, row) ? legendTag(ctx) : ''}</h1>
        <p class="profile-line">${[
          role && html`<span class="profile-role">${role}</span>`,
          firsts && tn(firsts, '{n} #1 in Portugal', '{n} #1s in Portugal'),
          last && t('last played {ago}', { ago: fmt.ago(last) }),
          playerEra && t('era: {era}', { era: playerEra }),
          wallet?.t && html`<span class="profile-title">${wallet.t}</span>`,
          // Bananas waiting in the pouch and nobody signed in here: if it's theirs, the way to collect them, up top.
          wallet && !wallet.s && wallet.p > 0 && !ctx.me && state.signInHere
            && html`<button class="link-button" type="button" data-signin>${t('Is this you? Sign in to collect {n}', { n: bananas(ctx, wallet.p) })}</button>`,
        ].filter(Boolean).map((part, i) => html`${i ? html`<span class="sep-dot" aria-hidden="true"> · </span>` : ''}${part}`)}</p>
        <div class="links">
          <a class="btn btn-small btn-icon" href="/compare/${id}" aria-label="${t('Compare {name} with another player', { name })}" title="${t('Compare with another player')}">${COMPARE_ICON}</a>
          ${badges.length ? badgePeek(ctx, badges) : ''}
        </div>
      </div>
      ${jersey(ctx, players, row)}
    </header>`;
}

function stats(ctx: Ctx, players: Players, row: number, id: number): Safe {
  const { t, fmt } = ctx;
  const pp = players.pp[row] / 100;
  const global = players.global[row], country = players.country[row];
  return html`<div class="stats">
      ${rankStat(ctx, t('Converts'), players.rankC[row], 'PT', players.cv[row] / 100, { noRank: t('Unranked'), cls: 'stat-c', board: 'converts', id })}
      ${rankStat(ctx, t('Loved & Unranked'), players.rankU[row], 'PT', players.ul[row] / 100, { noRank: t('Unranked'), cls: 'stat-u', board: 'loved', id })}
      ${!isInactiveOnOsu(players, row)
        // osu!'s own country rank leads, like the two tiles before it; the global rank goes under the pp.
        ? country
          ? rankStat(ctx, t('Official pp'), country, 'PT', pp, { sub: global ? `${fmt.rank(global)} global` : '', cls: 'stat-r', board: 'ranked', id })
          : rankStat(ctx, t('Official pp'), global, 'global', pp, { noRank: t('No official rank'), cls: 'stat-r', board: 'ranked', id })
        : pp > 0
          ? stat(t('Official pp'), players.ppSource[row] === 3
            // "(estimated)" is only for screen readers here: the subtitle already says it, and the value stays one line.
            ? html`<span title="${t('Estimated from their stored plays, so probably a little low')}"><span aria-hidden="true">≈ </span>${fmt.pp(pp)} pp</span><span class="sr-only"> (${t('estimated')})</span>`
            : html`${fmt.pp(pp)} pp`,
            html`${inactiveTag(ctx, players, row)} ${officialPpNote(ctx, players, row)}`, 'stat-r')
          // Inactive with nothing to go on (no last-known value, no plays to estimate from).
          : stat(t('Official pp'), '—', html`${inactiveTag(ctx, players, row)} ${t('no official pp known')}`, 'stat-r')}
      ${stat(t('Accuracy'), fmt.acc(players.acc[row] / 100), t('Level {level}', { level: fmt.num(players.level[row] / 100, 0) }))}
      ${stat(t('Play count'), fmt.num(players.plays[row]), html`<span class="grade-counts">${(['X', 'S', 'A'] as const).map((g, i) => html`<span>${gradeBadge(g)}${fmt.num([players.ss, players.s, players.a][i][row])}</span>`)}</span>`)}
      ${stat(t('Dan points'), fmt.num(players.danScore[row]), t('{done} of {total} stages', { done: fmt.num(danPasses(players, row)), total: fmt.num(DAN_STAGES.length) }))}
    </div>`;
}

// ---- Sections ---------------------------------------------------------------------------------------------------------

/**
 * The signature play the player pinned with bananas (`pinned`: [category, ...play]) as one score row and a link to it
 * on osu!. It takes the place of the automatic "Signature map".
 */
function pinnedPlay(ctx: Ctx, [cat, ...rest]: [Cat, ...unknown[]], maps: Record<string, MapMeta>): Safe {
  const { t } = ctx;
  const s = rest as Play;
  const url = scoreUrl(s) ?? osuMap(s[S.MAP]);
  return html`<section class="section card signature pinned-play">
    <h2 class="card-h">${t('Signature play')}</h2>
    <div class="rows">${scoreRow(ctx, { s, meta: maps[s[S.MAP]], pos: s[S.POS], cat })}</div>
    <p class="small m-0"><a href="${url}" target="_blank" rel="noopener">${scoreUrl(s) ? t('See the play on osu!') : t('See the map on osu!')}</a></p>
  </section>`;
}

function signatureSection(ctx: Ctx, signature: Signature): Safe {
  const { t, fmt } = ctx;
  return html`<section class="section card signature">
      <h2 class="card-h">${t('Signature map')} <span class="faint">· ${t(signature.kind)}</span></h2>
      ${mapLink(ctx, signature.s[S.MAP], signature.meta)}
      <div class="mt-2 score-line">${catChip(ctx, signature.cat)} ${scoreStats(ctx, signature.s)} <span>${fmt.pp(signature.s[S.PP])} pp</span> <span class="faint">${fmt.date(signature.s[S.TIME])}</span></div>
    </section>`;
}

/**
 * Trophies: what the player has won in the challenges. King of the hill's titles (gold once settled) and Bounty hunter
 * as chips, then their crowns by slot, the slots they hold this month and the bounties they claimed. Nothing for a
 * player with none of it. `claims` are their claimed rows of bounties.json's hall, newest first, with its `maps`.
 */
function trophies(ctx: Ctx, crowns: PlayerFile['crowns'], claims: NonNullable<Bounties['hall']>, maps: Record<string, MapMeta>): Safe | '' {
  const { t, th, fmt } = ctx;
  const titles = crowns?.titles ?? [];
  const holding = [...(crowns?.holding ?? [])].sort((a, b) => HILL_SLOTS.indexOf(a[0]) - HILL_SLOTS.indexOf(b[0]) || HILL_TIERS.indexOf(a[1]) - HILL_TIERS.indexOf(b[1]));
  if (!crowns?.total && !holding.length && !claims.length) return '';
  return html`<section class="section card trophies">
    <h2 class="card-h">${t('Trophies')}</h2>
    ${titles.length || claims.length ? html`<ul class="trophy-chips" aria-label="${t('Titles')}">
      ${titles.map(title => html`<li class="badge ${title.final ? 'badge-gold' : ''}">${titleName(ctx, title)} <span class="trophy-when">· ${titleWhen(ctx, title)}</span></li>`)}
      ${claims.length ? html`<li class="badge badge-gold">${t('Bounty hunter')} <span class="trophy-when">· ${fmt.plural(claims.length, 'bounty', 'bounties')}</span></li>` : ''}
    </ul>` : ''}
    ${crowns?.total ? html`<p class="small muted">${t('{crowns} on King of the hill: {tally}', { crowns: fmt.plural(crowns.total, 'crown'), tally: slotTally(ctx, crowns.slots) })}</p>` : ''}
    ${holding.length ? html`<p class="small muted">${t('Holding this month: {slots}.', { slots: holding.map(([slot, tier]) => `${slotName(ctx, slot)} (${tierName(ctx, tier)})`).join(', ') })}
      <a href="/challenges/hill">${t('See the pool')}</a></p>` : ''}
    ${claims.slice(0, CLAIMS_SHOWN).map(([map, , goal, , , at]) => html`<p class="small muted">${th('Bounty claimed: {goal} on {map}', {
      goal: goalLabel(ctx, goal), map: html`<a href="/map/${map}">${mapLabel(ctx, map, maps[map])}</a>`,
    })}${at ? html` <span class="faint">· ${fmt.date(at)}</span>` : ''}</p>`)}
    ${claims.length > CLAIMS_SHOWN ? html`<p class="small"><a href="/challenges/bounties">${t('{n} more in the hall of fame', { n: fmt.num(claims.length - CLAIMS_SHOWN) })}</a></p>` : ''}
  </section>`;
}

/** How many duels the profile lists before the rest fold away. */
const DUELS_SHOWN = 5;

/**
 * Duels: the player's rating, place on the ladder and record, their latest duels (each linking to its page) and who
 * they've played most. Nothing for a player with no duels. `duels` is the file's slice: `rating` is null until their
 * first ranked duel.
 */
function duelSection(ctx: Ctx, duels: PlayerFile['duels'], players: Players): Safe | '' {
  if (!duels?.recent.length) return '';
  const { t, th, fmt } = ctx;
  const { rating: r, recent, h2h } = duels;
  // A duel's result from this player's side: won, lost, or abandoned (counted for nobody).
  const result = { w: t('Won'), l: t('Lost'), x: t('Abandoned') };
  const name = (id: number) => html`<span class="${duelistClass(ctx, players, id)}">${playerName(players, id)}</span>`;
  const row = (d: ProfileDuel) => html`<a class="row card-link duel-mine ${d.res === 'x' ? 'duel-muted' : ''}" href="/duel/${d.id}">
    <span class="duel-mine-vs"><span class="duel-result duel-result-${d.res}">${result[d.res]}</span>
      ${th('vs {name}', { name: name(d.opp) })} <b>${fmt.num(d.s[0])}–${fmt.num(d.s[1])}</b>${d.ff ? html` <span class="faint">· ${t('Forfeit')}</span>` : ''}</span>
    <span class="row-meta">${d.d !== undefined ? html`<span title="${t('Rating change')}">${deltaText(ctx, d.d)}</span><span class="sep"></span>`
      : !d.ranked ? html`<span>${t('Unranked|duel')}</span><span class="sep"></span>` : ''}<span class="faint" title="${fmt.dateTime(d.t)}">${fmt.ago(d.t)}</span></span>
  </a>`;
  const standing = r && [
    html`<span><b class="duel-big">${fmt.num(r.r)}</b> ${t('rating')}</span>`,
    r.prov ? provisionalTag(ctx) : r.rank && html`<a href="/challenges/duels">${t('{rank} on the ladder', { rank: fmt.rank(r.rank) })}</a>`,
    recordWords(ctx, r.w, r.l),
    r.peak > r.r && t('peak {rating}', { rating: fmt.num(r.peak) }),
    streakWords(ctx, r.streak),
  ].filter(Boolean);
  return html`<section class="section card duels-card">
    <h2 class="card-h">${t('Duels')} ${experimentalTag(ctx)}</h2>
    ${standing ? html`<p class="duel-standing">${standing.map((part, i) => html`${i ? html`<span class="sep-dot" aria-hidden="true"> · </span>` : ''}${part}`)}</p>`
      : html`<p class="small muted">${t('No ranked duels yet, so no rating.')}</p>`}
    <div class="rows">${recent.slice(0, DUELS_SHOWN).map(row)}</div>
    ${recent.length > DUELS_SHOWN ? html`<details class="duel-more"><summary>${t('Show {n} more', { n: fmt.num(recent.length - DUELS_SHOWN) })}</summary>
      <div class="rows">${recent.slice(DUELS_SHOWN).map(row)}</div></details>` : ''}
    ${h2h.length ? html`<p class="small muted mt-2">${th('Most played: {list}', {
      list: html`${h2h.slice(0, 3).map(([opp, w, l], i) => html`${i ? ', ' : ''}<a href="/player/${opp}">${name(opp)}</a> ${fmt.num(w)}–${fmt.num(l)}`)}`,
    })}</p>` : ''}
  </section>`;
}

/**
 * Bananas: the player's wallet (economy.json) with its latest lines (the file's `ledger`), or their pouch while they've
 * never signed in. Their own profile, signed in, adds their requests and the snipe shield; someone else's, a tip form
 * with the shop's two steps. Nothing before the bot starts Bananas, or for a player it has no wallet for.
 */
function bananaSection(ctx: Ctx, id: number, name: string, w: Wallet | null, ledger: PlayerFile['ledger'], state: State): Safe | '' {
  if (!w) return '';
  const { t, th, fmt } = ctx;
  const me = ctx.me;
  const own = me === id;
  // Signed out, it could be theirs: the way to collect. Signed in as someone else, it isn't.
  const mayBeThem = !me && state.signInHere;
  const head = html`<h2 class="card-h">${t('Bananas')} <a class="card-h-link" href="/glossary?at=bananas">${t('What are bananas?')}</a></h2>`;
  if (!w.s) {
    return html`<section class="section card bananas" id="bananas">${head}
      ${w.p > 0 ? html`
        <p class="pouch">${own ? th('Your {n} are on their way to your wallet', { n: html`<b>${bananas(ctx, w.p)}</b>` })
          : th('{n} waiting in {name}’s pouch', { n: html`<b>${bananas(ctx, w.p)}</b>`, name })}</p>
        <p class="small muted">${own
          ? t('You’ve signed in: the bot moves them into your wallet at its next update, within 15 minutes.')
          : t('Bananas earned before signing in on this site wait in a pouch. The first sign-in with osu! collects them. The pouch holds {cap} at most; anything past that is lost.', { cap: bananas(ctx, RULES.pouchCap) })}</p>
        ${mayBeThem ? html`<div class="btn-row">${signInButton(ctx, state.signInHere, t('Is this you? Sign in to collect'))}</div>` : ''}`
        : html`<p class="small muted">${t('No bananas yet. They’re earned by playing: snipes, first FCs on hard maps, crowns, the daily game and more.')}</p>`}
      ${ledgerList(ctx, ledger)}
    </section>`;
  }
  const gateLeft = RULES.gate - w.e;
  return html`<section class="section card bananas" id="bananas">${head}
    <dl class="kv kv-strip">
      <div><dt>${t('Wallet')}</dt><dd>${bananas(ctx, w.b)}</dd></div>
      <div><dt>${t('Earned')}</dt><dd>${bananas(ctx, w.e)}</dd></div>
      ${w.x ? html`<div><dt>${t('In open bounties')}</dt><dd>${bananas(ctx, w.x)}</dd></div>` : ''}
    </dl>
    <p class="small muted">${gateLeft > 0
      ? t('{n} more earned to post a bounty (it takes {gate} earned; tips, refunds and the launch grant don’t count).', { n: fmt.num(gateLeft), gate: fmt.num(RULES.gate) })
      : t('Past the {gate} earned that posting a bounty takes.', { gate: fmt.num(RULES.gate) })}${w.sh ? ` ${t('Snipe shield on: snipe bounties can’t target them.')}` : ''}</p>
    ${ledgerList(ctx, ledger)}
    ${own ? html`<div class="wallet-own">
      <div class="btn-row">
        <a class="btn btn-small" href="/shop">${t('Shop')}</a>
        <a class="btn btn-small" href="/challenges/bounties">${t('Bounties')}</a>
        <button class="btn btn-small" type="button" id="shield" aria-pressed="${w.sh ? 'true' : 'false'}" aria-describedby="shield-note">${t('Snipe shield')}</button>
      </div>
      <p class="small faint" id="shield-note" aria-live="polite">${t('The shield keeps snipe bounties from targeting your #1s. Changing it goes through the bot.')}</p>
      <div id="my-requests"></div>
    </div>` : me ? html`<div class="tip-box" id="tip-box">
      <form class="tip-form" id="tip" novalidate>
        <div class="field"><label for="tip-amount">${t('Tip {name}', { name })}</label>
          <input class="input" id="tip-amount" type="number" inputmode="numeric" min="${RULES.tipMin}" max="${RULES.tipMax}" step="1" value="10"></div>
        <div class="field"><label for="tip-reason">${t('Why (optional)')}</label>
          <input class="input" id="tip-reason" maxlength="80" placeholder="${t('that FC, the crown…')}"></div>
        <button class="btn btn-small" type="submit">${t('Tip…')}</button>
        <p class="small muted tip-note" aria-live="polite"></p>
        <p class="small faint">${t('{min} to {max} a day. A tip goes from your wallet to theirs; it doesn’t count towards their 1,000 earned.', { min: fmt.num(RULES.tipMin), max: bananas(ctx, RULES.tipMax) })}</p>
      </form>
    </div>` : ''}
  </section>`;
}

/** The tip form's confirmation: the amount, the reason, and the wallet before and after. */
export function tipConfirm(ctx: Ctx, name: string, amount: number, reason: string | null, free: number): Safe {
  const { t, th } = ctx;
  return html`<div class="tip-confirm">
      <p>${th('Tip {name} {amount}?', { name: html`<b>${name}</b>`, amount: html`<b>${bananas(ctx, amount)}</b>` })}${reason ? html` <span class="muted">“${reason}”</span>` : ''}</p>
      <p class="small muted">${t('Your wallet goes from {balance} to {after}.', { balance: bananas(ctx, free), after: bananas(ctx, free - amount) })}</p>
      <div class="btn-row">
        <button class="btn btn-small btn-primary" type="button" data-confirm>${t('Confirm')}</button>
        <button class="btn btn-small" type="button" data-cancel>${t('Cancel')}</button>
      </div>
      <p class="small tip-error" aria-live="polite"></p>
    </div>`;
}

// ---- The page ---------------------------------------------------------------------------------------------------------

/** The badges, era and signature map: worked out by the exporter (a head file's `extras`), or here from the whole file. */
export function badgesOf(ctx: Ctx, data: Data): Badge[] {
  const extras = data.file.extras;
  return (extras ? extras.badges : playerBadges(ctx, data.core.players, data.row, data.file, data.records)).map(b => localBadge(ctx, b));
}

export function render(ctx: Ctx, data: Data, state: State): Safe {
  const { t, th } = ctx;
  const { id, row, file } = data;
  const players = data.core.players;
  const name = players.name.at(row);
  const wallet = data.economy?.players?.[id] ?? null;
  const signature = file.extras ? file.extras.signature : signatureMap(file);
  const counts = countsOf(file);
  const tab = pickTab(state.tab, counts);
  const claims = (data.bounties?.hall ?? []).filter(r => r[4] === id && r[3] === 'claimed');

  return html`
    ${profileHead(ctx, data, state, badgesOf(ctx, data))}

    ${stats(ctx, players, row, id)}

    ${id === THRONE_PLAYER ? html`<p class="mt-4 notice">${th('Every #1 on this profile is up for grabs. {link}', { link: html`<a href="/records?at=throne">${t('Dethrone Tris')}</a>` })}</p>` : ''}

    ${file.pinned ? pinnedPlay(ctx, file.pinned, file.maps) : signature ? signatureSection(ctx, signature) : ''}

    ${trophies(ctx, file.crowns, claims, data.bounties?.maps ?? {})}

    ${duelSection(ctx, file.duels, players)}

    ${bananaSection(ctx, id, name, wallet, file.ledger, state)}

    ${historySection(ctx, data.history, id, state.chartOpen)}

    <section class="section" id="plays">
      <h2 class="sr-only">${t('Plays')}</h2>
      <div id="play-tabs">${listTabs(ctx, id, counts, tab)}</div>
      <div id="play-list">${listBody(ctx, file, name, counts, tab, state.query)}</div>
    </section>
  `;
}
