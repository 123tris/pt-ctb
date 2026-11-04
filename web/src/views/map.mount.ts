// The map page's browser half (map.ts draws it): the switch between the leaderboard's two views, and the set's list of
// difficulties scrolled to this one.

import { setPressed } from '../client/dom.ts';

export function mount(root: HTMLElement): void {
  // The two views of the leaderboard: the plays that count, and those from before the map was ranked. The listener is
  // on the board's section, which goes with the page.
  const section = root.querySelector<HTMLElement>('.map-board')!;
  section.addEventListener('click', e => {
    const view = (e.target as Element).closest<HTMLElement>('[data-board]')?.dataset.board;
    if (!view) return;
    setPressed(section, 'board', view);
    section.querySelectorAll<HTMLElement>('[data-view]').forEach(el => { el.hidden = el.dataset.view !== view; });
  });

  // A long list scrolls (sideways on a phone): start it with this difficulty in view.
  const nav = root.querySelector<HTMLElement>('.diffs'), current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
  if (nav && current) {
    nav.scrollLeft = current.offsetLeft - nav.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
    nav.scrollTop = current.offsetTop - nav.offsetTop - (nav.clientHeight - current.offsetHeight) / 2;
  }
}
