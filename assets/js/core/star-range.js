// The Maps page's star-rating filter: a [min, max] range on a 0–10★ scale in 0.1★ steps, where 0 means no minimum and
// 10 means no maximum ("10★+"), since a few joke maps run to 90★ and more. Half of all maps sit under 2.4★ and 99% under
// 7.7★, so a plain linear scale keeps every catch difficulty in reach and the numbers where the eye expects them.
// It lives in the URL as `stars=4-7`, `stars=7-` (no maximum) or `stars=0-4` (no minimum); the full range adds nothing.

import { t, locale } from './i18n.js';

export const STAR_MAX = 10;
export const STAR_STEP = 0.1;
export const ANY_STARS = Object.freeze([0, STAR_MAX]);

const snap = v => Math.round(Math.min(STAR_MAX, Math.max(0, v)) / STAR_STEP) / (1 / STAR_STEP);
/** 3.5, 7, 10: one decimal at most, without float noise. */
const show = v => String(Math.round(v * 10) / 10);
/** show() for reading: 3.5 in English, 3,5 in Portuguese. */
const shown = v => (Math.round(v * 10) / 10).toLocaleString(locale);

// Old links filtered by difficulty name (?diff=platter); each name becomes the star band osu!catch's ranking criteria
// give it, and the -dose puns join Overdose.
const LEGACY_DIFFS = { cup: [0, 2], salad: [2, 2.7], platter: [2.7, 4], rain: [4, 5.3], overdose: [5.3, STAR_MAX], dose: [5.3, STAR_MAX] };

/** Keeps a range on the scale, in steps, with the minimum at least a step under the maximum. */
export function clampRange([lo, hi]) {
  lo = snap(lo);
  hi = snap(hi);
  if (lo > hi) [lo, hi] = [hi, lo];
  if (hi - lo < STAR_STEP - 1e-9) {
    if (lo > 0) lo = snap(hi - STAR_STEP);
    else hi = STAR_STEP;
  }
  return [lo, hi];
}

/** The page query's `stars` (or an old `diff`) as [min, max]; anything unreadable is the full range. */
export function parseStars({ stars, diff } = {}) {
  const m = /^\s*(\d+(?:\.\d+)?)?\s*-\s*(\d+(?:\.\d+)?)?\s*$/.exec(stars ?? '');
  if (m && (m[1] || m[2])) return clampRange([m[1] ? Number(m[1]) : 0, m[2] ? Number(m[2]) : STAR_MAX]);
  return Object.hasOwn(LEGACY_DIFFS, diff ?? '') ? [...LEGACY_DIFFS[diff]] : [...ANY_STARS];
}

export const isAnyStars = ([lo, hi]) => lo <= 0 && hi >= STAR_MAX;

/** The range for the URL: '' for the full range, else `4-7`, `7-` or `0-4`. */
export const formatStars = ([lo, hi]) => (isAnyStars([lo, hi]) ? '' : `${show(lo)}-${hi >= STAR_MAX ? '' : show(hi)}`);

/** The readout beside the slider: Any, 7★+, Up to 4★ or 3.5★ – 7★. */
export function starsLabel([lo, hi]) {
  if (isAnyStars([lo, hi])) return t('Any');
  if (hi >= STAR_MAX) return `${shown(lo)}★+`;
  if (lo <= 0) return t('Up to {stars}★', { stars: shown(hi) });
  return `${shown(lo)}★ – ${shown(hi)}★`;
}

/** Whether a map's stars fall in the range. Maps with unknown stars (0) only show while the range is the full one. */
export function inStars(stars, [lo, hi]) {
  if (isAnyStars([lo, hi])) return true;
  return stars > 0 && stars >= lo && (hi >= STAR_MAX || stars <= hi);
}
