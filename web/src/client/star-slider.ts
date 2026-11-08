// The star-range slider's events, as assets/js/core/star-slider.js has them (the old pages still use that one); the
// markup is ui/star-range.ts starSlider(). Two native range inputs over one track: each keeps its keyboard steps and
// accessible name, while a press anywhere on the track (not just on a thumb) moves the nearer thumb, which keeps it
// easy to hit on a phone.

import type { Ctx } from '../kernel/ctx.ts';
import {
  STAR_MAX, STAR_STEP, ANY_STARS, starsLabel, isAnyStars, minText, maxText, trackAt, type StarRange,
} from '../ui/star-range.ts';

const snapStar = (v: number) => Math.round(Math.min(STAR_MAX, Math.max(0, v)) / STAR_STEP) / (1 / STAR_STEP);

export interface StarSlider {
  /** Moves the slider from outside (e.g. "Clear filters"), without calling onChange. */
  set(range: StarRange): void;
}

/**
 * Wires up the slider starSlider() drew inside `root`. The track and readout follow every step at once; `onChange`
 * gets the new range once the thumbs rest (and at once on Reset).
 */
export function bindStarSlider(
  root: ParentNode, ctx: Ctx, initial: StarRange, onChange: (range: StarRange) => void,
): StarSlider {
  let stars = initial;
  const range = root.querySelector<HTMLElement>('#stars-range')!;
  const min = root.querySelector<HTMLInputElement>('#stars-min')!;
  const max = root.querySelector<HTMLInputElement>('#stars-max')!;
  const out = root.querySelector<HTMLElement>('#stars-out')!;
  const reset = root.querySelector<HTMLButtonElement>('#stars-reset')!;
  const show = () => {
    const [lo, hi] = stars;
    min.value = String(lo);
    max.value = String(hi);
    range.style.setProperty('--lo', trackAt(lo));
    range.style.setProperty('--hi', trackAt(hi));
    min.setAttribute('aria-valuetext', minText(ctx, lo));
    max.setAttribute('aria-valuetext', maxText(ctx, hi));
    out.textContent = starsLabel(ctx, stars);
    out.classList.toggle('on', !isAnyStars(stars));
    reset.hidden = isAnyStars(stars);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Moves one thumb, stopping a step short of the other so the two never cross.
  const setStar = (input: HTMLInputElement, value: number) => {
    const [lo, hi] = stars;
    const v = snapStar(value);
    stars = input === min ? [snapStar(Math.min(v, hi - STAR_STEP)), hi] : [lo, snapStar(Math.max(v, lo + STAR_STEP))];
    show();
    if (stars[0] === lo && stars[1] === hi) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange(stars), 150);
  };
  for (const input of [min, max]) input.addEventListener('input', () => setStar(input, Number(input.value)));
  const starAt = (x: number) => {
    const track = range.querySelector('.range-track')!.getBoundingClientRect();
    return (x - track.left) / track.width * STAR_MAX;
  };
  range.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const v = starAt(e.clientX);
    const [lo, hi] = stars;
    // The nearer thumb; when the two sit together, whichever can still move towards the press.
    let input = Math.abs(v - lo) < Math.abs(v - hi) ? min : max;
    if (hi - lo < 0.3 && v > hi) input = hi < STAR_MAX ? max : min;
    else if (hi - lo < 0.3 && v < lo) input = lo > 0 ? min : max;
    input.focus({ preventScroll: true });
    setStar(input, v);
    range.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setStar(input, starAt(ev.clientX));
    const end = () => {
      range.removeEventListener('pointermove', move);
      range.removeEventListener('pointerup', end);
      range.removeEventListener('pointercancel', end);
    };
    range.addEventListener('pointermove', move);
    range.addEventListener('pointerup', end);
    range.addEventListener('pointercancel', end);
  });
  reset.addEventListener('click', () => {
    clearTimeout(timer);
    stars = ANY_STARS;
    show();
    onChange(stars);
    min.focus();
  });
  show();
  return {
    set(next) {
      clearTimeout(timer);
      stars = next;
      show();
    },
  };
}
