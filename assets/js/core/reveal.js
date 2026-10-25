// Motion that sits on top of the pages without changing what they say (with assets/css/ambience.css).
// Sections fade up from below the first time they scroll into view. Nothing moves under prefers-reduced-motion.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const REVEAL = '.section, .grid > .card, .rows, .feed, .table-wrap, .stats, .since li, .hero-ladder, .game-cards > *';
const seen = new IntersectionObserver(entries => entries.forEach(entry => {
  if (!entry.isIntersecting) return;
  entry.target.classList.add('in');
  seen.unobserve(entry.target);
}), { rootMargin: '0px 0px -8% 0px' });

function reveal(root) {
  if (reduced()) return;
  root.querySelectorAll(REVEAL).forEach(el => {
    if (el.classList.contains('reveal')) return;
    el.classList.add('reveal');
    seen.observe(el);
  });
}

export function initReveal() {
  const root = document.getElementById('content');
  new MutationObserver(() => reveal(root)).observe(root, { childList: true, subtree: true });
}
