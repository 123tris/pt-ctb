// Players in markup, as assets/js/core/ui.js draws them, over the core pack's columns: a player is a row in
// core.players, so nothing here builds an object per player.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { COLOURS, type CorePack } from '../gen/packs.ts';
import { LEGENDS } from '../../../assets/js/core/legends.js';
import { hashedName } from '../../../assets/js/core/data-name.js';

export type Players = CorePack['players'];

/** Displayed avatar sizes by class (site.css), as width/height so the layout doesn't move when they load. */
const AVATAR_SIZE: Record<string, number> = { 'avatar-lg': 88, 'avatar-md': 44, 'avatar-sm': 22 };

export const avatarUrl = (id: number) => `https://a.ppy.sh/${id}`;

/**
 * An avatar's src and srcset for `size` CSS pixels: the export's 64 and 128 px thumbnails, which the browser picks
 * between by screen density, or osu!'s 256 px original for players without thumbnails (or shown larger than 64 px).
 */
export function avatarSrc(ctx: Ctx, players: Players, row: number, size: number): Safe {
  const id = players.id[row];
  const h64 = players.avatar64.at(row), h128 = players.avatar128.at(row);
  if (!h64 || !h128) return html`src="${avatarUrl(id)}"`;
  const thumb64 = `${ctx.data}${hashedName(`avatars/${id}-64.webp`, h64)}`;
  const thumb128 = `${ctx.data}${hashedName(`avatars/${id}-128.webp`, h128)}`;
  const srcset = [`${thumb64} 64w`, `${thumb128} 128w`, ...(size > 64 ? [`${avatarUrl(id)} 256w`] : [])].join(', ');
  return html`src="${size > 32 ? thumb128 : thumb64}" srcset="${srcset}" sizes="${size}px"`;
}

export function avatar(ctx: Ctx, players: Players, row: number, cls = ''): Safe {
  const size = AVATAR_SIZE[cls] ?? 32;
  return html`<img class="avatar ${cls}" ${avatarSrc(ctx, players, row, size)} alt="" width="${size}" height="${size}" loading="lazy" decoding="async" data-hide-broken>`;
}

/** The class for a bought name colour while it lasts, or ''. */
export function nameClass(ctx: Ctx, players: Players, row: number): string {
  const colour = players.colour[row];
  const until = players.colourUntil[row];
  return colour && (!until || until > ctx.now()) ? `name-colour name-${COLOURS[colour]}` : '';
}

/** A player's name with avatar, linking to their page. */
export const playerLink = (ctx: Ctx, players: Players, row: number, cls = ''): Safe =>
  html`<a class="player" href="/player/${players.id[row]}">${avatar(ctx, players, row, cls)}<span class="${nameClass(ctx, players, row)}">${players.name.at(row)}</span></a>`;

const rows = new WeakMap<Players, Map<number, number>>();

/** A player's row in core.players by osu! id, or -1 for someone not on the site (an index built once per pack). */
export function rowOf(players: Players, id: number): number {
  let index = rows.get(players);
  if (!index) {
    index = new Map();
    for (let row = 0; row < players.rows; row++) index.set(players.id[row], row);
    rows.set(players, index);
  }
  return index.get(id) ?? -1;
}

/** A player's name, or #id for someone not on the site. */
export const playerName = (players: Players, id: number): string => {
  const row = rowOf(players, id);
  return row < 0 ? `#${id}` : players.name.at(row);
};

/** playerLink() by osu! id: a player not on the site gets osu!'s avatar and #id. */
export function playerLinkId(ctx: Ctx, players: Players, id: number, cls = ''): Safe {
  const row = rowOf(players, id);
  if (row >= 0) return playerLink(ctx, players, row, cls);
  const size = AVATAR_SIZE[cls] ?? 32;
  return html`<a class="player" href="/player/${id}"><img class="avatar ${cls}" src="${avatarUrl(id)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" data-hide-broken><span>#${id}</span></a>`;
}

export const ppText = (ctx: Ctx, n: number): Safe => html`<span class="pp">${ctx.fmt.pp(n)}<small>pp</small></span>`;

/** Inactive on osu! (osu! shows them at 0 pp; the site keeps their official pp). */
export const isInactiveOnOsu = (players: Players, row: number) => players.ppSource[row] > 0;
const isEstimated = (players: Players, row: number) => players.ppSource[row] === 3;

/** Inactive: inactive on osu!, or no play stored in over a year. */
const INACTIVE_AFTER = 365 * 86400;
export const isInactive = (ctx: Ctx, players: Players, row: number) =>
  isInactiveOnOsu(players, row) || !players.last[row] || players.last[row] < ctx.now() - INACTIVE_AFTER;

/** A former Portuguese top-5 player (core/legends.js) who is now inactive. */
export const isLegend = (ctx: Ctx, players: Players, row: number) => LEGENDS.has(players.id[row]) && isInactive(ctx, players, row);

/**
 * A tag that explains itself on tap (a toggletip, DESIGN.md §9; client/tips.ts handles the clicks), or plain inside a
 * link.
 */
export const tipTag = (text: string, tip: string, { cls = 'legend-tag', plain = false } = {}): Safe => (plain
  ? html`<span class="${cls}" title="${tip}">${text}<span class="sr-only">: ${tip}</span></span>`
  : html`<button type="button" class="${cls}" data-tip="${tip}" aria-expanded="false" aria-controls="tip-pop">${text}</button>`);

export function inactiveTag(ctx: Ctx, players: Players, row: number): Safe {
  const seen = players.ppSeen[row];
  return tipTag(ctx.t('inactive'), `${ctx.t('Inactive on osu!, which shows them at 0 pp.')}${seen ? ` ${ctx.t('Last seen there {date}.', { date: ctx.fmt.date(seen) })}` : ''}`);
}

export const legendTag = (ctx: Ctx): Safe => tipTag(ctx.t('legend'), ctx.t('A former Portuguese top 5 player, now inactive.'));

/** The tag after an inactive player's name: "legend" for legends, otherwise "inactive" saying why. */
export function statusTag(ctx: Ctx, players: Players, row: number): Safe | '' {
  if (isLegend(ctx, players, row)) return legendTag(ctx);
  if (isInactiveOnOsu(players, row)) return inactiveTag(ctx, players, row);
  if (isInactive(ctx, players, row)) return tipTag(ctx.t('inactive'), ctx.t('No new plays stored in over a year.'));
  return '';
}

/** Official pp; an estimate reads "≈ 8,224pp (estimated)", the "estimated" explaining itself on tap. */
export function officialPp(ctx: Ctx, players: Players, row: number): Safe {
  const pp = players.pp[row] / 100;
  if (!isEstimated(players, row)) return ppText(ctx, pp);
  return html`<span class="pp"><span aria-hidden="true">≈ </span>${ctx.fmt.pp(pp)}<small>pp</small></span><span class="est">${tipTag(ctx.t('estimated'), ctx.t('Estimated from their stored plays, so probably a little low.'), { cls: 'est-tip' })}</span>`;
}


/** officialPp() inside a link: "≈ 8,224pp", with "(estimated)" for screen readers instead of the tappable tag. */
export function officialPpCompact(ctx: Ctx, players: Players, row: number): Safe {
  const pp = players.pp[row] / 100;
  if (!isEstimated(players, row)) return ppText(ctx, pp);
  return html`<span class="pp"><span aria-hidden="true">≈ </span>${ctx.fmt.pp(pp)}<small>pp</small></span><span class="sr-only"> (${ctx.t('estimated')})</span>`;
}

/** Where an inactive player's official pp comes from: "estimated from their plays", "last seen 3 Mar 2026", "last known". */
export function officialPpNote(ctx: Ctx, players: Players, row: number): string {
  if (isEstimated(players, row)) return ctx.t('estimated from their plays');
  const seen = players.ppSeen[row];
  return seen ? ctx.t('last seen on osu! {date}', { date: ctx.fmt.date(seen) }) : ctx.t('last known');
}
