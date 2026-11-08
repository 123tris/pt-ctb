// The dice of the site's fun parts (assets/js/core/fun.js keeps the browser's: toasts, easter eggs). Each takes its
// random source, so a view stays pure: the browser half passes Math.random, a test a seeded generator, and the same
// numbers give the same picks as the old pages' own shuffle() and pick().

/** A copy of `list` in random order (Fisher–Yates, from the end, as assets/js/pages/games.js shuffles). */
export function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One item at random; undefined from an empty list, as the old pick() gave. */
export const randomItem = <T>(list: readonly T[], random: () => number): T | undefined =>
  list[Math.floor(random() * list.length)];
