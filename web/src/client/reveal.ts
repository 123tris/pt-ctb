// Motion that sits on top of the pages without changing what they say (with assets/css/ambience.css), as
// assets/js/core/reveal.js has it. Sections fade up from below the first time they scroll into view. Nothing moves
// under prefers-reduced-motion. What's on screen when a page opens appears at once; only sections further down wait to
// fade in, so the motion never holds back what people came for.

import { reducedMotion } from './ui.ts';

const REVEAL = '.section, .grid > .card, .rows, .feed, .table-wrap, .stats, .since li, .hero-ladder, .game-cards > *';

export function initReveal(): void {
  const root = document.getElementById('content')!;
  const seen = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('in');
    seen.unobserve(entry.target);
  }), { rootMargin: '0px 0px -8% 0px' });
  // A new section's first check, once it has been laid out: on screen, it stays as it is; below the fold (where nobody
  // sees it go), it's hidden until it scrolls in.
  const first = new IntersectionObserver(entries => entries.forEach(entry => {
    first.unobserve(entry.target);
    if (entry.isIntersecting) return;
    entry.target.classList.add('reveal');
    seen.observe(entry.target);
  }));
  const checked = new WeakSet<Element>();
  new MutationObserver(() => {
    if (reducedMotion()) return;
    root.querySelectorAll(REVEAL).forEach(el => {
      if (checked.has(el)) return;
      checked.add(el);
      first.observe(el);
    });
  }).observe(root, { childList: true, subtree: true });
}
