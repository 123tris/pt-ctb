// The star-range slider (DESIGN.md §9): two native range inputs over one track with a single Rosa fill. Each input keeps
// its keyboard steps and accessible name, while a press anywhere on the track (not just on a thumb) moves the nearer
// thumb, which keeps it easy to hit on a phone. The range itself is core/star-range.js. Used by Maps and Challenges →
// Completion; one per page (it uses fixed ids).

import { html } from './html.js';
import { STAR_MAX, STAR_STEP, ANY_STARS, starsLabel, isAnyStars } from './star-range.js';

const snapStar = v => Math.round(Math.min(STAR_MAX, Math.max(0, v)) / STAR_STEP) / (1 / STAR_STEP);

/** The slider's markup, set to [lo, hi]. */
export const starSlider = ([lo, hi]) => html`<div class="star-filter" role="group" aria-labelledby="stars-label">
  <span class="chips-label" id="stars-label">Stars</span>
  <div class="range" id="stars-range">
    <div class="range-track"><div class="range-fill"></div></div>
    <input type="range" id="stars-min" min="0" max="${STAR_MAX}" step="${STAR_STEP}" value="${lo}" aria-label="Minimum stars">
    <input type="range" id="stars-max" min="0" max="${STAR_MAX}" step="${STAR_STEP}" value="${hi}" aria-label="Maximum stars">
  </div>
  <span class="range-out" id="stars-out"></span>
  <button class="range-reset" type="button" id="stars-reset">Reset</button>
</div>`;

/**
 * Wires up the slider starSlider() drew inside `root`. The track and readout follow every step at once; `onChange`
 * gets the new range once the thumbs rest (and at once on Reset). Returns { set(range) } to move it from outside,
 * e.g. for "Clear filters", which doesn't call onChange.
 */
export function bindStarSlider(root, initial, onChange) {
  let stars = [...initial];
  const range = root.querySelector('#stars-range');
  const [min, max] = [root.querySelector('#stars-min'), root.querySelector('#stars-max')];
  const out = root.querySelector('#stars-out');
  const reset = root.querySelector('#stars-reset');
  const show = () => {
    const [lo, hi] = stars;
    min.value = lo;
    max.value = hi;
    range.style.setProperty('--lo', `${lo / STAR_MAX * 100}%`);
    range.style.setProperty('--hi', `${hi / STAR_MAX * 100}%`);
    min.setAttribute('aria-valuetext', lo > 0 ? `${lo} stars` : 'No minimum');
    max.setAttribute('aria-valuetext', hi < STAR_MAX ? `${hi} stars` : 'No maximum');
    out.textContent = starsLabel(stars);
    out.classList.toggle('on', !isAnyStars(stars));
    reset.hidden = isAnyStars(stars);
  };
  let timer;
  // Moves one thumb, stopping a step short of the other so the two never cross.
  const setStar = (input, value) => {
    const [lo, hi] = stars;
    const v = snapStar(value);
    stars = input === min ? [snapStar(Math.min(v, hi - STAR_STEP)), hi] : [lo, snapStar(Math.max(v, lo + STAR_STEP))];
    show();
    if (stars[0] === lo && stars[1] === hi) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange([...stars]), 150);
  };
  for (const input of [min, max]) input.addEventListener('input', () => setStar(input, Number(input.value)));
  const starAt = x => {
    const track = range.querySelector('.range-track').getBoundingClientRect();
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
    const move = ev => setStar(input, starAt(ev.clientX));
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
    stars = [...ANY_STARS];
    show();
    onChange([...stars]);
    min.focus();
  });
  show();
  return {
    set(next) {
      clearTimeout(timer);
      stars = [...next];
      show();
    },
  };
}
