// The bounty board's pieces, as assets/js/core/bounty.js has them. So far what a profile's trophies need: a goal's
// short name. The Bounties tab and the map page will add the goal line, the prizes and the pot.

import type { Ctx } from '../kernel/ctx.ts';

export type Goal = 'fc' | 'pass' | 'snipe';

/** A goal's short name, for the hall of fame. */
export const goalLabel = (ctx: Ctx, goal: Goal): string =>
  ({ fc: ctx.t('Full combo'), pass: ctx.t('First pass'), snipe: ctx.t('Snipe') })[goal];
