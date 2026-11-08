// The players a Top 10 ballot picks from (§3.1): every PT player in the core pack, with what their year looks like from
// data every page already has. The core pack gives the PT rank, the last play, the Dan stages and the #1s held;
// history.json (every player's totals, small) gives the official pp on 1 January, so the cards can say "+3,100 pp" and
// how far they climbed. The player packs would say more (scores set this year, first FCs), but they're 13 MB for
// everyone: the dossier (§4.2) reads one when it's opened.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import type { History } from '../views/player.ts';
import { avatar, nameClass } from './players.ts';
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
export function candidatesOf(core: CorePack, history: History | null, year: number): Candidate[] {
  const p = core.players;
  const from = yearStart(year);
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
    });
  }
  // The PT rank on 1 January: the same board, by the pp then.
  const jan = list.filter(c => c.ppJan !== null && c.ppJan > 0 && c.rank > 0).sort((a, b) => b.ppJan! - a.ppJan!);
  jan.forEach((c, i) => { c.rankJan = i + 1; });
  const gain = (c: Candidate) => (c.ppJan === null ? 0 : c.pp - c.ppJan);
  return list.sort((a, b) => Number(b.active) - Number(a.active) || gain(b) - gain(a) || b.last - a.last);
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
export function candidateCard(ctx: Ctx, core: CorePack, c: Candidate, year: number, { me, placed }: { me: number | null; placed: string }): Safe {
  const { t } = ctx;
  const self = c.id === me;
  return html`<li class="t10-card ${placed ? 't10-card-on' : ''} ${self ? 't10-card-self' : ''} ${c.active ? '' : 't10-card-quiet'}" data-id="${c.id}">
    <button class="t10-card-main" type="button" data-pick="${c.id}" ${self ? html`disabled aria-disabled="true"` : html`aria-pressed="${String(Boolean(placed))}"`}>
      ${avatar(ctx, core.players, c.row, 'avatar-md')}
      <span class="t10-card-text">
        <span class="t10-card-name ${nameClass(ctx, core.players, c.row)}">${c.name}</span>
        <span class="t10-card-rank">${self ? t('You can’t vote for yourself') : rankLine(ctx, c)}</span>
        ${self ? '' : html`<span class="t10-card-chips">${highlights(ctx, c, year).map(h => html`<span>${h}</span>`)}</span>`}
      </span>
      <span class="t10-card-badge" data-badge aria-hidden="true">${placed}</span>
    </button>
    <button class="t10-info" type="button" data-info="${c.id}" aria-label="${t('{name}’s year', { name: c.name })}" title="${t('{name}’s year', { name: c.name })}">ⓘ</button>
  </li>`;
}
