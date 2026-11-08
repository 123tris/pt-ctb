// The top bar's search, its pure half (client/search.ts wires it up): what it finds for a text and how it draws it, as
// assets/js/core/search.js does, with the same results in the same order. Players come from the core pack, maps from
// the header search's own index (search-maps.json, assets/js/core/maps-search.js, whose ranking this shares), and a
// few pages are offered by name ("dan" finds the Dan course, which lives under Challenges).

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { avatar, nameClass, type Players } from './players.ts';
import { setCover, starsBadge } from './maps.ts';
import { tierOf, rankMaps, beatmapIdOf } from '../../../assets/js/core/maps-search.js';

/** How many results the list shows, at most (players give way to pages and maps, but always show two). */
export const LIMIT = 8;

/** A map: [id, setId, artist, title, version, stars, category, players, topPlayerId, mapper] (maps-search.js). */
export type MapRow = [number, number, string, string, string, number, string, number, number | null, string];

/** The maps and the text each is matched on (its lowercased "title artist version mapper"). */
export interface SearchMaps {
  rows: MapRow[];
  hay: string[];
}

export const searchMaps = (rows: MapRow[]): SearchMaps =>
  ({ rows, hay: rows.map(r => `${r[3]} ${r[2]} ${r[4]} ${r[9] ?? ''}`.toLowerCase()) });

/** A page of the site the search offers. */
export interface SitePage {
  name: string;
  href: string;
  detail: string;
  /** Words that find it besides its name, English and Portuguese. */
  words: string;
}

/** Pages the search offers above the players, so "dan" finds the Dan course even though it lives under Challenges. */
export const sitePages = ({ t }: Ctx): SitePage[] => [
  { name: t('Dan course'), href: '/challenges/dan', detail: t('Challenges · 19 stages'), words: 'dan dans course stage stages zeroth aleph shin updatedan claimdanrole curso etapa etapas' },
  { name: t('Map of the week'), href: '/challenges/week', detail: t('Challenges'), words: 'week weekly challenge challenges semana semanal desafio desafios' },
  { name: t('King of the hill'), href: '/challenges/hill', detail: t('Challenges · a crown per slot each month'), words: 'king hill crown crowns koth slot slots pool monthly month cv rei colina coroa coroas mês mensal' },
  { name: t('Snipe targets'), href: '/challenges/targets', detail: t('Challenges'), words: 'snipe snipes sniping targets vulnerable unclaimed alvos' },
  { name: t('Bounties'), href: '/challenges/bounties', detail: t('Challenges · prizes for hard maps'), words: 'bounty bounties wanted prize prizes reward hunter hall fame recompensa recompensas prémio prémios procurado caçador' },
  { name: t('Completion'), href: '/challenges/completion', detail: t('Challenges · ranked maps cleared'), words: 'completion complete cleared clear uncleared progress goal conclusão completar progresso objetivo' },
  { name: t('Glossary'), href: '/glossary', detail: t('pp, FC, mods explained'), words: 'glossary help words meaning new glossário glossario ajuda palavras' },
  { name: t('Records'), href: '/records', detail: t('Biggest combos, most #1s'), words: 'records record recordes recorde' },
  { name: t('Calculator'), href: '/calculator', detail: t('How much pp is a play worth'), words: 'calculator calc pp calculadora' },
  { name: t('How to join'), href: '/join', detail: t('Discord, /verify and playing'), words: 'join verify verification verified role discord new entrar verificar verificação' },
];

/** The pages whose name contains the text or one of whose words starts with it (two at most). */
export function pageMatches(pages: readonly SitePage[], text: string): SitePage[] {
  const q = text.toLowerCase();
  if (q.length < 2) return [];
  return pages.filter(p => p.name.toLowerCase().includes(q) || p.words.split(' ').some(w => w.startsWith(q))).slice(0, 2);
}

const lowerNames = new WeakMap<Players, string[]>();

/**
 * The players whose name has the text, as rows of core.players: name starts with it, then a word in the name starts
 * with it, then it appears anywhere; ties go to more pp (their best of the three boards), then the name.
 */
export function rankPlayers(players: Players, text: string): { tier: number; row: number }[] {
  let names = lowerNames.get(players);
  if (!names) lowerNames.set(players, names = Array.from({ length: players.rows }, (_, row) => players.name.at(row).toLowerCase()));
  const q = text.toLowerCase();
  const scored: [number, number, number][] = [];
  for (let row = 0; row < players.rows; row++) {
    const tier = tierOf(names[row], q);
    if (tier >= 0) scored.push([tier, Math.max(players.cv[row], players.ul[row], players.pp[row]), row]);
  }
  scored.sort((a, b) => a[0] - b[0] || b[1] - a[1] || players.name.at(a[2]).localeCompare(players.name.at(b[2]), 'en'));
  return scored.map(s => ({ tier: s[0], row: s[2] }));
}

/** What the search found: pages, players (rows of core.players) and maps, and which of players and maps go first. */
export interface Found {
  pages: SitePage[];
  people: number[];
  maps: MapRow[];
  playersFirst: boolean;
  /** A beatmap id typed that the maps don't have: its own map file may (`looked` answers for it next time). */
  lookUp: number | null;
}

/**
 * The results for `text`. `maps` is null while they load. `looked(id)` is a map found in its own file for an id the
 * maps don't have: a row, null when that file hasn't it either, undefined when it hasn't been looked up yet.
 */
export function findAll(ctx: Ctx, players: Players | null, maps: SearchMaps | null, text: string,
  looked: (id: number) => MapRow | null | undefined = () => undefined): Found {
  const pages = pageMatches(sitePages(ctx), text);
  const ranked = players ? rankPlayers(players, text) : [];
  let foundMaps: { tier: number; row: MapRow }[] = maps ? rankMaps(maps.rows, maps.hay, text) : [];
  // An id the index doesn't have: its own map file has it (or says nobody here has played it).
  const id = beatmapIdOf(text);
  let lookUp: number | null = null;
  if (id !== null && foundMaps[0] && !foundMaps[0].row[3]) {
    const row = looked(id);
    if (row === undefined) lookUp = id;
    if (row) foundMaps = [{ tier: 0, row }];
  }
  // Players first when the text matches a name at least as well as a map (a name, then, not a title or a map id).
  const playersFirst = !foundMaps.length || (ranked.length > 0 && ranked[0].tier <= foundMaps[0].tier);
  const people = ranked.slice(0, Math.max(2, LIMIT - foundMaps.length - pages.length)).map(r => r.row);
  return { pages, people, maps: foundMaps.map(m => m.row), playersFirst, lookUp };
}

/** One result, as the list holds it. */
export type Result = { page: SitePage } | { map: MapRow } | { player: number };

/** The results in the order the list shows them, in groups: the pages (no heading), then players and maps. */
export function groups({ t }: Ctx, found: Found): [string, Result[]][] {
  const pages: [string, Result[]] = ['', found.pages.map(page => ({ page }))];
  const people: [string, Result[]] = [t('Players'), found.people.map(player => ({ player }))];
  const maps: [string, Result[]] = [t('Maps'), found.maps.map(map => ({ map }))];
  return found.playersFirst ? [pages, people, maps] : [pages, maps, people];
}

/** The text with the matched part in a <mark>. */
function highlight(name: string, text: string): Value {
  const at = name.toLowerCase().indexOf(text.toLowerCase());
  if (at < 0) return name;
  return html`${name.slice(0, at)}<mark>${name.slice(at, at + text.length)}</mark>${name.slice(at + text.length)}`;
}

/** A quiet second line: converts pp when there is some, otherwise whichever pp the player has. */
function detail(ctx: Ctx, players: Players, row: number): string {
  const { t, fmt } = ctx;
  if (players.cv[row] > 0) return `${fmt.pp(players.cv[row] / 100)} pp · ${t('Converts')}`;
  if (players.pp[row] > 0) return `${fmt.pp(players.pp[row] / 100)} pp · ${t('Ranked')}`;
  if (players.ul[row] > 0) return `${fmt.pp(players.ul[row] / 100)} pp · ${t('Loved')}`;
  return t('No pp yet');
}

function option(ctx: Ctx, players: Players | null, r: Result, i: number, text: string): Safe {
  const { t } = ctx;
  if ('page' in r) return html`<div role="option" class="search-page" id="search-opt-${i}" data-i="${i}" aria-selected="false">
      <span class="search-page-mark" aria-hidden="true">→</span><span class="search-name">${highlight(r.page.name, text)}</span><span class="search-detail">${r.page.detail}</span>
    </div>`;
  if ('map' in r) {
    const [id, setId, artist, title, version, stars, , , , mapper] = r.map;
    const known = Boolean(title);
    return html`<div role="option" class="search-map" id="search-opt-${i}" data-i="${i}" aria-selected="false">
        ${setCover(setId, 'list', 'search-cover')}
        <span class="search-name">${known ? html`${highlight(title, text)} <span class="search-diff">[${highlight(version, text)}]</span>` : t('Map {id}', { id })}</span>
        <span class="search-detail">${known && stars ? starsBadge(ctx, stars) : ''}</span>
        <span class="search-sub">${known ? html`${highlight(artist, text)}${mapper ? html` · ${ctx.th('mapped by {mapper}', { mapper: highlight(mapper, text) })}` : ''}` : r.map[7] ? t('No map details') : t('No Portuguese plays on it yet')}</span>
      </div>`;
  }
  const row = r.player;
  return html`<div role="option" id="search-opt-${i}" data-i="${i}" aria-selected="false">
      ${avatar(ctx, players!, row, 'avatar-sm')}<span class="search-name ${nameClass(ctx, players!, row)}">${highlight(players!.name.at(row), text)}</span><span class="search-detail">${detail(ctx, players!, row)}</span>
    </div>`;
}

/** The listbox's content: each group under its heading (the pages have none), options numbered across all of them. */
export function resultsList(ctx: Ctx, players: Players | null, list: [string, Result[]][], text: string): Safe {
  let offset = 0;
  return html`${list.map(([label, items]) => {
    const at = offset;
    offset += items.length;
    if (!label) return items.map((r, k) => option(ctx, players, r, at + k, text));
    return items.length ? html`<div role="group" aria-labelledby="search-g-${at}">
      <div class="search-group" id="search-g-${at}" role="presentation">${label}</div>
      ${items.map((r, k) => option(ctx, players, r, at + k, text))}
    </div>` : '';
  })}`;
}

/** What the live region says: what was found, or that nothing was (and, while the maps load, that they're coming). */
export function statusText(ctx: Ctx, found: Found, loadingMaps: boolean): string {
  const { t, tn, fmt } = ctx;
  const count = found.pages.length + found.people.length + found.maps.length;
  if (!count) {
    return loadingMaps ? t('No players found. Looking through the maps…')
      : t('No players or maps found. This search has the maps two or more players here have played; Search all maps has the rest.');
  }
  const and = ` ${t('and')} `;
  return t('{what} found', {
    what: [found.pages.length && tn(found.pages.length, '{names} page', '{names} pages', { names: found.pages.map(p => p.name).join(and) }),
      found.people.length && fmt.plural(found.people.length, 'player'), found.maps.length && fmt.plural(found.maps.length, 'map')].filter(Boolean).join(and),
  });
}
