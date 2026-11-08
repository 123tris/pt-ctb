// The Leaderboards' Mods and Top plays tabs (/rankings/mods, /rankings/plays), as assets/js/pages/rankings.js draws
// them: weighted pp by mod, and Portugal's best single plays, each filtered by where the plays come from and by mods.
// From modrankings.json and topplays.json, with players from the core pack. render() draws the page for the address's
// choices; boards.mount.ts redraws the board as the chips change and filters it by name.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { S, parseModFilter, topPlaysView } from '../kernel/model.ts';
import { chipGroup, empty, dataTable, col } from '../ui/page.ts';
import { playerLinkId, ppText, rowOf } from '../ui/players.ts';
import { mapLink, type MapMeta } from '../ui/maps.ts';
import { catChip, modsBadges, posBadge, scoreStats, type Cat, type Play } from '../ui/scores.ts';
import { head, greyed, tag } from './rankings.ts';

/** modrankings.json: per source and mod, [player, weighted pp, plays, best play] best first; and the maps. */
export interface ModRankings {
  filters: string[];
  sources: Record<string, Record<string, [number, number, number, Play][]>>;
  maps: Record<string, MapMeta>;
}

/** topplays.json: [player, category, ...play] best first, the mod filters, how many a view shows, and the maps. */
export interface TopPlays {
  filters: string[];
  plays: [number, Cat, ...unknown[]][];
  cap: number;
  maps: Record<string, MapMeta>;
}

export type Data =
  | { slug: 'mods'; core: CorePack; mods: ModRankings }
  | { slug: 'plays'; core: CorePack; plays: TopPlays | null };

export interface State {
  q: string;
  legends: boolean;
  source: string;
  mod: string;
}

/** The top plays' mod choice for no filter at all. */
export const ANY = 'Any';
const SOURCES = ['r', 'c', 'u'];
export const sources = (ctx: Ctx): [string, string][] => [['r', ctx.t('Ranked')], ['c', ctx.t('Converts')], ['u', ctx.t('Loved & Unranked')]];
const defaultMod = (slug: Data['slug']) => (slug === 'plays' ? ANY : 'HD');

/** The mods the chips offer. */
export const modChoices = (data: Data): string[] =>
  (data.slug === 'mods' ? data.mods.filters : data.plays ? [ANY, ...data.plays.filters] : []);

/** The address's choices, or the defaults (Ranked, and HD or any mods). */
export function readState(data: Data, query: Record<string, string | undefined>): State {
  const source = SOURCES.includes(query.src ?? '') ? query.src! : 'r';
  const mods = modChoices(data);
  return { q: query.q || '', legends: query.legends !== '0', source, mod: mods.includes(query.mod ?? '') ? query.mod! : defaultMod(data.slug) };
}

/** Defaults left out of the address. */
export const queryDefaults = (data: Data) => ({ src: 'r', mod: defaultMod(data.slug) });

/** How a player is marked on a board: greyed, and a tag ("legend", "inactive"); nothing for someone not on the site. */
function mark(ctx: Ctx, core: CorePack, id: number, official: boolean): { greyed: boolean; tag: Safe | '' } {
  const row = rowOf(core.players, id);
  return row < 0 ? { greyed: false, tag: '' } : { greyed: greyed(ctx, core.players, row, official), tag: tag(ctx, core.players, row, official) };
}

const nameOf = (core: CorePack, id: number) => {
  const row = rowOf(core.players, id);
  return row < 0 ? '' : core.players.name.at(row).toLowerCase();
};

function modsTable(ctx: Ctx, core: CorePack, mods: ModRankings, state: State): Safe {
  const { t, fmt } = ctx;
  const rows = mods.sources[state.source]?.[state.mod] ?? [];
  if (!rows.length) return empty(t('Nobody has plays with this mod combination.'));
  const official = state.source === 'r';
  const head = [col('#'), col(t('Player')), col(t('Weighted pp'), 'num'), col(t('Plays'), 'num col-opt'), col(t('Best play'), 'col-opt'), col('pp', 'num col-opt')];
  return dataTable(t('{mod} leaderboard', { mod: state.mod }), head, rows.map(([id, pp, count, top], i) => {
    const { greyed: grey, tag: label } = mark(ctx, core, id, official);
    const cls = [id === ctx.me ? 'me' : '', grey ? 'inactive' : ''].filter(Boolean).join(' ');
    return html`<tr${cls ? html` class="${cls}"` : ''} data-name="${nameOf(core, id)}">
      <td class="rank">${i + 1}</td>
      <td class="cell-player">${playerLinkId(ctx, core.players, id)}${label ? html` ${label}` : ''}<span class="cell-sub">${fmt.plural(count, 'play')} · ${t('best {pp} pp', { pp: fmt.pp(top[S.PP]) })}</span></td>
      <td class="num">${ppText(ctx, pp)}</td>
      <td class="num col-opt">${fmt.num(count)}</td>
      <td class="wide col-opt">${mapLink(ctx, top[S.MAP], mods.maps[top[S.MAP]])}</td>
      <td class="num col-opt">${modsBadges(top[S.MODS])} ${ppText(ctx, top[S.PP])}</td>
    </tr>`;
  }));
}

/** The top plays: Ranked mixes ranked maps and converts, so each row says which. */
function playsList(ctx: Ctx, core: CorePack, plays: TopPlays, state: State): Safe {
  const { t, fmt } = ctx;
  const rows = topPlaysView(plays.plays, state.source, state.mod === ANY ? null : parseModFilter(state.mod), plays.cap) as TopPlays['plays'];
  if (!rows.length) return empty(t('Nobody has plays with this mod combination.'));
  const official = state.source === 'r';
  return html`<div class="rows">${rows.map(([uid, cat, ...s], i) => {
    const { greyed: grey, tag: label } = mark(ctx, core, uid, official);
    return html`<div class="row ${uid === ctx.me ? 'me' : ''} ${grey ? 'inactive' : ''}" data-name="${nameOf(core, uid)}">
      <div class="row-main">
        ${mapLink(ctx, s[S.MAP] as number, plays.maps[s[S.MAP] as number])}
        <div>${playerLinkId(ctx, core.players, uid, 'avatar-sm')}${label ? html` ${label}` : ''}</div>
      </div>
      <div class="row-meta">
        ${official ? catChip(ctx, cat) : ''}
        ${scoreStats(ctx, s)}
        <span class="sep"></span>
        ${posBadge(ctx, i + 1, t('Place in these top plays'))}
        ${ppText(ctx, s[S.PP] as number)}
        <span class="faint" title="${fmt.dateTime(s[S.TIME] as number)}">${fmt.date(s[S.TIME] as number)}</span>
      </div>
    </div>`;
  })}</div>`;
}

/** The board for the chosen source and mod. */
export const board = (ctx: Ctx, data: Data, state: State): Safe => (data.slug === 'mods'
  ? modsTable(ctx, data.core, data.mods, state)
  : data.plays ? playsList(ctx, data.core, data.plays, state) : empty(ctx.t('The top plays arrive with the next data update.')));

export function render(ctx: Ctx, data: Data, state: State): Safe {
  const { t, fmt } = ctx;
  const filtered = data.slug === 'mods' || Boolean(data.plays);
  const intro = data.slug === 'mods'
    ? t('Weighted pp from plays that include the chosen mod. HDDT counts for HD, DT and HDDT. NF is ignored when filtering: NF counts as NM, HRNF as HR.')
    : t('Portugal’s best single plays, most pp first. Mod filters include NF: NF counts as NM, HRNF as HR.');
  return html`${head(ctx, data.slug)}
    <p class="muted">${intro}</p>
    <div class="toolbar">
      <input class="input" type="search" id="filter" placeholder="${t('Search players…')}" aria-label="${t('Search this leaderboard')}" value="${state.q}">
      ${filtered ? html`<span class="checks"><label><input type="checkbox" id="legends" ${state.legends ? 'checked' : ''}> ${t('Show inactive players')}</label></span>` : ''}
    </div>
    ${filtered ? html`
      <div id="sources" class="mb-2">${chipGroup(t('Plays from'), 'src', sources(ctx), state.source)}</div>
      <div id="modchips" class="mb-4">${chipGroup(t('Mod'), 'mod', modChoices(data).map(f => [f, f === ANY ? t('Any') : f]), state.mod)}</div>` : ''}
    <p class="result-count" id="count"></p>
    <div id="board">${board(ctx, data, state)}</div>
    <div id="board-empty"></div>
    <p class="mt-3 small"><a href="/players">${t('Browse all {n} players', { n: fmt.num(data.core.players.rows) })}</a></p>
  `;
}
