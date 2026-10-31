// King of the hill's words, shared by its Leaderboards tab (pages/hill.js) and the crowns on a profile: slot, tier,
// month, season and title names, and the profile's crowns section (players/{id}.json `crowns`, tools/lib/hill.mjs).

import { html } from './html.js';
import { HILL_SLOTS, HILL_TIERS } from './model.js';
import * as fmt from './fmt.js';
import { t, locale } from './i18n.js';

/** A slot's name: the mods as players say them, and SP (catch-specific maps) in words where there's room. */
export const SLOT_NAME = { NM: 'NM', HD: 'HD', HR: 'HR', DT: 'DT', FM: 'FM', SP: t('Specifics') };
export const TIER_NAME = { open: t('Open|tier'), challenger: t('Challenger') };

const monthFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "November 2026" for "2026-11" (pt: "Novembro de 2026", capitalised as a heading). */
export const monthLabel = id => {
  const text = monthFormat.format(new Date(Date.UTC(Number(id.slice(0, 4)), Number(id.slice(5, 7)) - 1, 15)));
  return text[0].toUpperCase() + text.slice(1);
};
/** "Q4 2026" for "2026-Q4": seasons are calendar quarters, Lisbon time. */
export const seasonLabel = id => t('Q{q} {year}', { q: id.slice(6), year: id.slice(0, 4) });

/** A title's name: "King of the hill", "HR king", "All-rounder". */
export function titleName(title) {
  if (title.kind === 'king') return t('King of the hill');
  if (title.kind === 'slot') return t('{slot} king', { slot: SLOT_NAME[title.slot] });
  return t('All-rounder');
}

/** When a title was won: its month, or its season (a slot king's season still running says "so far"). */
export const titleWhen = title => (title.month ? monthLabel(title.month)
  : title.final ? seasonLabel(title.season) : t('{season}, so far', { season: seasonLabel(title.season) }));

/** "NM 1 · HR 4 · SP 3": a tally per slot, leaving out the slots with none. */
export const slotTally = counts => HILL_SLOTS.map((slot, i) => (counts[i] ? `${slot} ${fmt.num(counts[i])}` : '')).filter(Boolean).join(' · ');

/**
 * A profile's King of the hill section: the crowns kept, by slot, the titles they won as chips (gold once settled),
 * and the crowns held in the month running now. Nothing for a player who has neither.
 */
export function crownsSection(crowns) {
  if (!crowns || (!crowns.total && !crowns.holding.length)) return '';
  const holding = [...crowns.holding].sort((a, b) => HILL_SLOTS.indexOf(a[0]) - HILL_SLOTS.indexOf(b[0]) || HILL_TIERS.indexOf(a[1]) - HILL_TIERS.indexOf(b[1]));
  return html`<section class="section card hill-crowns">
    <h2 class="card-h">${t('King of the hill')}${crowns.total ? html` <span class="faint">· ${fmt.plural(crowns.total, 'crown')}</span>` : ''}</h2>
    ${crowns.titles.length ? html`<ul class="hill-chips" aria-label="${t('Titles')}">${crowns.titles.map(title => html`<li class="badge ${title.final ? 'badge-gold' : ''}">
      ${titleName(title)} <span class="hill-chip-when">· ${titleWhen(title)}</span></li>`)}</ul>` : ''}
    ${crowns.total ? html`<p class="small muted">${t('Crowns by slot: {tally}', { tally: slotTally(crowns.slots) })}</p>` : ''}
    ${holding.length ? html`<p class="small muted">${t('Holding this month: {slots}.', { slots: holding.map(([slot, tier]) => `${SLOT_NAME[slot]} (${TIER_NAME[tier]})`).join(', ') })}
      <a href="#/rankings/hill">${t('See the pool')}</a></p>` : ''}
  </section>`;
}
