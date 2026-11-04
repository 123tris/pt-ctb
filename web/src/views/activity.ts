// The Activity page (/activity), as assets/js/pages/activity.js draws it: the events feed, filtered by kind, the recent
// plays, and the bot's weekly recap. From activity.json and challenges.json, with players from the core pack.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { S } from '../kernel/model.ts';
import { chipGroup, empty, resultCount, tabs } from '../ui/page.ts';
import { eventItem, type ActivityEvent } from '../ui/events.ts';
import { scoreRow, type Cat, type Play } from '../ui/scores.ts';
import { hasWeekly, weeklyRecap, type Weekly } from '../ui/weekly.ts';
import type { MapMeta } from '../ui/maps.ts';

export interface Activity {
  events: ActivityEvent[];
  /** The newest plays: [player, category, ...play]. */
  recent: [number, Cat, ...unknown[]][];
  maps: Record<string, MapMeta>;
}

export interface Data {
  core: CorePack;
  activity: Activity;
  challenges: { weekly?: Weekly; maps: Record<string, MapMeta> } | null;
}

export interface State {
  view: 'events' | 'plays' | 'week';
  /** The events filter's key, '' for all. */
  kind: string;
}

/** The feed's filters: [key, label, the event kinds it shows]. */
export const filters = ({ t }: Ctx): [string, string, string[]][] => [
  ['plays', t('Plays'), ['snipe', 'top', 'dan']],
  ['challenges', t('Challenges'), ['crown', 'duel', 'bounty', 'post']],
  ['boards', t('Leaderboards'), ['pass', 'mile', 'join']],
  ['tips', t('Tips'), ['tip']],
];

/**
 * The feed shows this many events at first and adds as many again per "Show more": all 400 at once made the page
 * about 6,000 elements, which took phones seconds to lay out.
 */
export const FEED_STEP = 60;

/** "This week" (the bot's Monday recap), only once the bot has written something for it. */
const weeklyOf = (data: Data) => (hasWeekly(data.challenges?.weekly) ? data.challenges!.weekly! : null);

/** The filters that have something in them (five at most, DESIGN.md §9 Chips). */
const groupsOf = (ctx: Ctx, data: Data) => filters(ctx).filter(([, , ks]) => data.activity.events.some(e => ks.includes(e.k)));

export function readState(ctx: Ctx, data: Data, query: Record<string, string | undefined>): State {
  const view = query.view === 'plays' ? 'plays' : query.view === 'week' && weeklyOf(data) ? 'week' : 'events';
  // An old ?kind=snipe link picks its group.
  const asked = filters(ctx).find(([key, , ks]) => key === query.kind || ks.includes(query.kind ?? ''));
  const kind = asked && groupsOf(ctx, data).some(([key]) => key === asked[0]) ? asked[0] : '';
  return { view, kind };
}

/** The events the filter shows. */
export function shownEvents(ctx: Ctx, data: Data, kind: string): ActivityEvent[] {
  const kinds = filters(ctx).find(([key]) => key === kind)?.[2];
  return data.activity.events.filter(e => !kinds || kinds.includes(e.k));
}

/** Events grouped under "Today", "Yesterday" or the date; `lastDay` is the day of the event shown just before them. */
export function feedItems(ctx: Ctx, events: readonly ActivityEvent[], data: Data, lastDay: string | null = null): Safe {
  const { t, fmt } = ctx;
  const now = ctx.now() * 1000;
  const today = new Date(now).toDateString();
  const yesterday = new Date(now - 86400000).toDateString();
  return html`${events.map(e => {
    const d = new Date(e.t * 1000).toDateString();
    const heading = d === lastDay ? '' : html`<div class="feed-day">${d === today ? t('Today') : d === yesterday ? t('Yesterday') : fmt.day(e.t)}</div>`;
    lastDay = d;
    return html`${heading}${eventItem(ctx, e, data.core.players, data.activity.maps, { tips: true })}`;
  })}`;
}

/** "Show 60 more events", for what's left after `shown`. */
export const moreLabel = (ctx: Ctx, left: number) => ctx.tn(Math.min(FEED_STEP, left), 'Show {n} more event', 'Show {n} more events');

/** The feed's first events, and the "Show more" button under it (activity.mount.ts adds the next ones in place). */
export function feed(ctx: Ctx, data: Data, events: readonly ActivityEvent[]): Safe {
  if (!events.length) return empty(ctx.t('Nothing of this kind in recent months.'));
  const shown = Math.min(FEED_STEP, events.length);
  return html`<div class="feed">${feedItems(ctx, events.slice(0, shown), data)}</div>
    <div class="feed-more"${shown >= events.length ? html` hidden` : ''}><button class="btn" type="button">${moreLabel(ctx, events.length - shown)}</button></div>`;
}

export function render(ctx: Ctx, data: Data, state: State): Safe {
  const { t } = ctx;
  const weekly = weeklyOf(data);
  const shown = state.view === 'events' ? shownEvents(ctx, data, state.kind) : [];
  const list = state.view === 'week' ? weeklyRecap(ctx, weekly, data.challenges!.maps, data.core.players)
    : state.view === 'plays' ? html`<div class="rows">${data.activity.recent.map(([uid, cat, ...s]) =>
      scoreRow(ctx, { s: s as Play, meta: data.activity.maps[(s as Play)[S.MAP]], player: uid, players: data.core.players, cat }))}</div>`
    : feed(ctx, data, shown);
  return html`
    <header class="page-head">
      <h1>${t('Activity')}</h1>
      <p>${t('Snipes, crowns, bounties, new top plays, Dan passes and leaderboard climbs from the last four months.')}</p>
    </header>
    ${tabs([
      { href: '/activity', label: t('Events'), active: state.view === 'events' },
      { href: '/activity?view=plays', label: t('Recent plays'), active: state.view === 'plays' },
      ...(weekly ? [{ href: '/activity?view=week', label: t('This week'), active: state.view === 'week' }] : []),
    ], t('Activity views'))}
    ${state.view === 'events' ? html`<div id="kinds" class="mb-3">${chipGroup(t('Show'), 'kind', [
      ['', t('All')], ...groupsOf(ctx, data).map(([k, label]): [string, string] => [k, label]),
    ], state.kind)}</div>
    <p class="result-count" id="count">${resultCount(ctx, shown.length, data.activity.events.length, 'event')}</p>` : ''}
    <div id="list">${list}</div>
  `;
}
