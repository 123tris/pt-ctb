// The chips a map gets for the challenges it's in right now: the map of the week, a King of the hill slot and an open
// bounty, each a link to its Challenges tab. The map page shows them all under its title; the Challenges tabs show the
// other challenges' chips beside a map, so a map that's in two of them links both ways.

import { html } from './html.js';
import { SLOT_NAME, TIER_NAME } from './hill.js';
import { t } from './i18n.js';

/** A bounty's goal as its chip (and the home page) says it. */
export const WANTED = { fc: t('Wanted: FC'), pass: t('Wanted: first pass'), snipe: t('Wanted: #1') };

/**
 * What's running, from the files a page already has: challenges.json (the map of the week), meta.json (`hill`, the
 * King of the hill month in brief, until its end: an ended month's pool is settled, not running) and bounties.json
 * (the open bounties). Any of them may be null.
 */
export const runningNow = ({ challenges, meta, bounties }) => ({
  // challenges.json's week, or meta.json's brief one (the map page reads only that) while it hasn't ended.
  week: challenges?.week?.map ?? (meta?.week?.end > Date.now() / 1000 ? meta.week.map : null),
  hill: meta?.hill?.status === 'live' && meta.hill.end > Date.now() / 1000 ? meta.hill.pool : [],
  open: bounties?.open ?? [],
});

/**
 * The chips for map `id` (`now` from runningNow), as gold badges, in the order the Challenges tabs come. `skip` leaves
 * out one kind ('week', 'hill' or 'bounty'): the tab the map is already listed on.
 */
export function challengeChips(id, now, skip = '') {
  const chips = [];
  if (skip !== 'week' && now.week === id) chips.push(html`<a class="badge badge-gold" href="#/challenges/week">${t('Map of the week')}</a>`);
  if (skip !== 'hill') {
    for (const [slot, tier, map] of now.hill) {
      if (map === id) chips.push(html`<a class="badge badge-gold" href="#/challenges/hill">${t('King of the hill: {slot} · {tier}', { slot: SLOT_NAME[slot], tier: TIER_NAME[tier] })}</a>`);
    }
  }
  if (skip !== 'bounty') {
    for (const [map, , goal] of now.open) if (map === id) chips.push(html`<a class="badge badge-gold" href="#/challenges/bounties">${WANTED[goal]}</a>`);
  }
  return chips;
}
