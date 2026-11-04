// Maps in markup, as assets/js/core/ui.js draws them: titles, covers, star badges and links. A map's details are the
// JSON's map tuple (M in model.ts), as player files and map buckets carry them.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { M } from '../kernel/model.ts';

/** A map tuple from the JSON ([artist, title, version, set, stars, …], M), or nothing when the export has none. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MapMeta = readonly any[] | null | undefined;

export const osuUser = (id: number) => `https://osu.ppy.sh/users/${id}/fruits`;
export const osuMap = (id: number) => `https://osu.ppy.sh/beatmaps/${id}?mode=fruits`;
/** Opens the difficulty in the osu! game (osu!direct's own link): a custom scheme, so never a new tab. */
export const osuGame = (id: number) => `osu://b/${id}`;
export const coverUrl = (set: number | null | undefined, kind = 'list') => (set ? `https://assets.ppy.sh/beatmaps/${set}/covers/${kind}.jpg` : '');

/** { title, sub } for a map; maps the bot only knows by id get a placeholder title. */
export function mapText(ctx: Ctx, id: number, meta: MapMeta): { title: string; sub: string } {
  if (!meta || !meta[M.TITLE] || meta[M.TITLE] === 'Unknown') return { title: ctx.t('Map #{id}', { id }), sub: ctx.t('No map details') };
  return { title: `${meta[M.ARTIST]} - ${meta[M.TITLE]}`, sub: `[${meta[M.VERSION]}] · ${meta[M.CREATOR]}` };
}

export function mapLabel(ctx: Ctx, id: number, meta: MapMeta): string {
  const { title } = mapText(ctx, id, meta);
  return meta && meta[M.VERSION] ? `${title} [${meta[M.VERSION]}]` : title;
}

const STAR_STOPS = [0.1, 1.25, 2, 2.5, 3.3, 4.2, 4.9, 5.8, 6.7, 7.7, 9];
const STAR_COLORS = ['#4290fb', '#4fc0ff', '#4fffd5', '#7cff4f', '#f6f05c', '#ff8068', '#ff4e6f', '#c645b8', '#6563de', '#18158e', '#000000'];

/** osu!'s star-rating colour spectrum. */
export function starColor(stars: number): string {
  if (stars <= STAR_STOPS[0]) return STAR_COLORS[0];
  if (stars >= STAR_STOPS[STAR_STOPS.length - 1]) return STAR_COLORS[STAR_COLORS.length - 1];
  const i = STAR_STOPS.findIndex(stop => stop > stars) - 1;
  const t = (stars - STAR_STOPS[i]) / (STAR_STOPS[i + 1] - STAR_STOPS[i]);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const [a, b] = [STAR_COLORS[i], STAR_COLORS[i + 1]].map(c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16)));
  return `rgb(${mix(a[0], b[0])}, ${mix(a[1], b[1])}, ${mix(a[2], b[2])})`;
}

/** WCAG relative luminance of an `rgb(r, g, b)` or `#rrggbb` colour. */
function luminance(color: string): number {
  const rgb = color.startsWith('#') ? [1, 3, 5].map(k => parseInt(color.slice(k, k + 2), 16)) : color.match(/\d+/g)!.map(Number);
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads better on `background` (osu!'s spectrum spans both). */
function textOn(background: string): string {
  const l = luminance(background);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

export function starsBadge(ctx: Ctx, stars: number | null | undefined): Safe | '' {
  if (!stars) return '';
  const bg = starColor(stars);
  return html`<span class="stars" style="background:${bg};color:${textOn(bg)}">★ ${ctx.fmt.num(stars, 2)}</span>`;
}

/** osu!'s cover sizes: list 150×104 (shown at 60×42), card 400×140, cover 900×250 (18:5). */
const COVER_SIZE: Record<string, [number, number]> = { list: [60, 42], card: [400, 140], cover: [900, 250], 'cover@2x': [900, 250] };

/** A beatmapset's cover image (`kind`: list, card, cover, cover@2x), or an empty placeholder of the same size. */
export function setCover(set: number | null | undefined, kind = 'list', cls = 'map-cover'): Safe {
  const [w, h] = COVER_SIZE[kind] ?? COVER_SIZE.list;
  return set
    ? html`<img class="${cls}" src="${coverUrl(set, kind)}" alt="" width="${w}" height="${h}" loading="lazy" decoding="async" data-hide-broken>`
    : html`<span class="${cls}"></span>`;
}

export const cover = (meta: MapMeta, kind = 'list', cls = 'map-cover') => setCover(meta?.[M.SET], kind, cls);

/** The wide art at the top of a map or challenge banner; site.css picks the size (cover@2x on wide screens). */
export const bannerArt = (set: number | null | undefined): Safe =>
  html`<div class="banner-art"${set ? html` style="--art:url('${coverUrl(set, 'cover')}');--art-2x:url('${coverUrl(set, 'cover@2x')}')"` : ''}></div>`;

/** A map with its cover, title and difficulty, linking to its page. */
export function mapLink(ctx: Ctx, id: number, meta: MapMeta, { showStars = true } = {}): Safe {
  const { title, sub } = mapText(ctx, id, meta);
  return html`<a class="map" href="/map/${id}">
    ${cover(meta)}
    <span class="map-text">
      <span class="map-title" title="${title}">${title}</span>
      <span class="map-sub">${showStars && meta ? html`${starsBadge(ctx, meta[M.STARS])} ` : ''}${sub}</span>
    </span>
  </a>`;
}
