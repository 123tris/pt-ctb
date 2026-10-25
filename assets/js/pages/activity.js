import { html } from '../core/html.js';
import { activity, challenges, playerIndex } from '../core/data.js';
import { S } from '../core/model.js';
import { eventItem, EVENT_KINDS } from '../core/events.js';
import { weeklyRecap, hasWeekly } from '../core/weekly.js';
import { setTitle, tabs, scoreRow, empty, chipGroup, setPressed, writeQuery, announce, resultCount } from '../core/ui.js';
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
  const [data, index, ch] = await Promise.all([activity(), playerIndex(), challenges().catch(() => null)]);
  if (!isCurrent()) return;
  setTitle('Activity');
  // "This week" (the bot's Monday recap) only appears once the bot has written something for it.
  const weekly = hasWeekly(ch?.weekly) ? ch.weekly : null;
  const view = query.view === 'plays' ? 'plays' : query.view === 'week' && weekly ? 'week' : 'events';
  const kinds = Object.entries(EVENT_KINDS).filter(([k]) => data.events.some(e => e.k === k));
  let kind = kinds.some(([k]) => k === query.kind) ? query.kind : '';

  root.innerHTML = String(html`
    <header class="page-head">
      <h1>Activity</h1>
      <p>Snipes, new top plays, Dan passes and leaderboard climbs from the last four months.</p>
    </header>
    ${tabs([
      { href: '#/activity', label: 'Events', active: view === 'events' },
      { href: '#/activity?view=plays', label: 'Recent plays', active: view === 'plays' },
      ...(weekly ? [{ href: '#/activity?view=week', label: 'This week', active: view === 'week' }] : []),
    ], 'Activity views')}
    ${view === 'events' ? html`<div id="kinds" style="margin-bottom:12px">${chipGroup('Show', 'kind', [
      ['', 'All'], ...kinds.map(([k, { label }]) => [k, html`<span class="event-kind ev-${k}">${label}</span>`]),
    ], kind)}</div>
    <p class="result-count" id="count"></p>` : ''}
    <div id="list"></div>
  `);

  const list = root.querySelector('#list');
  if (view === 'week') {
    list.innerHTML = String(weeklyRecap(weekly, ch.maps, index));
    return;
  }
  if (view === 'plays') {
    list.innerHTML = String(html`<div class="rows">${data.recent.map(([uid, cat, ...s]) =>
      scoreRow({ s, meta: data.maps[s[S.MAP]], player: uid, index, cat }))}</div>`);
    return;
  }

  // The chosen kind lives in the URL (?kind=snipe), and its count is announced when it changes.
  const count = root.querySelector('#count');
  const draw = ({ speak = false } = {}) => {
    setPressed(root, 'kind', kind);
    const shown = data.events.filter(e => !kind || e.k === kind);
    list.innerHTML = String(feed(shown, index, data.maps));
    count.textContent = resultCount(shown.length, data.events.length, 'event');
    if (speak) announce(count.textContent);
    writeQuery({ kind });
  };
  root.querySelector('#kinds').addEventListener('click', e => {
    const button = e.target.closest('[data-kind]');
    if (!button) return;
    kind = button.dataset.kind;
    draw({ speak: true });
  });
  draw();
}
