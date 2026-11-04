// King of the hill's words, as assets/js/core/hill.js has them: slot, tier, month, season and title names, and a tally
// of crowns by slot. So far what a profile's trophies need; the Challenges tab, the home page and map chips will add
// the rest (the time left in a month, lists of names).

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { HILL_SLOTS } from '../kernel/model.ts';

/** A crown title from a profile's `crowns.titles` (tools/lib/hill.mjs). */
export interface HillTitle {
  kind: 'king' | 'slot' | 'allrounder';
  slot?: string;
  month?: string;
  season?: string;
  final?: boolean;
}

/** A slot's name: the mods as players say them, and CV (a convert) in words where there's room. */
export const slotName = (ctx: Ctx, slot: string): string => (slot === 'CV' ? ctx.t('Convert') : slot);

export const tierName = (ctx: Ctx, tier: string): string =>
  ({ open: ctx.t('Open|tier'), challenger: ctx.t('Challenger') } as Record<string, string>)[tier] ?? tier;

const monthFormats = new Map<string, Intl.DateTimeFormat>();
const monthFormat = (locale: string) => {
  let format = monthFormats.get(locale);
  if (!format) monthFormats.set(locale, format = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  return format;
};

/** "November 2026" for "2026-11" (pt: "Novembro de 2026", capitalised as a heading). */
export function monthLabel(ctx: Ctx, id: string): string {
  const text = monthFormat(ctx.locale).format(new Date(Date.UTC(Number(id.slice(0, 4)), Number(id.slice(5, 7)) - 1, 15)));
  return text[0].toUpperCase() + text.slice(1);
}

/** "Q4 2026" for "2026-Q4": seasons are calendar quarters, Lisbon time. */
export const seasonLabel = (ctx: Ctx, id: string): string => ctx.t('Q{q} {year}', { q: id.slice(6), year: id.slice(0, 4) });

/** A title's name: "King of the hill", "HR king", "All-rounder". */
export function titleName(ctx: Ctx, title: HillTitle): string {
  if (title.kind === 'king') return ctx.t('King of the hill');
  if (title.kind === 'slot') return ctx.t('{slot} king', { slot: slotName(ctx, title.slot ?? '') });
  return ctx.t('All-rounder');
}

/** When a title was won: its month, or its season (a slot king's season still running says "so far"). */
export const titleWhen = (ctx: Ctx, title: HillTitle): string => (title.month ? monthLabel(ctx, title.month)
  : title.final ? seasonLabel(ctx, title.season ?? '') : ctx.t('{season}, so far', { season: seasonLabel(ctx, title.season ?? '') }));

/** "NM 1 · HR 4 · Convert 3": a tally per slot, leaving out the slots with none. */
export const slotTally = (ctx: Ctx, counts: readonly number[]): string =>
  HILL_SLOTS.map((slot: string, i: number) => (counts[i] ? `${slotName(ctx, slot)} ${ctx.fmt.num(counts[i])}` : '')).filter(Boolean).join(' · ');

/** "3d left", "5h left" or "ended", by the Ctx's clock. */
export function timeLeft(ctx: Ctx, end: number): string {
  const left = end - ctx.now();
  if (left <= 0) return ctx.t('ended');
  return left >= 86400 ? ctx.t('{n}d left', { n: Math.floor(left / 86400) }) : ctx.t('{n}h left', { n: Math.max(1, Math.floor(left / 3600)) });
}

const listFormats = new Map<string, Intl.ListFormat>();

/** Pieces of markup joined as a list in the Ctx's language: "A, B and C" ("A, B e C"). */
export function andList(ctx: Ctx, parts: Value[]): Safe {
  let format = listFormats.get(ctx.locale);
  if (!format) listFormats.set(ctx.locale, format = new Intl.ListFormat(ctx.locale, { type: 'conjunction' }));
  return html`${format.formatToParts(parts.map((_, i) => String(i))).map(p => (p.type === 'element' ? parts[Number(p.value)] : p.value))}`;
}
