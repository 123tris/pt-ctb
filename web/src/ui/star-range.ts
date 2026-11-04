// The Maps page's star-rating filter, as assets/js/core/star-range.js has it (the old pages still use that one), and
// the slider's markup from core/star-slider.js. A range is [min, max] on a 0–10★ scale in 0.1★ steps, where 0 means no
// minimum and 10 means no maximum ("10★+"), since a few joke maps run to 90★ and more. Half of all maps sit under 2.4★
// and 99% under 7.7★, so a plain linear scale keeps every catch difficulty in reach.
// It lives in the address as `stars=4-7`, `stars=7-` (no maximum) or `stars=0-4` (no minimum); the full range adds
// nothing. The slider's events are client/star-slider.ts.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';

export type StarRange = readonly [number, number];

export const STAR_MAX = 10;
export const STAR_STEP = 0.1;
export const ANY_STARS: StarRange = [0, STAR_MAX];

const snap = (v: number) => Math.round(Math.min(STAR_MAX, Math.max(0, v)) / STAR_STEP) / (1 / STAR_STEP);
/** 3.5, 7, 10: one decimal at most, without float noise. */
const show = (v: number) => String(Math.round(v * 10) / 10);
/** show() for reading: 3.5 in English, 3,5 in Portuguese. */
const shown = (ctx: Ctx, v: number) => (Math.round(v * 10) / 10).toLocaleString(ctx.locale);

// Old links filtered by difficulty name (?diff=platter); each name becomes the star band osu!catch's ranking criteria
// give it, and the -dose puns join Overdose.
const LEGACY_DIFFS: Record<string, StarRange> = {
  cup: [0, 2], salad: [2, 2.7], platter: [2.7, 4], rain: [4, 5.3], overdose: [5.3, STAR_MAX], dose: [5.3, STAR_MAX],
};

/** Keeps a range on the scale, in steps, with the minimum at least a step under the maximum. */
export function clampRange([min, max]: StarRange): StarRange {
  let lo = snap(min);
  let hi = snap(max);
  if (lo > hi) [lo, hi] = [hi, lo];
  if (hi - lo < STAR_STEP - 1e-9) {
    if (lo > 0) lo = snap(hi - STAR_STEP);
    else hi = STAR_STEP;
  }
  return [lo, hi];
}

/** The page query's `stars` (or an old `diff`) as [min, max]; anything unreadable is the full range. */
export function parseStars({ stars, diff }: { stars?: string; diff?: string }): StarRange {
  const m = /^\s*(\d+(?:\.\d+)?)?\s*-\s*(\d+(?:\.\d+)?)?\s*$/.exec(stars ?? '');
  if (m && (m[1] || m[2])) return clampRange([m[1] ? Number(m[1]) : 0, m[2] ? Number(m[2]) : STAR_MAX]);
  return Object.hasOwn(LEGACY_DIFFS, diff ?? '') ? LEGACY_DIFFS[diff!] : ANY_STARS;
}

export const isAnyStars = ([lo, hi]: StarRange): boolean => lo <= 0 && hi >= STAR_MAX;

/** The range for the address: '' for the full range, else `4-7`, `7-` or `0-4`. */
export const formatStars = ([lo, hi]: StarRange): string => (isAnyStars([lo, hi]) ? '' : `${show(lo)}-${hi >= STAR_MAX ? '' : show(hi)}`);

/** The readout beside the slider: Any, 7★+, Up to 4★ or 3.5★ – 7★. */
export function starsLabel(ctx: Ctx, [lo, hi]: StarRange): string {
  if (isAnyStars([lo, hi])) return ctx.t('Any');
  if (hi >= STAR_MAX) return `${shown(ctx, lo)}★+`;
  if (lo <= 0) return ctx.t('Up to {stars}★', { stars: shown(ctx, hi) });
  return `${shown(ctx, lo)}★ – ${shown(ctx, hi)}★`;
}

/** Whether a map's stars fall in the range. Maps with unknown stars (0) only show while the range is the full one. */
export function inStars(stars: number, [lo, hi]: StarRange): boolean {
  if (isAnyStars([lo, hi])) return true;
  return stars > 0 && stars >= lo && (hi >= STAR_MAX || stars <= hi);
}

/** What a screen reader says for the minimum thumb's value. */
export const minText = (ctx: Ctx, lo: number): string =>
  (lo > 0 ? ctx.t('{n} stars', { n: lo.toLocaleString(ctx.locale) }) : ctx.t('No minimum'));
/** What a screen reader says for the maximum thumb's value. */
export const maxText = (ctx: Ctx, hi: number): string =>
  (hi < STAR_MAX ? ctx.t('{n} stars', { n: hi.toLocaleString(ctx.locale) }) : ctx.t('No maximum'));

/** Where each thumb sits on the track, for the fill (--lo and --hi). */
export const trackAt = (stars: number): string => `${stars / STAR_MAX * 100}%`;

/**
 * The slider (DESIGN.md §9): two native range inputs over one track with a single Rosa fill, set to [lo, hi]. Drawn
 * as client/star-slider.ts keeps it (fill, readout, values read out, Reset), so the first paint is final; that module
 * wires it up. One per page: it uses fixed ids.
 */
export function starSlider(ctx: Ctx, [lo, hi]: StarRange): Safe {
  const { t } = ctx;
  const any = isAnyStars([lo, hi]);
  return html`<div class="star-filter" role="group" aria-labelledby="stars-label">
  <span class="chips-label" id="stars-label">${t('Stars')}</span>
  <div class="range" id="stars-range" style="--lo:${trackAt(lo)};--hi:${trackAt(hi)}">
    <div class="range-track"><div class="range-fill"></div></div>
    <input type="range" id="stars-min" min="0" max="${STAR_MAX}" step="${STAR_STEP}" value="${lo}" aria-label="${t('Minimum stars')}" aria-valuetext="${minText(ctx, lo)}">
    <input type="range" id="stars-max" min="0" max="${STAR_MAX}" step="${STAR_STEP}" value="${hi}" aria-label="${t('Maximum stars')}" aria-valuetext="${maxText(ctx, hi)}">
  </div>
  <span class="range-out${any ? '' : ' on'}" id="stars-out">${starsLabel(ctx, [lo, hi])}</span>
  <button class="range-reset" type="button" id="stars-reset"${any ? ' hidden' : ''}>${t('Reset')}</button>
</div>`;
}
