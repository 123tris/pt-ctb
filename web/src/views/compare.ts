// Comparing two players (/compare/:a?/:b?), as assets/js/pages/compare.js has it: their stats side by side from the
// core pack, and who's ahead on the maps they've both played from their two player packs, which replace the two whole
// player files the old page downloads and parses.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack, PlayerPack } from '../gen/packs.ts';
import { RIVALRY_LABELS } from '../../../assets/js/core/presets.js';
import { tabs, empty } from '../ui/page.ts';
import { avatar, ppText, rowOf, type Players } from '../ui/players.ts';
import { mapLink } from '../ui/maps.ts';
import { catLabel, gradeBadge, modsBadges, type Cat } from '../ui/scores.ts';
import { mapMeta, mapRow, type Plays } from '../ui/playerpack.ts';
import { GRADES } from '../gen/packs.ts';
import { playerPicker as pickerBox } from '../ui/pickers.ts';

export const CATS: Cat[] = ['c', 'u', 'r'];

export interface Data {
  core: CorePack;
  /** The two players' rows in core.players (-1: not picked). */
  a: number;
  b: number;
  /** Both players' packs, when both are picked. */
  packs: [PlayerPack, PlayerPack] | null;
  cat: Cat;
}

/** A map both played: the row of each one's play in their pack's list, and who's ahead ('a', 'b' or null for a tie). */
export interface Shared {
  map: number;
  a: number;
  b: number;
  winner: 'a' | 'b' | null;
}

/**
 * Maps both played in a category, with who's ahead by the bot's ordering for that board (model.js boardComparator: pp
 * then score on Loved, score then pp elsewhere), newest first.
 */
export function shared(pa: PlayerPack, pb: PlayerPack, cat: Cat): Shared[] {
  const la = pa[cat], lb = pb[cat];
  const theirs = new Map<number, number>();
  for (let i = 0; i < lb.rows; i++) theirs.set(lb.map[i], i);
  const out: Shared[] = [];
  for (let i = 0; i < la.rows; i++) {
    const j = theirs.get(la.map[i]);
    if (j === undefined) continue;
    const byPp = lb.pp[j] - la.pp[i], byScore = lb.score[j] - la.score[i];
    const order = cat === 'u' ? byPp || byScore : byScore || byPp;
    out.push({ map: la.map[i], a: i, b: j, winner: order < 0 ? 'a' : order > 0 ? 'b' : null });
  }
  const when = (x: Shared) => Math.max(la.time[x.a], lb.time[x.b]);
  return out.sort((x, y) => when(y) - when(x));
}

/** The joke row: full combos on 7★ and up, from the player's own plays. Data-backed, but still silly. */
export function aura(pack: PlayerPack): number {
  let n = 0;
  for (const cat of CATS) {
    const plays = pack[cat];
    for (let i = 0; i < plays.rows; i++) {
      if (plays.miss[i] !== 0) continue;
      const row = mapRow(pack, plays.map[i]);
      if (row >= 0 && pack.maps.stars[row] >= 700) n++;
    }
  }
  return n;
}

/** Stat rows: label, value (null for none), how to show it, and whether lower wins (ranks). */
function statRows(ctx: Ctx, players: Players, a: number, b: number): Safe {
  const { t, fmt } = ctx;
  const rows: [string, (r: number) => number | null, (v: number) => string, boolean?][] = [
    [t('Converts pp'), r => players.cv[r] / 100, v => `${fmt.pp(v)} pp`],
    [t('Loved pp'), r => players.ul[r] / 100, v => `${fmt.pp(v)} pp`],
    [t('Official pp'), r => players.pp[r] / 100, v => `${fmt.pp(v)} pp`],
    [t('Global rank'), r => players.global[r] || null, v => fmt.rank(v), true],
    [t('Accuracy'), r => players.acc[r] / 100, v => fmt.acc(v)],
    [t('#1s in Portugal'), r => players.firstsC[r] + players.firstsU[r] + players.firstsR[r], v => fmt.num(v)],
    [t('Scores'), r => players.countC[r] + players.countU[r] + players.countR[r], v => fmt.num(v)],
    ['SS', r => players.ss[r], v => fmt.num(v)],
    [t('Dan points'), r => players.danScore[r], v => fmt.num(v)],
    [t('Play count'), r => players.plays[r], v => fmt.num(v)],
  ];
  return html`${rows.map(([label, value, show, lowerWins]) => {
    const va = value(a), vb = value(b);
    const aWins = va !== null && (vb === null || (lowerWins ? va < vb : va > vb));
    const bWins = vb !== null && (va === null || (lowerWins ? vb < va : vb > va));
    return html`<div class="cmp-row">
      <span class="a ${aWins ? 'win' : ''}">${va === null ? '—' : show(va)}</span>
      <span class="label">${label}</span>
      <span class="${bWins ? 'win' : ''}">${vb === null ? '—' : show(vb)}</span>
    </div>`;
  })}`;
}

/** One side of a shared map: the play, marked #1 for the one ahead. */
export function side(ctx: Ctx, players: Players, plays: Plays, row: number, cat: Cat, win: boolean, who: number): Safe {
  const { fmt } = ctx;
  return html`<span class="score-line side-play ${win ? '' : 'lost'}">
  <span class="win-mark">${win ? '#1' : ''}</span> ${avatar(ctx, players, who, 'avatar-sm')} ${modsBadges(plays.mods[row])} ${gradeBadge(GRADES[plays.grade[row]] || '')} ${fmt.acc(plays.acc[row] / 100)}
  ${cat === 'u' ? ppText(ctx, plays.pp[row] / 100) : html`<b>${fmt.num(plays.score[row])}</b>`}
</span>`;
}

/** One page of shared maps (paged by compare.mount.ts). */
export function sharedRows(ctx: Ctx, data: Data, slice: readonly Shared[]): Safe {
  const [pa, pb] = data.packs!;
  const players = data.core.players;
  return html`<div class="rows">${slice.map(x => html`<div class="row">
    <div>${mapLink(ctx, x.map, mapMeta(pa, x.map))}</div>
    <div class="meta-stack row-meta">
      ${side(ctx, players, pa[data.cat], x.a, data.cat, x.winner === 'a', data.a)}
      ${side(ctx, players, pb[data.cat], x.b, data.cat, x.winner === 'b', data.b)}
    </div>
  </div>`)}</div>`;
}

const pickers = (ctx: Ctx, players: Players, a: number, b: number) => html`<div class="toolbar">
    ${pickerBox(players, 'pick-a', a, ctx.t('First player…'))}
    <span class="faint">vs</span>
    ${pickerBox(players, 'pick-b', b, ctx.t('Second player…'))}
  </div>`;


export const title = (ctx: Ctx, { core, a, b }: Data) =>
  (a >= 0 && b >= 0 ? `${core.players.name.at(a)} vs ${core.players.name.at(b)}` : ctx.t('Compare'));

export function render(ctx: Ctx, data: Data): Safe {
  const { t, fmt } = ctx;
  const { core, a, b, cat } = data;
  const players = core.players;
  const name = (row: number) => players.name.at(row);

  if (a < 0 || b < 0 || !data.packs) {
    const rivals: number[] = [];
    if (a >= 0) {
      for (let r = 0; r < players.rows; r++) if (r !== a && players.cv[r] > 0) rivals.push(r);
      rivals.sort((x, y) => Math.abs(players.cv[x] - players.cv[a]) - Math.abs(players.cv[y] - players.cv[a])).splice(6);
    }
    const presets = (RIVALRY_LABELS as [number, number, string][]).map(([x, y, label]) => [rowOf(players, x), rowOf(players, y), t(label)] as const).filter(([x, y]) => x >= 0 && y >= 0);
    return html`
      <header class="page-head"><h1>${t('Compare two players')}</h1>
        <p>${t('Pick two players to compare their stats and see who wins on the maps they’ve both played.')}</p></header>
      ${pickers(ctx, players, a, b)}
      ${a < 0 && presets.length ? html`<section class="section"><h2>${t('Classic rivalries')}</h2>
        <div class="grid grid-3">${presets.map(([x, y, label]) => html`<a class="card card-link" href="/compare/${players.id[x]}/${players.id[y]}">
          <span class="eyebrow">${label}</span>
          <div class="mt-1 versus">
            <span class="side">${avatar(ctx, players, x, 'avatar-sm')}<b>${name(x)}</b></span>
            <span class="faint small">vs</span>
            <span class="side right"><b>${name(y)}</b>${avatar(ctx, players, y, 'avatar-sm')}</span>
          </div>
        </a>`)}</div></section>` : ''}
      ${rivals.length ? html`<section class="section"><h2>${t('Rivals for {name}', { name: name(a) })}</h2>
        <p class="muted small">${t('The players closest in Converts pp.')}</p>
        <div class="grid grid-3">${rivals.map(r => html`<a class="card card-link" href="/compare/${players.id[a]}/${players.id[r]}">
          <span class="player">${avatar(ctx, players, r, 'avatar-md')}<span><b>${name(r)}</b><br><span class="small muted">${fmt.pp(players.cv[r] / 100)} pp (${players.cv[r] >= players.cv[a] ? '+' : ''}${fmt.num((players.cv[r] - players.cv[a]) / 100)})</span></span></span>
        </a>`)}</div></section>` : ''}
    `;
  }

  const [pa, pb] = data.packs;
  const both = shared(pa, pb, cat);
  let winsA = 0, winsB = 0;
  for (const x of both) { if (x.winner === 'a') winsA++; else if (x.winner === 'b') winsB++; }
  const [xa, xb] = [aura(pa), aura(pb)];
  const idA = players.id[a], idB = players.id[b];
  return html`
    <header class="page-head"><span class="eyebrow">${t('Compare')}</span><h1>${name(a)} vs ${name(b)}</h1></header>
    ${pickers(ctx, players, a, b)}
    <section class="card">
      <div class="mb-3 versus">
        <a class="plain-link side" href="/player/${idA}">${avatar(ctx, players, a, 'avatar-md')}<b>${name(a)}</b></a>
        <span class="faint">vs</span>
        <a class="plain-link side right" href="/player/${idB}"><b>${name(b)}</b>${avatar(ctx, players, b, 'avatar-md')}</a>
      </div>
      ${statRows(ctx, players, a, b)}
      <div class="cmp-row cmp-aura" title="${t('Full combos on 7★ and up. Purely scientific.')}">
        <span class="a ${xa > xb ? 'win' : ''}">${fmt.num(xa)}</span><span class="label">Aura</span><span class="${xb > xa ? 'win' : ''}">${fmt.num(xb)}</span>
      </div>
    </section>

    <section class="section">
      <h2>${t('Maps in common')}</h2>
      ${tabs(CATS.map(c => ({ href: `/compare/${idA}/${idB}?cat=${c}`, label: catLabel(ctx, c), count: fmt.num(shared(pa, pb, c).length), active: c === cat })), t('Sections'))}
      ${both.length ? html`
        <div class="mb-2 versus">
          <b class="side">${name(a)}: ${fmt.num(winsA)}</b>
          <span class="faint small">${cat === 'u' ? t('by pp') : t('by score')}</span>
          <b class="side right">${fmt.num(winsB)}: ${name(b)}</b>
        </div>
        <div class="mb-4 split"><div class="a" style="flex:${winsA || 0.0001}"></div><div class="b" style="flex:${winsB || 0.0001}"></div></div>
        <div id="shared">${sharedRows(ctx, data, both.slice(0, 30))}</div>` : empty(t('There are no {category} maps they’ve both played.', { category: catLabel(ctx, cat) }))}
    </section>
  `;
}
