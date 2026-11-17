// The map page's browser half (map.ts draws it): the switch between the leaderboard's two views, the set's list of
// difficulties scrolled to this one, and the address without a bot link's ?via=bot.

import { setPressed } from '../client/dom.ts';

export function mount(root: HTMLElement): void {
  // A bot link's ?via=bot (maplinks/maplinks.js) has done its job once the page is drawn: the address drops it, so the
  // map's address is what gets copied or bookmarked.
  const query = new URLSearchParams(location.search);
  if (query.has('via')) {
    query.delete('via');
    history.replaceState(history.state, '', `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`);
  }

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
