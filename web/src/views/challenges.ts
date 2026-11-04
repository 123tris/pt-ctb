// The Challenges page (/challenges/:tab?), as assets/js/pages/challenges.js draws it: seven tabs with their own addresses
// (week, hill, duels, dan, targets, bounties, completion), each with where that challenge stands right now in the tab
// strip. "Dan" keeps the community's own word. The week, the month's King of the hill and the bounties are what's on
// now: a map in more than one of them carries the others' chips (ui/challenge-chips.ts), here and on its map page.
//
// challenges.json and bounties.json come on every tab, for the tabs' figures and chips, with meta.json's King of the
// hill month, duels and completion goal in brief; each other tab adds its own file. Players come from the core pack.
// The week and the snipe targets are drawn here, the other tabs by their own views (dan.ts, hill.ts, duels.ts,
// bounties.ts, completion.ts). render() is pure; the browser half is challenges.mount.ts.

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { M, S } from '../kernel/model.ts';
import { empty, pageHead, tabs } from '../ui/page.ts';
import { playerLinkId, ppText, type Players } from '../ui/players.ts';
import { bannerArt, mapLink, mapText, osuMap, starsBadge, type MapMeta } from '../ui/maps.ts';
import { catChip, posBadge, scoreStats, scoreWhen, type Cat, type Play } from '../ui/scores.ts';
import { passCounts, topStage } from '../ui/ladder.ts';
import { danName } from '../ui/events.ts';
import { timeLeft } from '../ui/hill.ts';
import { runningNow, challengeChips, type Running } from '../ui/challenge-chips.ts';
import { experimentalTag, type DuelsBrief, type DuelsFile } from '../ui/duels.ts';
import * as dan from './dan.ts';
import * as hill from './hill.ts';
import * as duels from './duels.ts';
import * as bounties from './bounties.ts';
import * as completion from './completion.ts';

export type Slug = 'week' | 'hill' | 'duels' | 'dan' | 'targets' | 'bounties' | 'completion';
export const SLUGS: readonly Slug[] = ['week', 'hill', 'duels', 'dan', 'targets', 'bounties', 'completion'];

/** A play on a board: [player, ...play]. */
type BoardRow = [number, ...unknown[]];

/** The map of the week: its board this week (`weekly`) and all time, best first. */
export interface Week {
  /** "2026-W45". */
  id: string;
  end: number;
  map: number;
  cat: Cat;
  board: BoardRow[];
  weekly: BoardRow[];
}

/** challenges.json. */
export interface Challenges {
  week: Week | null;
  /** #1s up for grabs: [map, cat, players, [holder, ...play]]. */
  beatable: [number, Cat, number, BoardRow][];
  /** Hard maps with one Portuguese player: [map, cat, [player, ...play]]. */
  lonely: [number, Cat, BoardRow][];
  /** Popular maps nobody here has played: [map, osu! plays, favourites]. */
  unclaimed: [number, number, number][];
  maps: Record<string, MapMeta>;
  /** The wanted list, in data from before bounties.json. */
  bounties?: bounties.Wanted[];
}

/**
 * What the page reads of meta.json: when the data was made, which files it has, and King of the hill's month, the
 * duels and the goal in brief.
 */
export interface SiteBrief {
  generatedAt: number;
  files?: Record<string, string>;
  completion?: { cleared: number; total: number } | null;
  week?: { map: number; end: number } | null;
  hill?: { status?: string; end: number; pool: Running['hill'] } | null;
  duels?: DuelsBrief | null;
}

export interface Data {
  core: CorePack;
  challenges: Challenges;
  /** bounties.json, or null in data from before it. */
  board: bounties.Board | null;
  site: SiteBrief;
  /** Each tab's own file, loaded only for that tab: dan.json, completion.json (null before it), hill.json, duels.json. */
  dan: dan.Dan | null;
  completion: completion.Completion | null;
  hill: hill.Hill | null;
  duels: DuelsFile | null;
  /** economy.json on the Bounties tab, once the bot has started Bananas. */
  economy: bounties.Economy | null;
  /** Signing in works on this address (bananas.js signInHere()). */
  signInHere: boolean;
}

export interface State {
  tab: Slug;
  /** The tabs there are: King of the hill and Duels only once the export has hill.json and duels.json (the bot started them). */
  shown: Slug[];
  query: Record<string, string | undefined>;
}

/** The tab asked for, or the first for one there isn't. */
export function readState(data: Data, params: Record<string, string | undefined>, query: Record<string, string | undefined>): State {
  const shown = SLUGS.filter(slug => (slug !== 'hill' || data.site.files?.['hill.json']) && (slug !== 'duels' || data.site.files?.['duels.json']));
  return { tab: shown.find(slug => slug === params.tab) ?? shown[0], shown, query };
}

const labels = ({ t }: Ctx): Record<Slug, string> => ({
  week: t('This week'), hill: t('King of the hill'), duels: t('Duels'), dan: t('Dan course'), targets: t('Snipe targets'), bounties: t('Bounties'), completion: t('Completion'),
});

/** The line under the tab strip: what the tab is. */
function intro(ctx: Ctx, slug: Slug): Value {
  const { t, th } = ctx;
  switch (slug) {
    case 'week': return th('A new map every Monday. The community votes for the next one on Discord; the week’s best plays and the vote are on {activity}.', { activity: html`<a href="/activity?view=week">${t('Activity')}</a>` });
    case 'hill': return hill.intro(ctx);
    case 'duels': return duels.intro(ctx);
    case 'dan': return dan.intro(ctx);
    case 'targets': return t('#1s that are begging to be sniped, maps with a single Portuguese player, and maps nobody in Portugal has played yet.');
    case 'bounties': return bounties.intro(ctx);
    case 'completion': return completion.intro(ctx);
  }
}

export const title = (ctx: Ctx, state: State): string =>
  (state.tab === 'week' ? ctx.t('Challenges') : `${labels(ctx)[state.tab]} · ${ctx.t('Challenges')}`);

/** What's on now, for the chips: the map of the week, the hill's month (meta.json) and the open bounties. */
export const running = (ctx: Ctx, data: Data): Running =>
  runningNow({ challenges: data.challenges, meta: data.site, bounties: data.board }, ctx.now());

/**
 * Each tab's figure: the map of the week's time left, the month's, duels being played, Portugal's highest Dan, #1s up
 * for grabs, open bounties, the share cleared.
 */
function figures(ctx: Ctx, data: Data): Partial<Record<Slug, string>> {
  const { t, fmt } = ctx;
  const { week } = data.challenges;
  const left = week ? Math.max(0, week.end - ctx.now()) : 0;
  const top = topStage(passCounts(data.core.players));
  const month = data.site.hill;
  const goal = data.site.completion;
  const live = data.site.duels?.live;
  return {
    week: week ? (left >= 86400 ? t('{n}d left', { n: Math.floor(left / 86400) }) : t('{n}h left', { n: Math.floor(left / 3600) })) : undefined,
    hill: month?.status === 'live' ? timeLeft(ctx, month.end) : undefined,
    duels: live ? t('{n} live', { n: fmt.num(live) }) : undefined,
    dan: top >= 0 ? danName(ctx, top) : undefined,
    targets: fmt.num(data.challenges.beatable.length),
    bounties: data.board ? fmt.num(data.board.open.length) : undefined,
    completion: goal?.total ? `${fmt.num((goal.cleared / goal.total) * 100, 1)}%` : undefined,
  };
}

/** The time left until `end`: "2d 05h 09m 03s". */
export function countdown(ctx: Ctx, end: number): string {
  const left = Math.max(0, end - ctx.now());
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = Math.floor(left % 60);
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

/** On phones: rank, player (with the play under the name) and pp; score, play and time are desktop columns. */
function boardTable(ctx: Ctx, rows: readonly BoardRow[], players: Players, label: string): Safe {
  const { t, fmt } = ctx;
  return html`<div class="table-wrap" data-label="${label}"><table class="table-compact">
    <thead><tr><th>#</th><th>${t('Player')}</th><th class="num col-opt">${t('Score')}</th><th class="col-opt">${t('Play')}</th><th class="num">pp</th><th class="num col-opt">${t('When')}</th></tr></thead>
    <tbody>${rows.map(([uid, ...rest], i) => {
      const s = rest as Play;
      return html`<tr class="${uid === ctx.me ? 'me' : ''}">
      <td>${posBadge(ctx, i + 1)}</td>
      <td class="cell-player">${playerLinkId(ctx, players, uid, 'avatar-sm')}<span class="cell-sub"><span class="score-line">${scoreStats(ctx, s)}</span></span></td>
      <td class="num col-opt">${fmt.num(s[S.SCORE])}</td>
      <td class="col-opt"><span class="score-line">${scoreStats(ctx, s)}</span></td><td class="num">${ppText(ctx, s[S.PP])}</td>
      <td class="num faint col-opt">${scoreWhen(ctx, s, fmt.ago(s[S.TIME]))}</td>
    </tr>`;
    })}</tbody>
  </table></div>`;
}

/** The map of the week: its banner with the countdown, then this week's plays and the all-time top 10. */
function weekSection(ctx: Ctx, week: Week | null, maps: Record<string, MapMeta>, players: Players, now: Running): Safe {
  const { t, th } = ctx;
  if (!week) return empty(t('No map of the week yet.'));
  const meta = maps[week.map];
  const { title, sub } = mapText(ctx, week.map, meta);
  return html`
    <section class="banner">
      ${bannerArt(meta?.[M.SET])}
      <div class="banner-body">
        <div class="links">
          <span class="badge badge-accent">${t('Week {n}', { n: week.id.split('-W')[1] })}</span>
          ${catChip(ctx, week.cat)} ${meta ? starsBadge(ctx, meta[M.STARS]) : ''} ${challengeChips(ctx, week.map, now, 'week')}
        </div>
        <h3 class="banner-title"><a href="/map/${week.map}">${title}</a></h3>
        <div class="sub">${sub}</div>
        <p class="m-0 mt-3">${th('Ends in {countdown}', { countdown: html`<span class="countdown" id="countdown">${countdown(ctx, week.end)}</span>` })}</p>
      </div>
    </section>
    <div class="mt-3 mb-6 btn-row">
      <a class="btn btn-primary" href="${osuMap(week.map)}" target="_blank" rel="noopener">${t('Open on osu!')} ↗</a>
      <a class="btn" href="/map/${week.map}">${t('Full leaderboard')}</a>
    </div>
    <div class="section-head"><h2>${t('This week’s plays')}</h2></div>
    ${week.weekly.length ? boardTable(ctx, week.weekly, players, t('This week’s plays on the map of the week')) : empty(t('Nobody has played this map this week. Be the first!'))}
    <div class="mt-6 section-head"><h2>${t('All-time top')}</h2></div>
    ${boardTable(ctx, week.board.slice(0, 10), players, t('All-time top 10 on the map of the week'))}`;
}

const weekPanel = (ctx: Ctx, data: Data, now: Running): Safe => html`
    <section>
      <div class="section-head"><h2>${ctx.t('Map of the week')}</h2></div>
      ${weekSection(ctx, data.challenges.week, data.challenges.maps, data.core.players, now)}
    </section>`;

/** Vulnerable #1s, maps with one Portuguese player, and popular maps nobody here has played. */
function targetsPanel(ctx: Ctx, data: Data): Safe {
  const { t, fmt } = ctx;
  const { beatable, lonely, unclaimed, maps } = data.challenges;
  const players = data.core.players;
  return html`
    <section>
      <div class="section-head"><h2>${t('Vulnerable #1s')}</h2><span class="muted small">${t('Contested maps where the #1 has misses or under 97% accuracy.')}</span></div>
      ${beatable.length ? html`<div class="rows">${beatable.map(([id, cat, n, [uid, ...rest]]) => {
        const s = rest as Play;
        return html`<div class="row">
        <div>${mapLink(ctx, id, maps[id])}</div>
        <div class="row-meta">${catChip(ctx, cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span class="faint">#1</span> ${playerLinkId(ctx, players, uid, 'avatar-sm')} ${scoreStats(ctx, s, { combo: false })} ${ppText(ctx, s[S.PP])}</div>
      </div>`;
      })}</div>` : empty(t('Every #1 is well defended. For now.'))}
    </section>

    <section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('One-player maps')}</h2></div>
        <p class="muted small">${t('Hard maps (5★ and up; loved and unranked ones under 10★) with a single Portuguese player. Just pass to take #2, or beat them for #1.')}</p>
        ${lonely.length ? html`<div class="rows">${lonely.map(([id, cat, [uid, ...rest]]) => html`<div class="row-1col row">
          ${mapLink(ctx, id, maps[id])}
          <div class="justify-start row-meta">${catChip(ctx, cat)} ${playerLinkId(ctx, players, uid, 'avatar-sm')} ${ppText(ctx, (rest as Play)[S.PP])}</div>
        </div>`)}</div>` : empty(t('No one-player maps.'))}
      </div>
      <div>
        <div class="section-head"><h2>${t('Unclaimed')}</h2></div>
        <p class="muted small">${t('Popular ranked osu!catch maps with no Portuguese score recorded.')}</p>
        ${unclaimed.length ? html`<div class="rows">${unclaimed.map(([id, plays, favs]) => html`<div class="row-1col row">
          ${mapLink(ctx, id, maps[id])}
          <div class="justify-start row-meta">${t('{plays} plays on osu! · {favs} favourites', { plays: fmt.num(plays), favs: fmt.num(favs) })}</div>
        </div>`)}</div>` : empty(t('Nothing left to claim. Impressive.'))}
      </div>
    </section>`;
}

/** The tab's panel. */
function panel(ctx: Ctx, data: Data, state: State, now: Running): Value {
  const players = data.core.players;
  switch (state.tab) {
    case 'week': return weekPanel(ctx, data, now);
    case 'targets': return targetsPanel(ctx, data);
    case 'bounties': return bounties.render(ctx, bountiesData(ctx, data, now));
    case 'hill': return data.hill ? hill.render(ctx, data.hill, players, now, hill.readState(ctx, data.hill, state.query)) : '';
    case 'duels': return data.duels ? duels.render(ctx, data.duels, players, data.site.generatedAt, duels.readState(state.query)) : '';
    case 'dan': return data.dan ? dan.render(ctx, data.dan, players, dan.readStage(data.dan, state.query)) : '';
    case 'completion': return completion.render(ctx, data.completion, players, completion.readState(ctx, data.completion, state.query));
  }
}

/** The Bounties tab's data, from the page's. */
export const bountiesData = (ctx: Ctx, data: Data, now = running(ctx, data)): bounties.Data => ({
  players: data.core.players, board: data.board, challenges: data.challenges, economy: data.economy, running: now, signInHere: data.signInHere,
});

export function render(ctx: Ctx, data: Data, state: State): Safe {
  const { t } = ctx;
  const names = labels(ctx);
  const counts = figures(ctx, data);
  return html`
    ${pageHead({ title: t('Challenges') })}
    ${tabs(state.shown.map(slug => ({
      href: `/challenges/${slug}`, label: slug === 'duels' ? html`${names[slug]} ${experimentalTag(ctx)}` : names[slug], count: counts[slug], active: slug === state.tab,
    })), t('Challenges'))}
    <p class="muted tabs-intro">${intro(ctx, state.tab)}</p>
    <div id="panel">${panel(ctx, data, state, running(ctx, data))}</div>
  `;
}
