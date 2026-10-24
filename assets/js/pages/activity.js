import { html } from '../core/html.js';
import { activity, playerIndex } from '../core/data.js';
import { S } from '../core/model.js';
import { eventItem, EVENT_KINDS } from '../core/events.js';
import { setTitle, tabs, scoreRow, empty } from '../core/ui.js';
import * as fmt from '../core/fmt.js';

/** Events grouped under "Today", "Yesterday" or the date. */
function feed(events, index, maps) {
  if (!events.length) return empty('Nothing of this kind in recent months.');
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  let lastDay = null;
  return html`<div class="feed">${events.map(e => {
    const d = new Date(e.t * 1000).toDateString();
    const heading = d === lastDay ? '' : html`<div class="feed-day">${d === today ? 'Today' : d === yesterday ? 'Yesterday' : fmt.day(e.t)}</div>`;
    lastDay = d;
    return html`${heading}${eventItem(e, index, maps)}`;
  })}</div>`;
}

export default async function activityPage(root, { query, isCurrent }) {
  const [data, index] = await Promise.all([activity(), playerIndex()]);
  if (!isCurrent()) return;
  setTitle('Activity');
  const view = query.view === 'plays' ? 'plays' : 'events';
  let kind = '';

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Activity</span>
      <h1>What’s happening in Portuguese catch</h1>
      <p>Snipes, new top plays, Dan passes and leaderboard climbs from the last four months. Plays show up when the bot imports them (every four hours).</p>
    </header>
    ${tabs([
      { href: '#/activity', label: 'Events', active: view === 'events' },
      { href: '#/activity?view=plays', label: 'Recent plays', active: view === 'plays' },
    ])}
    ${view === 'events' ? html`<div class="chips" id="kinds" style="margin-bottom:16px">
      <button class="chip active" data-kind="">All</button>
      ${Object.entries(EVENT_KINDS).filter(([k]) => data.events.some(e => e.k === k)).map(([k, { label }]) => html`<button class="chip" data-kind="${k}"><span class="event-kind ev-${k}">${label}</span></button>`)}
    </div>` : ''}
    <div id="list"></div>
  `);

  const list = root.querySelector('#list');
  if (view === 'plays') {
    list.innerHTML = String(html`<div class="rows">${data.recent.map(([uid, cat, ...s]) =>
      scoreRow({ s, meta: data.maps[s[S.MAP]], player: uid, index, cat }))}</div>`);
    return;
  }

  const draw = () => {
    root.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    list.innerHTML = String(feed(data.events.filter(e => !kind || e.k === kind), index, data.maps));
  };
  root.querySelector('#kinds').addEventListener('click', e => {
    const button = e.target.closest('[data-kind]');
    if (!button) return;
    kind = button.dataset.kind;
    draw();
  });
  draw();
}
