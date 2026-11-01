// King of the hill's words, shared by its Challenges tab (pages/hill.js), the home page, map chips and a profile's
// trophies: slot, tier, month, season and title names, the time left in a month, and lists of names.

import { html } from './html.js';
import { HILL_SLOTS } from './model.js';
import * as fmt from './fmt.js';
import { t, locale } from './i18n.js';

/** A slot's name: the mods as players say them, and CV (a convert) in words where there's room. */
export const SLOT_NAME = { NM: 'NM', HD: 'HD', HR: 'HR', DT: 'DT', FM: 'FM', CV: t('Convert') };
export const TIER_NAME = { open: t('Open|tier'), challenger: t('Challenger') };

const monthFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "November 2026" for "2026-11" (pt: "Novembro de 2026", capitalised as a heading). */
export const monthLabel = id => {
  const text = monthFormat.format(new Date(Date.UTC(Number(id.slice(0, 4)), Number(id.slice(5, 7)) - 1, 15)));
  return text[0].toUpperCase() + text.slice(1);
};
/** The month after "2026-11", as it reads in a sentence: "December 2026" (pt: "dezembro de 2026"). */
export const nextMonthLabel = id => {
  const [y, m] = id.split('-').map(Number);
  return monthFormat.format(new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 15)));
};
const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'Europe/Lisbon' });
/** "30 November": a day of a month, in Lisbon time, as the months run. */
export const lisbonDay = time => dayFormat.format(new Date(time * 1000));

const listFormat = new Intl.ListFormat(locale, { type: 'conjunction' });
/** Pieces of markup joined as a list in the visitor's language: "A, B and C" ("A, B e C"). */
export function andList(parts) {
  return html`${listFormat.formatToParts(parts.map((_, i) => String(i))).map(p => (p.type === 'element' ? parts[Number(p.value)] : p.value))}`;
}
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

/** "5d left" / "7h left" / "ended", as Challenges counts down the week. */
export function timeLeft(end) {
  const left = end - Date.now() / 1000;
  if (left <= 0) return t('ended');
  return left >= 86400 ? t('{n}d left', { n: Math.floor(left / 86400) }) : t('{n}h left', { n: Math.max(1, Math.floor(left / 3600)) });
}

/** "NM 1 · HR 4 · Convert 3": a tally per slot, leaving out the slots with none. */
export const slotTally = counts => HILL_SLOTS.map((slot, i) => (counts[i] ? `${SLOT_NAME[slot]} ${fmt.num(counts[i])}` : '')).filter(Boolean).join(' · ');
