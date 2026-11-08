// The players a Top 10 ballot picks from (§3.1): every PT player in the core pack, with what their year looks like from
// data every page already has. The core pack gives the PT rank, the last play, the Dan stages and the #1s held;
// history.json (every player's totals, small) gives the official pp on 1 January, so the cards can say "+3,100 pp" and
// how far they climbed. The player packs would say more (scores set this year, first FCs), but they're 13 MB for
// everyone: the dossier (§4.2) reads one when it's opened.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import type { History } from '../views/player.ts';
import { avatar, isInactive, isLegend, nameClass } from './players.ts';
import { danName } from './events.ts';

export interface Candidate {
  row: number;
  id: number;
  name: string;
  /** A play stored in the season's year. */
  active: boolean;
  /** Official pp now and on 1 January (null: history doesn't go back that far). */
  pp: number;
  ppJan: number | null;
  /** PT rank on the official board now and on 1 January (0: not ranked). */
  rank: number;
  rankJan: number;
  /** The highest Dan stage passed, or -1. */
  dan: number;
  firsts: number;
  last: number;
  /** Career (§13.11, from history.json): peak official pp, best PT rank ever (0: unknown), the first year with pp. */
  peak: number;
  best: number;
  since: number | null;
  /** A former PT top 5 player, now inactive (core/legends.js), and inactive at all. */
  legend: boolean;
  inactive: boolean;
}

/**
 * Each player's career from history.json: the peak official pp, the best PT rank on the official board at any point the
 * history has (everyone ranked by their pp then; months rebuilt from score dates before the site's own records, which
 * use today's pp values, so it's approximate), and the first year they had pp.
 */
export function careerOf(history: History | null): Map<number, { peak: number; best: number; since: number | null }> {
  const out = new Map<number, { peak: number; best: number; since: number | null }>();
  if (!history) return out;
  const series = new Map<number, [number, number][]>(); // id → [time, pp], in time order
  const add = (days: readonly string[], rows: Record<string, History['series'][string]> | undefined, hour: string) => {
    for (const [id, list] of Object.entries(rows ?? {})) {
      const points = series.get(Number(id)) ?? [];
      for (const [d, , , pp] of list) {
        const time = Date.parse(`${days[d]}T${hour}Z`) / 1000;
        if (Number.isFinite(time) && pp !== null) points.push([time, pp]);
      }
      series.set(Number(id), points);
    }
  };
  add(history.reconstructed?.days ?? [], history.reconstructed?.series, '00:00:00');
  add(history.days, history.series, '12:00:00');
  const times = new Set<number>();
  for (const points of series.values()) { points.sort((a, b) => a[0] - b[0]); for (const [time] of points) times.add(time); }
  const at = new Map<number, number>(); // id → index of the latest point at or before the time
  for (const [id, points] of series) {
    const pos = points.findIndex(p => p[1] > 0);
    out.set(id, { peak: Math.max(0, ...points.map(p => p[1])), best: 0, since: pos < 0 ? null : new Date(points[pos][0] * 1000).getUTCFullYear() });
  }
  for (const time of [...times].sort((a, b) => a - b)) {
    const now: [number, number][] = [];
    for (const [id, points] of series) {
      let i = at.get(id) ?? -1;
      while (i + 1 < points.length && points[i + 1][0] <= time) i++;
      at.set(id, i);
      if (i >= 0 && points[i][1] > 0) now.push([id, points[i][1]]);
    }
    now.sort((a, b) => b[1] - a[1]).forEach(([id], i) => {
      const c = out.get(id)!;
      if (!c.best || i + 1 < c.best) c.best = i + 1;
    });
  }
  return out;
}

/** Midnight on 1 January in Lisbon (UTC+0 in winter), unix seconds. */
export const yearStart = (year: number): number => Date.UTC(year, 0, 1) / 1000;

/** A player's official pp at `at` from history.json (rebuilt months before the site's records, then the days). */
export function ppAt(history: History, id: number, at: number): number | null {
  let value: number | null = null;
  let seen = false;
  const take = (days: readonly string[], rows: History['series'][string] | undefined, hour: string) => {
    for (const [d, , , pp] of rows ?? []) {
      const time = Date.parse(`${days[d]}T${hour}Z`) / 1000;
      if (!Number.isFinite(time)) continue;
      if (time <= at) { if (pp !== null) value = pp; seen = true; }
    }
  };
  take(history.reconstructed?.days ?? [], history.reconstructed?.series?.[id], '00:00:00');
  take(history.days, history.series[id], '12:00:00');
  // No point before the date but a series after it: the player had nothing yet.
  if (!seen && (history.series[id]?.length || history.reconstructed?.series?.[id]?.length)) return 0;
  return value;
}

/** Every PT player, with their year so far: those active this year first, the most pp gained first, then by last play. */
export function candidatesOf(core: CorePack, history: History | null, year: number, now = Date.now() / 1000): Candidate[] {
  const p = core.players;
  const from = yearStart(year);
  const career = careerOf(history);
  const at = { now: () => now } as Ctx;
  const rankOf = new Map<number, number>();
  for (let i = 0; i < core.boardR.rows; i++) rankOf.set(core.boardR.row[i], i + 1);
  const list: Candidate[] = [];
  for (let row = 0; row < p.rows; row++) {
    const id = p.id[row];
    let dan = -1;
    for (let bit = 31; bit >= 0; bit--) if (p.dan[row] & (1 << bit)) { dan = bit; break; }
    list.push({
      row, id, name: p.name.at(row), active: p.last[row] >= from, pp: p.pp[row] / 100,
      ppJan: history ? ppAt(history, id, from) : null, rank: rankOf.get(row) ?? 0, rankJan: 0, dan,
      firsts: p.firstsC[row] + p.firstsU[row] + p.firstsR[row], last: p.last[row],
      peak: Math.max(p.pp[row] / 100, career.get(id)?.peak ?? 0), best: career.get(id)?.best ?? 0, since: career.get(id)?.since ?? null,
      legend: isLegend(at, p, row), inactive: isInactive(at, p, row),
    });
    // The board now counts as a point in the career too.
    const c = list[list.length - 1];
    if (c.rank && (!c.best || c.rank < c.best)) c.best = c.rank;
  }
  // The PT rank on 1 January: the same board, by the pp then.
  const jan = list.filter(c => c.ppJan !== null && c.ppJan > 0 && c.rank > 0).sort((a, b) => b.ppJan! - a.ppJan!);
  jan.forEach((c, i) => { c.rankJan = i + 1; });
  const gain = (c: Candidate) => (c.ppJan === null ? 0 : c.pp - c.ppJan);
  return list.sort((a, b) => Number(b.active) - Number(a.active) || gain(b) - gain(a) || b.last - a.last);
}

/** The all-time order (§13.11): best PT rank ever first (unknown last), then peak pp, then pp now. */
export const byCareer = (list: readonly Candidate[]): Candidate[] =>
  [...list].sort((a, b) => (a.best || 1e9) - (b.best || 1e9) || b.peak - a.peak || b.pp - a.pp);

/** "Best: PT #1 · peak 9,862 pp", for an all-time card. */
export function careerLine(ctx: Ctx, c: Candidate): string {
  const { t, fmt } = ctx;
  const parts = [c.best ? t('Best: PT #{n}', { n: fmt.num(c.best) }) : '', c.peak ? t('peak {pp} pp', { pp: fmt.num(Math.round(c.peak)) }) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('Not ranked');
}

/** An all-time card's chips: legend, since when, the Dan, the #1s held. */
export function careerHighlights(ctx: Ctx, c: Candidate): string[] {
  const { t, fmt } = ctx;
  return [
    c.legend ? t('legend') : '',
    c.since ? t('since {year}', { year: c.since }) : '',
    c.dan >= 0 ? danName(ctx, c.dan) : '',
    c.firsts ? t('{n} PT #1s', { n: fmt.num(c.firsts) }) : '',
  ].filter(Boolean).slice(0, 3);
}

/** "PT #4 · ▲3 since January", or what's known of it. */
export function rankLine(ctx: Ctx, c: Candidate): string {
  const { t, fmt } = ctx;
  if (!c.rank) return t('Not ranked');
  const moved = c.rankJan ? c.rankJan - c.rank : 0;
  const since = moved > 0 ? ` · ▲${fmt.num(moved)}` : moved < 0 ? ` · ▼${fmt.num(-moved)}` : '';
  return `${t('PT #{n}', { n: fmt.num(c.rank) })}${since}${since ? ` ${t('since January')}` : ''}`;
}

/** Two or three of the player's highlights of the year, as short chips. */
export function highlights(ctx: Ctx, c: Candidate, year: number): string[] {
  const { t, fmt } = ctx;
  const out: string[] = [];
  const gain = c.ppJan === null ? 0 : Math.round(c.pp - c.ppJan);
  if (gain >= 1) out.push(t('+{pp} pp in {year}', { pp: fmt.num(gain), year }));
  if (c.dan >= 0) out.push(danName(ctx, c.dan));
  if (c.firsts) out.push(t('{n} PT #1s', { n: fmt.num(c.firsts) }));
  if (!c.active) out.push(t('No plays stored in {year}', { year }));
  return out.slice(0, 3);
}

/** A picker card: a button that adds the player (or takes them off), with their dossier's ⓘ beside it. */
export function candidateCard(ctx: Ctx, core: CorePack, c: Candidate, year: number, { me, placed, alltime = false }: { me: number | null; placed: string; alltime?: boolean }): Safe {
  const { t } = ctx;
  const self = c.id === me;
  const line = alltime ? careerLine(ctx, c) : rankLine(ctx, c);
  const chips = alltime ? careerHighlights(ctx, c) : highlights(ctx, c, year);
  const label = alltime ? t('{name}’s career', { name: c.name }) : t('{name}’s year', { name: c.name });
  return html`<li class="t10-card ${placed ? 't10-card-on' : ''} ${self ? 't10-card-self' : ''} ${c.active || alltime ? '' : 't10-card-quiet'} ${alltime && c.legend ? 't10-card-legend' : ''}" data-id="${c.id}">
    <button class="t10-card-main" type="button" data-pick="${c.id}" ${self ? html`disabled aria-disabled="true"` : html`aria-pressed="${String(Boolean(placed))}"`}>
      ${avatar(ctx, core.players, c.row, 'avatar-md')}
      <span class="t10-card-text">
        <span class="t10-card-name ${nameClass(ctx, core.players, c.row)}">${c.name}</span>
        <span class="t10-card-rank">${self ? t('You can’t vote for yourself') : line}</span>
        ${self ? '' : html`<span class="t10-card-chips">${chips.map(h => html`<span>${h}</span>`)}</span>`}
      </span>
      <span class="t10-card-badge" data-badge aria-hidden="true">${placed}</span>
    </button>
    <button class="t10-info" type="button" data-info="${c.id}" aria-label="${label}" title="${label}">ⓘ</button>
  </li>`;
}
