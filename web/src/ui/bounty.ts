// The bounty board's pieces, as assets/js/core/bounty.js has them: a goal's short name (a profile's trophies), and a
// bounty's dare, prizes and pot (the map page). Rows come from bounties.json (tools/lib/bounties.mjs).

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { playerLinkId, type Players } from './players.ts';
import { bananas } from './bananas.ts';

export type Goal = 'fc' | 'pass' | 'snipe';

/** A pledge: [prize, by, byOsu, until, lapsed], or [prize, by, byOsu] for a claimed bounty's. */
export type Pledge = readonly [string, string | null, number | null, (number | null)?, boolean?];

/**
 * A bounty's Bananas (bounties.json open row, from index 9): the pot, its funds ([osu! id, or null for someone not on
 * the site, amount]), who posted it (null for a house bounty) and when it ends.
 */
export interface Pot {
  pot: number;
  funds: readonly (readonly [number | null, number])[];
  poster: number | null;
  expires: number | null;
}

/** A goal's short name, for the hall of fame. */
export const goalLabel = (ctx: Ctx, goal: Goal): string =>
  ({ fc: ctx.t('Full combo'), pass: ctx.t('First pass'), snipe: ctx.t('Snipe') })[goal];

/** What the bounty asks for, as a dare: "Nobody’s FC’d this. Yet." or "Take {holder}’s #1." with the holder linked. */
export function goalLine(ctx: Ctx, goal: Goal, target: number | null, players: Players): Safe {
  const { t, th } = ctx;
  if (goal === 'fc') return html`<span class="bounty-tag">${t('Nobody’s FC’d this. Yet.')}</span>`;
  if (goal === 'pass') return html`<span class="bounty-tag">${t('Nobody’s passed this. Yet.')}</span>`;
  return html`<span class="bounty-tag">${target ? th('Take {holder}’s #1.', { holder: playerLinkId(ctx, players, target, 'avatar-sm') }) : t('Take the #1.')}</span>`;
}

/** The prizes as tags. A lapsed pledge stays, struck through, so the board shows what was offered. */
export function prizeTags(ctx: Ctx, pledges: readonly Pledge[]): Safe | '' {
  const { t, fmt } = ctx;
  if (!pledges.length) return '';
  return html`<span class="prizes">${pledges.map(([prize, by, , until, lapsed]) => {
    const tip = lapsed ? t('Offer ended {date}', { date: fmt.date(until!) }) : until ? t('Offered until {date}', { date: fmt.date(until) }) : '';
    return html`<span class="prize ${lapsed ? 'prize-lapsed' : ''}" title="${tip}">${by ? t('{prize} · from {by}', { prize, by }) : prize}${lapsed ? html`<span class="sr-only"> (${t('offer ended')})</span>` : ''}</span>`;
  })}</span>`;
}

/**
 * A bounty's Bananas: the pot in gold, who posted it and who funded it (the first three by name), and when it ends. The
 * Bounties tab, the home page and the map page all show it.
 */
export function potLine(ctx: Ctx, { pot, funds, poster, expires }: Pot, players: Players): Safe {
  const { t, th, fmt } = ctx;
  const named = funds.filter(f => f[0]);
  const others = funds.length - named.length;
  const funders = named.slice(0, 3).map(f => playerLinkId(ctx, players, f[0]!));
  const more = named.length - funders.length + others;
  return html`<div class="bounty-pot">
    <span class="pot">${th('{amount} pot', { amount: html`<b>${bananas(ctx, pot)}</b>` })}</span>
    <span>${poster ? th('posted by {who}', { who: playerLinkId(ctx, players, poster) }) : t('house bounty')}</span>
    ${funders.length || more ? html`<span>${th('funded by {who}', {
      who: html`${funders.map((f, i) => html`${i ? ', ' : ''}${f}`)}${more ? (funders.length ? ` ${t('and {n} more', { n: fmt.num(more) })}` : fmt.plural(more, 'player')) : ''}`,
    })}</span>` : ''}
    ${expires ? html`<span class="faint" title="${fmt.dateTime(expires)}">${t('ends {date}', { date: fmt.date(expires) })}</span>` : ''}
  </div>`;
}
