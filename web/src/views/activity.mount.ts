// The Activity page's browser half: the kind chips redraw the feed (kept in the address, the count announced), and
// "Show more" adds the next events in place.

import type { Ctx } from '../kernel/ctx.ts';
import { announce, writeQuery } from '../client/ui.ts';
import { setPressed } from '../client/dom.ts';
import { resultCount } from '../ui/page.ts';
import { FEED_STEP, feed, feedItems, moreLabel, shownEvents, type Data, type State } from './activity.ts';

export function mount(root: HTMLElement, ctx: Ctx, data: Data, start: State): void {
  if (start.view !== 'events') return;
  const list = root.querySelector<HTMLElement>('#list')!;
  const count = root.querySelector<HTMLElement>('#count')!;
  let kind = start.kind;

  /** Wires the "Show more" button of the feed that's drawn. */
  const wireMore = () => {
    const events = shownEvents(ctx, data, kind);
    const box = list.querySelector('.feed');
    const more = list.querySelector<HTMLElement>('.feed-more');
    const button = more?.querySelector('button');
    if (!box || !more || !button) return;
    let shown = Math.min(FEED_STEP, events.length);
    button.addEventListener('click', () => {
      const next = events.slice(shown, shown + FEED_STEP);
      const lastDay = new Date(events[shown - 1].t * 1000).toDateString();
      box.insertAdjacentHTML('beforeend', String(feedItems(ctx, next, data, lastDay)));
      shown += next.length;
      more.hidden = shown >= events.length;
      button.textContent = moreLabel(ctx, events.length - shown);
      // The button goes once everything is shown: keep keyboard focus on the page instead of losing it.
      if (more.hidden) box.lastElementChild?.querySelector('a')?.focus();
    });
  };

  const draw = ({ speak = false } = {}) => {
    setPressed(root, 'kind', kind);
    const events = shownEvents(ctx, data, kind);
    list.innerHTML = String(feed(ctx, data, events));
    wireMore();
    count.textContent = resultCount(ctx, events.length, data.activity.events.length, 'event');
    if (speak) announce(count.textContent);
    writeQuery({ kind });
  };
  root.querySelector('#kinds')!.addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLElement>('[data-kind]');
    if (!button) return;
    kind = button.dataset.kind!;
    draw({ speak: true });
  });
  wireMore();
  writeQuery({ kind });
}
