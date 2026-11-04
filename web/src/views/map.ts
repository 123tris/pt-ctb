// A map's page (/map/:id), the same page as assets/js/pages/map.js drew: the banner (the map's chips, the set's
// difficulties, any open bounty's dare and the map's tags), its story, its details, and the Portuguese leaderboard, with
// the plays from before the map was ranked as a second view when there are any. The map and its board come from its
// bucket (maps/<id % 128>.json), the players from the core pack, the rest from the JSON the old page reads.
//
// render() is pure. The browser half (the leaderboard's two views, the difficulty list's scroll) is map.mount.ts.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { S, M, CAT, STATUS, DAN_MAPS } from '../kernel/model.ts';
import { funChips } from '../ui/page.ts';
import { playerLinkId, ppText, type Players } from '../ui/players.ts';
import { mapText, bannerArt, starsBadge, starColor, osuMap, osuGame, type MapMeta } from '../ui/maps.ts';
import { scoreStats, scoreWhen, posBadge, catChip, type Cat, type Play } from '../ui/scores.ts';
import { danName } from '../ui/events.ts';
import { mapTags } from '../ui/badges.ts';
import { mapLore } from '../ui/lore.ts';
import { goalLine, prizeTags, potLine, type Goal, type Pledge, type Pot } from '../ui/bounty.ts';
import { runningNow, challengeChips, type Running } from '../ui/challenge-chips.ts';

/** A map's entry in its bucket (assets/js/core/data.js mapEntry). Its rows are [player, ...play], best first. */
export interface MapEntry {
  /** The map's details (M), or null for a map the bot only knows by id. */
  m: MapMeta;
  c: Cat;
  s: Play[];
  /** Plays from before the map was ranked, which count toward nothing. */
  pre?: Play[];
  /** The map's scores are kept but give no pp. */
  banned?: boolean;
}

/** A map bucket (maps/<id % 128>.json): entries by map id. */
export type Bucket = Record<string, MapEntry>;

/** One of the set's difficulties (sets/<set id % 128>.json): [map id, version, stars, Portuguese players]. */
export type Diff = readonly [number, string, number, number];

/**
 * An open bounty (bounties.json): [map, cat, goal, posted, players, closest miss, target, pledges, id, pot, funds,
 * poster, expires, mods, stake].
 */
export type OpenBounty = [number, Cat, Goal, number | null, number, number | null, number | null, Pledge[], number | null,
  number | null, Pot['funds'], number | null, number | null, ...unknown[]];

/** bounties.json: the open bounties, and the details of the maps they're on. */
export interface Bounties {
  open?: OpenBounty[];
  maps: Record<string, MapMeta>;
}

/** meta.json's brief week and King of the hill month (for the chips), and the details of the hill's maps. */
export interface SiteBrief {
  week?: { map: number; end: number } | null;
  hill?: { status?: string; end: number; pool: Running['hill']; maps: Record<string, MapMeta> } | null;
}

export interface Data {
  id: number;
  core: CorePack;
  /** The map's entry in its bucket, or null for a map nobody here has played. */
  entry: MapEntry | null;
  /** The map's details: its entry's, or a challenge file's for a map nobody here has played; null when none has them. */
  meta: MapMeta;
  /** The set's difficulties, easiest first, when the data has them and they include this one. */
  diffs: readonly Diff[] | null;
  bounties: Bounties | null;
  site: SiteBrief;
}

/** The page's title: the map's artist and title. */
export const title = (ctx: Ctx, data: Data): string => mapText(ctx, data.id, data.meta).title;

// osu!'s own status names, which players use as they are.
const STATUS_LABEL: Record<number, string> = {
  [STATUS.GRAVEYARD]: 'Graveyard', [STATUS.WIP]: 'WIP', [STATUS.PENDING]: 'Pending', [STATUS.RANKED]: 'Ranked',
  [STATUS.APPROVED]: 'Approved', [STATUS.QUALIFIED]: 'Qualified', [STATUS.LOVED]: 'Loved',
};

// The date next to the status: when a ranked, approved, qualified or loved map got that status ("Ranked 14 Mar 2021"),
// or when a graveyard, pending or WIP map was last updated ("Last updated 2 Jun 2023"). Both are unix seconds at the
// end of the beatmap tuple and are often missing (older data has neither), so a null shows nothing.
const DATED = new Set([STATUS.RANKED, STATUS.APPROVED, STATUS.QUALIFIED, STATUS.LOVED]);

/** [label, unix seconds] for the date to show after the status, or null. */
function statusDate(ctx: Ctx, meta: NonNullable<MapMeta>): [string, number] | null {
  if (DATED.has(meta[M.STATUS])) {
    const at = meta[M.RANKED_AT] ?? null;
    return at ? [STATUS_LABEL[meta[M.STATUS]], at] : null;
  }
  const at = meta[M.UPDATED_AT] ?? null;
  return at ? [ctx.t('Last updated'), at] : null;
}

/** The set's difficulties as links, easiest first, this one marked. */
function diffSwitcher(ctx: Ctx, id: number, diffs: readonly Diff[]): Safe {
  const { t, fmt } = ctx;
  return html`<nav class="diffs" aria-label="${t('Difficulties')}">${diffs.map(([mapId, version, stars, players]) => {
    const label = t('{version}, {stars} stars, {players}', {
      version, stars: fmt.num(stars, 2), players: players ? fmt.plural(players, 'Portuguese player') : t('no Portuguese scores yet'),
    });
    return html`<a class="diff ${players ? '' : 'diff-new'}" href="/map/${mapId}" style="--s:${starColor(stars)}" title="${label}"
      aria-label="${label}" aria-current="${mapId === id ? 'page' : 'false'}"><span>${version}</span><small>${fmt.num(stars, 2)}</small></a>`;
  })}</nav>`;
}

/**
 * Leaderboard rows, the visitor's marked. `pre`: plays from before the map was ranked, which count toward nothing, so a
 * plain position and a dash for pp (a "0pp" would read as a play worth nothing rather than one that isn't counted).
 */
function boardRows(ctx: Ctx, entries: readonly Play[], players: Players, pre = false): Safe[] {
  const { t, fmt } = ctx;
  return entries.map(([uid, ...s], i) => html`<tr class="${uid === ctx.me ? 'me' : ''}">
    <td class="rank">${pre ? i + 1 : posBadge(ctx, i + 1)}</td>
    <td class="cell-player">${playerLinkId(ctx, players, uid)}<span class="cell-sub"><span class="score-line">${scoreStats(ctx, s)}</span> ${fmt.num(s[S.SCORE])} · <time datetime="${new Date(s[S.TIME] * 1000).toISOString()}">${fmt.date(s[S.TIME])}</time></span></td>
    <td class="num col-opt">${fmt.num(s[S.SCORE])}</td>
    <td class="col-opt"><span class="score-line">${scoreStats(ctx, s)}</span></td>
    <td class="num">${pre ? html`<span class="faint" title="${t('Set before the map was ranked: counts toward nothing')}">—</span>` : ppText(ctx, s[S.PP])}</td>
    <td class="num faint col-opt" title="${fmt.dateTime(s[S.TIME])}">${scoreWhen(ctx, s, fmt.date(s[S.TIME]))}</td>
  </tr>`);
}

const boardTable = (ctx: Ctx, rows: Safe[]): Safe => html`<div class="table-wrap"><table>
  <thead><tr><th>#</th><th>${ctx.t('Player')}</th><th class="num col-opt">${ctx.t('Score')}</th><th class="col-opt">${ctx.t('Play')}</th><th class="num">pp</th><th class="num col-opt">${ctx.t('Date')}</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;

/** Each open bounty on the map: its dare and prizes, and its pot with where to add to it. */
function bountyLines(ctx: Ctx, wanted: readonly OpenBounty[], players: Players): Safe[] {
  return wanted.map(([, , goal, , , , target, pledges, , pot, funds, poster, expires]) => html`<p class="bounty-line m-0 mt-2">${goalLine(ctx, goal, target, players)}${prizeTags(ctx, pledges)}</p>
    ${pot ? html`${potLine(ctx, { pot, funds, poster, expires }, players)}<p class="m-0 small"><a href="/challenges/bounties">${ctx.t('Fund it on the Bounties tab')}</a></p>` : ''}`);
}

export function render(ctx: Ctx, data: Data): Safe {
  const { t, tn, fmt } = ctx;
  const { id, entry, meta, diffs } = data;
  const players = data.core.players;
  const { title, sub } = mapText(ctx, id, meta);
  const danStage = DAN_MAPS.indexOf(id);
  const board = entry?.s ?? [];
  // Plays from before the map was ranked: a second view of the leaderboard, offered only when there are any.
  const pre = entry?.pre ?? [];
  const lore = mapLore(ctx, meta);
  const tags = [
    ...(lore?.tuga ? [{ name: 'tuga certified 🇵🇹', tip: t('A Portuguese song or meme map.') }] : []), // PT text (intentional): "tuga"
    ...mapTags(ctx, meta, board, entry?.c),
  ];
  const fcs = board.filter(e => e[S.MISS + 1] === 0).length;
  const unrankedForever = meta && [STATUS.GRAVEYARD, STATUS.WIP, STATUS.PENDING].includes(meta[M.STATUS]) && board.length >= 3;
  const dated = meta ? statusDate(ctx, meta) : null;
  // Open bounties on this map: a Wanted chip, and each one's dare and prizes under the title.
  const wanted = (data.bounties?.open ?? []).filter(r => r[0] === id);
  const chips = challengeChips(ctx, id, runningNow({ meta: data.site, bounties: data.bounties }, ctx.now()));

  return html`
    <section class="banner">
      ${bannerArt(meta?.[M.SET])}
      <div class="banner-body">
        <div class="links">
          ${entry ? catChip(ctx, entry.c) : ''}
          ${meta ? starsBadge(ctx, meta[M.STARS]) : ''}
          ${danStage >= 0 ? html`<span class="badge badge-gold">${t('Dan course: {stage}', { stage: danName(ctx, danStage) })}</span>` : ''}
          ${entry?.banned ? html`<span class="badge badge-red" title="${t('Scores on this map are kept but give no pp')}">${t('Banned — no pp')}</span>` : ''}
          ${chips}
        </div>
        <h1><a class="title-link" href="${osuMap(id)}" target="_blank" rel="noopener" title="${t('{name} on osu!', { name: title })}">${title}</a></h1>
        <div class="sub">${sub}</div>
        ${diffs ? diffSwitcher(ctx, id, diffs) : ''}
        ${bountyLines(ctx, wanted, players)}
        ${funChips(ctx, tags, 'map-tags')}
        ${unrankedForever ? html`<p class="m-0 mt-2 small faint">${t('Still waiting to be ranked. Since 2018, probably.')}</p>` : ''}
      </div>
    </section>

    ${lore ? html`<div class="lore-card">
      <span class="eyebrow">${lore.title}</span>
      <p>${lore.text(board.length, board.reduce((max, e) => Math.max(max, e[S.PP + 1]), 0))}</p>
      ${board.length ? html`<p class="m-0 small muted">${tn(fcs, 'FC watch: {n} of {total} has a full combo on this diff.', 'FC watch: {n} of {total} have a full combo on this diff.', { total: fmt.plural(board.length, 'Portuguese player') })}</p>` : ''}
    </div>` : ''}

    ${meta ? html`<dl class="kv kv-strip">
      <div><dt>${t('Status')}</dt><dd>${STATUS_LABEL[meta[M.STATUS]] ?? '—'}${dated ? html`<span class="status-date">${dated[0] === STATUS_LABEL[meta[M.STATUS]] ? ' ' : html`<span class="sep-dot"> · </span>${dated[0]} `}<time datetime="${new Date(dated[1] * 1000).toISOString()}">${fmt.date(dated[1])}</time></span>` : ''}</dd></div>
      <div><dt>${t('Length')}</dt><dd>${fmt.duration(meta[M.LENGTH])}</dd></div>
      <div><dt>BPM</dt><dd>${fmt.num(meta[M.BPM])}</dd></div>
      <div><dt>${t('Max combo')}</dt><dd>${meta[M.MAX_COMBO] ? `${fmt.num(meta[M.MAX_COMBO])}x` : '—'}</dd></div>
      <div><dt>CS</dt><dd>${fmt.num(meta[M.CS], 1)}</dd></div>
      <div><dt>AR</dt><dd>${fmt.num(meta[M.AR], 1)}</dd></div>
      <div><dt>HP</dt><dd>${fmt.num(meta[M.HP], 1)}</dd></div>
    </dl>` : ''}

    <div class="mt-4 btn-row">
      <a class="btn btn-small" href="${osuGame(id)}" title="${t('Opens this difficulty in the osu! game (on stable, downloading it through osu!direct needs supporter)')}">${t('Open in osu!')}</a>
      ${meta?.[M.MAX_COMBO] ? html`<a class="btn btn-small" href="/calculator?map=${id}">${t('Calculate pp')}</a>` : ''}
    </div>

    <section class="section map-board">
      <div class="section-head">
        <h2>${t('Portuguese leaderboard')}</h2>
        <span class="muted small" data-view="now">${entry?.c === CAT.LOVED && !entry.banned ? t('Sorted by pp, as in the bot.') : t('Sorted by classic score, as on osu!.')}</span>
        ${pre.length ? html`<span class="muted small" data-view="pre" hidden>${t('Set before the map was ranked. Kept for the record; they count toward nothing.')}</span>` : ''}
      </div>
      ${pre.length ? html`<div class="chips board-views" role="group" aria-label="${t('Plays shown')}">
        <button class="chip active" type="button" data-board="now" aria-pressed="true">${STATUS_LABEL[meta?.[M.STATUS]] ?? t('Ranked')} <span class="faint">${fmt.num(board.length)}</span></button>
        <button class="chip" type="button" data-board="pre" aria-pressed="false">${t('Before ranking')} <span class="faint">${fmt.num(pre.length)}</span></button>
      </div>` : ''}
      <div data-view="now">
        ${board.length ? boardTable(ctx, boardRows(ctx, board, players))
          : html`<div class="empty">${pre.length ? t('No Portuguese player has a score on the ranked version of this map yet. Why not be the first?') : t('No Portuguese player has a score on this map yet. Why not be the first?')}</div>`}
      </div>
      ${pre.length ? html`<div data-view="pre" hidden>${boardTable(ctx, boardRows(ctx, pre, players, true))}</div>` : ''}
    </section>
  `;
}
