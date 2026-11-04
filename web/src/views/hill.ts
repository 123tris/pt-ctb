// King of the hill, a tab of Challenges (/challenges/hill), as assets/js/pages/hill.js draws it: this month's pool and
// who holds each crown, the crown table (all time or one season) and the past months. From hill.json
// (tools/lib/hill.mjs), which Challenges only shows the tab for once the export has it, with players from the core
// pack. ?season=2026-Q4 opens the crown table on that season; ?tier=challenger shows that tier first on phones.
// hill.mount.ts handles the season and tier choices.

import { html, raw, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { M, HILL_SLOTS, HILL_TIERS, HILL_MOD_STARS, sharedRanks } from '../kernel/model.ts';
import { chipGroup, empty } from '../ui/page.ts';
import { avatarUrl, isInactive, playerLink, rowOf, statusTag, type Players } from '../ui/players.ts';
import { cover, mapText, starsBadge, type MapMeta } from '../ui/maps.ts';
import { modsBadges } from '../ui/scores.ts';
import { andList, lisbonDay, monthLabel, nextMonthLabel, seasonLabel, slotName, slotTally, tierName, titleName } from '../ui/hill.ts';
import { challengeChips, type Running } from '../ui/challenge-chips.ts';

/** Who holds a slot's crown: the player (and the name the bot knows them by), their hill score and the play. */
export interface Holder {
  u: number;
  name: string;
  score?: number;
  mods?: number;
  time?: number;
  /** The play on osu!, when known. */
  url?: string;
}

/** A slot of a month's pool: its map, the holder, and how many snipes it saw. */
export interface Slot {
  slot: string;
  tier: string;
  map: number;
  /** HR and DT slots' stars with the mod, as the bot works them out. */
  stars?: number;
  holder: Holder | null;
  snipes?: number;
}

/** A closed month: its pool as it ended and its King(s) of the hill, with how many crowns they kept. */
export interface Month {
  month: string;
  end: number;
  kings: number[];
  most: number;
  pool: Slot[];
}

/** A season (a calendar quarter): each slot's king(s), the All-rounders, and whether it's over. */
export interface Season {
  id: string;
  final: boolean;
  kings: Record<string, number[]>;
  allRounders: number[];
}

/** hill.json. `players`: everyone with a crown, most first: [id, name, total, per slot, { season: per slot }]. */
export interface Hill {
  current: {
    month: string;
    end: number;
    status: 'live' | 'draft';
    pool: Slot[];
    leaders: { players: number[]; held: number } | null;
  } | null;
  months: Month[];
  seasons: Season[];
  players: [number, string, number, number[], Record<string, number[]>][];
  maps: Record<string, MapMeta>;
}

export interface State {
  /** 'all' or a season's id. */
  scope: string;
  /** The tier phones show first. */
  tier: string;
}

/** The season picker is chips up to this many choices (DESIGN.md §9), a select past that. */
export const SCOPE_CHIPS = 5;

/** The tab's line under the tab strip. */
export const intro = ({ t, th }: Ctx): Safe => th('A pool of maps each month, one per slot, in an Open and an easier Challenger tier (from November 2026: 6–9★ and 4.5–6.5★). Hold a map’s best play when the month ends to keep its crown. {more}', {
  more: html`<a href="/glossary?at=crown">${t('How crowns work')}</a>`,
});

/** The crown table's choices: all time, then each season, newest first ("so far" while it runs). */
export const scopes = (ctx: Ctx, hill: Hill): [string, string][] => [['all', ctx.t('All time')],
  ...hill.seasons.map((s): [string, string] => [s.id, s.final ? seasonLabel(ctx, s.id) : ctx.t('{season}, so far', { season: seasonLabel(ctx, s.id) })])];

/** The season and tier from the address; anything unknown is the default. */
export function readState(ctx: Ctx, hill: Hill, query: Record<string, string | undefined>): State {
  return {
    scope: scopes(ctx, hill).some(([id]) => id === query.season) ? query.season! : 'all',
    tier: (HILL_TIERS as string[]).includes(query.tier ?? '') ? query.tier! : 'open',
  };
}

/**
 * A player in the hill's lists, linked: their row in the core pack, or (as ui/players.ts playerLinkId() draws someone
 * the site doesn't list) osu!'s avatar and the name the bot gave.
 */
function who(ctx: Ctx, players: Players, id: number, name: string, cls = ''): Safe {
  const row = rowOf(players, id);
  if (row >= 0) return playerLink(ctx, players, row, cls);
  const size = cls === 'avatar-sm' ? 22 : 32;
  return html`<a class="player" href="/player/${id}"><img class="avatar ${cls}" src="${avatarUrl(id)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" data-hide-broken><span>${name || `#${id}`}</span></a>`;
}
/** A player's name: the core pack's, the bot's, or #id. */
const whoName = (players: Players, id: number, name: string) => {
  const row = rowOf(players, id);
  return row >= 0 ? players.name.at(row) : name || `#${id}`;
};
/** A player's name as a plain link, for names in running text and the past months' tables (no avatar to line up). */
const nameLink = (players: Players, id: number, name: string): Safe => html`<a class="hill-name" href="/player/${id}">${whoName(players, id, name)}</a>`;
/** Names in a sentence: "A, B and C", each linked. */
const names = (ctx: Ctx, players: Players, ids: readonly number[]): Safe => andList(ctx, ids.map(id => nameLink(players, id, '')));

/** The stars a slot's map shows: HR and DT slots' with the mod (the bot's), the others' nomod. */
const slotStars = (s: Slot, maps: Record<string, MapMeta>): number =>
  ((HILL_MOD_STARS as string[]).includes(s.slot) && s.stars ? s.stars : maps[s.map]?.[M.STARS] ?? 0);

/** "Open · 6.2–7.8★": a tier with the stars its maps span. */
function tierHead(ctx: Ctx, tier: string, pool: readonly Slot[], maps: Record<string, MapMeta>): string {
  const { t, fmt } = ctx;
  const stars = pool.filter(s => s.tier === tier).map(s => slotStars(s, maps)).filter(Boolean);
  if (!stars.length) return tierName(ctx, tier);
  const [low, high] = [Math.min(...stars), Math.max(...stars)];
  return t('{tier} · {stars}★', { tier: tierName(ctx, tier), stars: low === high ? fmt.num(low, 1) : `${fmt.num(low, 1)}–${fmt.num(high, 1)}` });
}

/**
 * One slot of one tier: the map (cover, stars, title), then the holder and their hill score, when the play was set
 * (linked to it on osu! when known), the snipes if any, and the chips of the other challenges the map is in. A free slot
 * says "Up for grabs", or "Nobody kept this crown" once the month is over (`closed`).
 */
function slotCell(ctx: Ctx, s: Slot | undefined, maps: Record<string, MapMeta>, players: Players, closed: boolean, running: Running | null): Safe {
  const { t, fmt } = ctx;
  if (!s) return html`<div class="hill-cell"></div>`;
  const meta = maps[s.map];
  const { title, sub } = mapText(ctx, s.map, meta);
  const h = s.holder;
  const when = h?.time ? (closed ? fmt.date(h.time) : fmt.ago(h.time)) : '';
  const chips = running ? challengeChips(ctx, s.map, running, 'hill') : [];
  return html`<div class="hill-cell" data-tier="${s.tier}">
    <a class="map" href="/map/${s.map}">
      ${cover(meta, 'list', 'map-cover hill-cover')}
      <span class="map-title" title="${title} ${sub}">${starsBadge(ctx, slotStars(s, maps))} ${title} <span class="map-sub">${sub}</span></span>
    </a>
    <div class="hill-holder">${h ? html`
      ${who(ctx, players, h.u, h.name, 'avatar-sm')}
      ${h.score !== undefined ? html`<span class="hill-score">${fmt.num(h.score)}</span>` : ''}
      ${['FM', 'CV'].includes(s.slot) && h.mods ? modsBadges(h.mods) : ''}
      ${when ? (h.url ? html`<a class="dim-link" href="${h.url}" target="_blank" rel="noopener" title="${t('This play on osu!')}">${when}</a>`
        : html`<span class="faint" title="${fmt.dateTime(h.time!)}">${when}</span>`) : ''}`
      : closed ? html`<span class="faint">${t('Nobody kept this crown')}</span>` : html`<span class="hill-free">${t('Up for grabs')}</span>`}
      ${s.snipes ? html`<span class="faint">${fmt.plural(s.snipes, 'snipe')}</span>` : ''}
      ${chips}
    </div>
  </div>`;
}

/**
 * A pool as one list of six rows, NM to Convert, with the Open and Challenger cells side by side under a line naming
 * each tier and its stars. On phones one tier shows at a time (`tier`, chosen with the chips above it).
 */
function poolGrid(ctx: Ctx, pool: readonly Slot[], maps: Record<string, MapMeta>, players: Players,
  { closed = false, running = null, tier = 'open' }: { closed?: boolean; running?: Running | null; tier?: string } = {}): Safe {
  const at = (slot: string, x: string) => pool.find(s => s.slot === slot && s.tier === x);
  return html`<div class="hill-pool" data-show="${tier}">
    <div class="hill-tiers" aria-hidden="true"><span></span>${HILL_TIERS.map(x => html`<span data-tier="${x}">${tierHead(ctx, x, pool, maps)}</span>`)}</div>
    <div class="rows">${HILL_SLOTS.filter(slot => HILL_TIERS.some(x => at(slot, x))).map(slot => html`<div class="row hill-row">
      <span class="hill-slot">${slotName(ctx, slot)}</span>
      ${HILL_TIERS.map(x => html`<div class="hill-tier-cell" data-tier="${x}"><span class="sr-only">${tierName(ctx, x)}: </span>${slotCell(ctx, at(slot, x), maps, players, closed, running)}</div>`)}
    </div>`)}</div>
  </div>`;
}

/** The status line with a leader, or several tied: whole sentences, as the verb agrees in both languages. */
const LEADS = /* i18n */ {
  one: '{left} · {held} of {total} crowns taken · {players} leads with {crowns}',
  many: '{left} · {held} of {total} crowns taken · {players} lead with {crowns}',
};

/** "29 days left" or "5 hours left". */
function leftWords(ctx: Ctx, end: number): string {
  const { tn } = ctx;
  const left = end - ctx.now();
  if (left >= 86400) return tn(Math.floor(left / 86400), '{n} day left', '{n} days left');
  const hours = Math.max(1, Math.floor(left / 3600));
  return tn(hours, '{n} hour left', '{n} hours left');
}

/**
 * This month: one line on where it stands (time left, crowns taken, who leads), then its pool. Once its end has passed
 * and before the bot settles it, the line says so and the free slots read as kept by nobody.
 */
function currentSection(ctx: Ctx, current: Hill['current'], maps: Record<string, MapMeta>, players: Players, running: Running, tier: string): Safe {
  const { t, th, fmt } = ctx;
  if (!current) return html`<section class="section"><div class="section-head"><h2>${t('This month')}</h2></div>
    ${empty(t('The next pool appears here when the month starts.'))}</section>`;
  if (current.status === 'draft') return html`<section class="section"><div class="section-head"><h2>${monthLabel(ctx, current.month)}</h2></div>
    ${empty(t('This month’s pool is being picked. It shows here once a moderator approves it.'))}</section>`;
  const ended = current.end <= ctx.now();
  const held = current.pool.filter(s => s.holder).length;
  const { leaders } = current;
  const crowns = leaders && (leaders.players.length > 1 ? t('{crowns} each', { crowns: fmt.plural(leaders.held, 'crown') }) : fmt.plural(leaders.held, 'crown'));
  const counts = { held: fmt.num(held), total: fmt.num(current.pool.length) };
  return html`<section class="section">
    <div class="section-head"><h2>${monthLabel(ctx, current.month)}</h2></div>
    ${ended ? html`
      <p class="hill-lead">${t('Ended {date} · {held} of {total} crowns kept', { date: lisbonDay(ctx, current.end - 1), ...counts })}</p>
      <p class="hill-lead-sub">${leaders ? th('Most crowns (final after the bot’s next update): {players} with {crowns}.', { players: names(ctx, players, leaders.players), crowns }) : ''}
        ${t('{month}’s pool appears after that.', { month: nextMonthLabel(ctx, current.month) })}</p>`
    : html`<p class="hill-lead">${leaders
      ? th(LEADS[leaders.players.length > 1 ? 'many' : 'one'], {
        left: leftWords(ctx, current.end), ...counts, players: names(ctx, players, leaders.players), crowns,
      })
      : t('{left} · {held} of {total} crowns taken', { left: leftWords(ctx, current.end), ...counts })}</p>
      <p class="hill-lead-sub">${t('Ends {date}, Lisbon time.', { date: lisbonDay(ctx, current.end - 1) })}</p>`}
    <div class="hill-pick">${chipGroup(t('Tier'), 'tier', HILL_TIERS.map((x): [string, Value] => [x, tierName(ctx, x)]), tier)}</div>
    ${poolGrid(ctx, current.pool, maps, players, { closed: ended, running: ended ? null : running, tier })}
  </section>`;
}

/** A crown table's row: [id, name, crowns, per slot]. */
type CrownRow = [number, string, number, number[]];

/** The crown table's rows for a scope ('all' or a season id), most first. */
export function tableRows(hill: Hill, scope: string): CrownRow[] {
  if (scope === 'all') return hill.players.map(([id, name, total, slots]) => [id, name, total, slots]);
  return hill.players.filter(p => p[4][scope]).map(([id, name, , , seasons]): CrownRow => [id, name, seasons[scope].reduce((a, b) => a + b, 0), seasons[scope]])
    .sort((a, b) => b[2] - a[2] || a[0] - b[0]);
}

/** Who holds which title in a season: each slot's king(s) and the All-rounders. */
export function seasonTitles(ctx: Ctx, season: Season, players: Players): Safe {
  const items: [string, number[]][] = [
    ...HILL_SLOTS.filter(slot => season.kings[slot]).map((slot): [string, number[]] => [titleName(ctx, { kind: 'slot', slot }), season.kings[slot]]),
    ...(season.allRounders.length ? [[ctx.t('All-rounder'), season.allRounders] as [string, number[]]] : []),
  ];
  return html`<ul class="badge-list hill-titles">${items.map(([name, ids]) => html`<li><b>${name}</b><span>${names(ctx, players, ids)}</span></li>`)}</ul>`;
}

/**
 * The crown table: everyone with a crown in the scope, most first, tied counts sharing a rank. Gold only for a sole #1;
 * a season's slot king is in bold.
 */
export function crownTable(ctx: Ctx, rows: readonly CrownRow[], season: Season | null, players: Players): Safe {
  const { t, fmt } = ctx;
  if (!rows.length) return empty(t('No crowns yet.'));
  const ranks: number[] = sharedRanks(rows.map(r => r[2]));
  const soleFirst = ranks.filter(r => r === 1).length === 1;
  return html`<div class="table-wrap" data-label="${t('Crown table')}"><table class="hill-table">
    <thead><tr><th>#</th><th>${t('Player')}</th><th class="num">${t('Crowns')}</th>${HILL_SLOTS.map(slot => html`<th class="num col-opt">${slotName(ctx, slot)}</th>`)}</tr></thead>
    <tbody>${rows.map(([id, name, total, slots], i) => {
      const row = rowOf(players, id);
      const tag = row >= 0 ? statusTag(ctx, players, row) : '';
      return html`<tr class="${id === ctx.me ? 'me' : ''} ${row >= 0 && isInactive(ctx, players, row) ? 'inactive' : ''}">
        <td class="rank ${soleFirst && ranks[i] === 1 ? 'king-rank' : ''}">${ranks[i]}</td>
        <td class="cell-player">${who(ctx, players, id, name)}${tag ? html` ${tag}` : ''}<span class="cell-sub">${slotTally(ctx, slots)}</span></td>
        <td class="num king-count">${fmt.num(total)}</td>
        ${HILL_SLOTS.map((slot, k) => {
          const king = season?.kings[slot]?.includes(id);
          return html`<td class="num col-opt ${king ? 'hill-king' : ''}">${slots[k] ? fmt.num(slots[k]) : html`<span class="faint">—</span>`}${king ? html`<span class="sr-only"> (${titleName(ctx, { kind: 'slot', slot })})</span>` : ''}</td>`;
        })}
      </tr>`;
    })}</tbody>
  </table></div>`;
}

/** The line over the crown table: how many players have a crown in the scope ('' for none). */
export const countText = (ctx: Ctx, rows: readonly CrownRow[]): string =>
  (rows.length ? ctx.t('{players} with a crown', { players: ctx.fmt.plural(rows.length, 'player') }) : '');

/**
 * A closed month in brief: its King(s) of the hill as a sentence, then who kept each slot's crown in each tier, a fixed
 * table (like Star kings) whose names end in "…" rather than run into the next column.
 */
function pastMonth(ctx: Ctx, m: Month, players: Players): Safe {
  const { t, th, fmt } = ctx;
  const kept = (slot: string, tier: string) => m.pool.find(s => s.slot === slot && s.tier === tier);
  const holder = (s: Slot | undefined) => (s?.holder ? nameLink(players, s.holder.u, s.holder.name) : html`<span class="faint">—</span>`);
  // A tier nobody kept a crown in that month (all "—") gets no column.
  const tiers = HILL_TIERS.filter(tier => m.pool.some(s => s.tier === tier && s.holder));
  return html`<div class="hill-month">
    <h3 class="hill-month-h">${monthLabel(ctx, m.month)}</h3>
    <p class="muted small">${m.kings.length ? th('{title}: {players} with {crowns}', {
      title: t('King of the hill'), players: names(ctx, players, m.kings),
      crowns: m.kings.length > 1 ? t('{crowns} each', { crowns: fmt.plural(m.most, 'crown') }) : fmt.plural(m.most, 'crown'),
    }) : t('No crowns given')}</p>
    <div class="table-wrap"><table class="table-compact hill-kept">
      <thead><tr><th class="col-slot"><span class="sr-only">${t('Slot')}</span></th>${tiers.map(tier => html`<th>${tierName(ctx, tier)}</th>`)}</tr></thead>
      <tbody>${HILL_SLOTS.filter(slot => tiers.some(tier => kept(slot, tier))).map(slot => html`<tr>
        <th scope="row">${slotName(ctx, slot)}</th>${tiers.map(tier => html`<td><span class="cell-line">${holder(kept(slot, tier))}</span></td>`)}
      </tr>`)}</tbody>
    </table></div>
  </div>`;
}

/** The tab's panel. `running` is what else is on (ui/challenge-chips.ts runningNow), for the pool's chips. */
export function render(ctx: Ctx, hill: Hill, players: Players, running: Running, state: State): Safe {
  const { t } = ctx;
  const { current, months, seasons, maps } = hill;
  const choices = scopes(ctx, hill);
  const season = seasons.find(s => s.id === state.scope) ?? null;
  const rows = tableRows(hill, state.scope);
  return html`
    ${currentSection(ctx, current, maps, players, running, state.tier)}
    <section class="section">
      <div class="section-head"><h2>${t('Crown table')}</h2></div>
      ${choices.length > SCOPE_CHIPS ? html`<div class="toolbar"><label class="hill-scope-label" for="hill-scope">${t('Crowns from')}</label>
        <select class="select" id="hill-scope">${choices.map(([id, label]) => html`<option value="${id}" ${id === state.scope ? raw('selected') : ''}>${label}</option>`)}</select></div>`
        : choices.length > 1 ? html`<div class="toolbar" id="hill-scopes">${chipGroup(t('Crowns from'), 'scope', choices, state.scope)}</div>` : ''}
      <div id="hill-titles">${season ? seasonTitles(ctx, season, players) : ''}</div>
      <p class="result-count" id="hill-count">${countText(ctx, rows)}</p>
      <div id="hill-table">${crownTable(ctx, rows, season, players)}</div>
    </section>
    ${months.length ? html`<section class="section">
      <div class="section-head"><h2>${t('Past months')}</h2></div>
      <div class="hill-months">${months.map(m => pastMonth(ctx, m, players))}</div>
    </section>` : ''}`;
}
