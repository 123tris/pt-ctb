// The chips a map gets for the challenges it's in right now (assets/js/core/challenge-chips.js): the map of the week, a
// King of the hill slot and an open bounty, each a link to its Challenges tab. The map page shows them all under its
// title; the Challenges tabs show the other challenges' chips beside a map, so a map in two of them links both ways.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { slotName, tierName } from './hill.ts';

/** A bounty's goal as its chip (and the home page) says it. */
export const wanted = ({ t }: Ctx): Record<string, string> => ({ fc: t('Wanted: FC'), pass: t('Wanted: first pass'), snipe: t('Wanted: #1') });

/** What's running: the map of the week, the hill's pool ([slot, tier, map]), the open bounties ([map, …, goal]). */
export interface Running {
  week: number | null;
  hill: [string, string, number, ...unknown[]][];
  open: [number, unknown, string, ...unknown[]][];
}

/**
 * What's running, from the files a page already has: challenges.json (the map of the week), meta.json's `week` and
 * `hill` (the King of the hill month in brief, until its end) and bounties.json (the open bounties). Any may be null.
 */
export function runningNow(
  { challenges, meta, bounties }: { challenges?: { week?: { map: number } | null } | null; meta?: { week?: { map: number; end: number } | null; hill?: { status?: string; end: number; pool: Running['hill'] } | null } | null; bounties?: { open?: Running['open'] } | null },
  now: number,
): Running {
  return {
    // challenges.json's week, or meta.json's brief one (the map page reads only that) while it hasn't ended.
    week: challenges?.week?.map ?? (meta?.week && meta.week.end > now ? meta.week.map : null),
    hill: meta?.hill?.status === 'live' && meta.hill.end > now ? meta.hill.pool : [],
    open: bounties?.open ?? [],
  };
}

/**
 * The chips for map `id`, as gold badges, in the order the Challenges tabs come. `skip` leaves out one kind ('week',
 * 'hill' or 'bounty'): the tab the map is already listed on.
 */
export function challengeChips(ctx: Ctx, id: number, running: Running, skip = ''): Safe[] {
  const { t } = ctx;
  const chips: Safe[] = [];
  if (skip !== 'week' && running.week === id) chips.push(html`<a class="badge badge-gold" href="/challenges/week">${t('Map of the week')}</a>`);
  if (skip !== 'hill') {
    for (const [slot, tier, map] of running.hill) {
      if (map === id) chips.push(html`<a class="badge badge-gold" href="/challenges/hill">${t('King of the hill: {slot} · {tier}', { slot: slotName(ctx, slot), tier: tierName(ctx, tier) })}</a>`);
    }
  }
  if (skip !== 'bounty') {
    for (const [map, , goal] of running.open) if (map === id) chips.push(html`<a class="badge badge-gold" href="/challenges/bounties">${wanted(ctx)[goal]}</a>`);
  }
  return chips;
}
