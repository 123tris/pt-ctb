// A duel's own page (/duel/:id), as assets/js/pages/duel.js draws it from its file (duels/<n>.json,
// tools/lib/duels.mjs): the two players and the final score, their ratings before and after, the format and the lobby
// on osu!, then every round with both scores. It's the link the bot posts with a result, so it stands on its own.
// Players come from the core pack. render() is pure, and there's nothing to wire up after.

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { M } from '../kernel/model.ts';
import { empty } from '../ui/page.ts';
import type { Players } from '../ui/players.ts';
import { cover, mapText, starsBadge, type MapMeta } from '../ui/maps.ts';
import { bananas } from '../ui/bananas.ts';
import {
  deltaText, duelistAvatar, duelistClass, duelistName, experimentalNote, experimentalTag, formatText, matchUrl, statusText, voidText,
  type Duel, type DuelRound, type DuelSide,
} from '../ui/duels.ts';

export interface Data {
  core: CorePack;
  duel: Duel;
  /** The maps of its file's duels: { id: map tuple }, null for a map the export has no details for. */
  maps: Record<string, MapMeta>;
}

/** Both players' names: the site's, or the ones the duel has. */
const namesOf = (players: Players, d: Duel) => ({ a: duelistName(players, d.players[0]), b: duelistName(players, d.players[1]) });

/** "Alice vs Bob". */
export const title = (ctx: Ctx, data: Data): string => ctx.t('{a} vs {b}', namesOf(data.core.players, data.duel));

/** One player's side of the scoreboard: avatar, name, the points, and their rating before → after a ranked duel. */
function side(ctx: Ctx, s: DuelSide, d: Duel, players: Players): Safe {
  const { t, fmt } = ctx;
  const won = d.winner === s.u;
  return html`<div class="duel-board-side ${won ? 'duel-winner' : ''} ${s.u === ctx.me ? 'me' : ''}">
    <a class="duel-board-player" href="/player/${s.u}">${duelistAvatar(ctx, players, s.u, 'avatar-md')}<span class="${duelistClass(ctx, players, s.u)}">${duelistName(players, s)}</span></a>
    ${won ? html`<span class="badge badge-gold">${t('Winner')}</span>` : ''}
    ${s.after !== undefined ? html`<span class="duel-board-rating">${fmt.num(s.before)} → <b>${fmt.num(s.after)}</b> ${deltaText(ctx, Math.round(s.after - s.before!))}</span>` : ''}
  </div>`;
}

/** A player's score on a round: the score (✓ for the round's winner), then accuracy, misses and a fail. */
function scoreCell(ctx: Ctx, r: DuelRound, u: number): Safe {
  const { t, fmt } = ctx;
  const s = r.scores.find(x => x.u === u);
  if (!s) return html`<td class="num duel-score"><span class="faint">${t('no score')}</span></td>`;
  const won = r.winner === u;
  return html`<td class="num duel-score ${won ? 'duel-won' : ''}">
    <span class="duel-score-main">${won ? html`<span class="duel-check" aria-hidden="true">✓</span><span class="sr-only">${t('won')}: </span>` : ''}${fmt.num(s.score)}</span>
    <span class="duel-score-sub">${s.acc !== null ? fmt.acc(s.acc) : ''}${s.miss ? html` · <span class="miss-n">✕${fmt.num(s.miss)}</span>` : ''}${s.pass ? '' : html` · <span class="miss-n">${t('failed')}</span>`}</span>
  </td>`;
}

/** The rounds as a table: the map (with the stars the bot rolled it at) and each player's score; a void round says why. */
function roundsTable(ctx: Ctx, d: Duel, maps: Record<string, MapMeta>, players: Players): Safe {
  const { t } = ctx;
  const [a, b] = d.players;
  return html`<div class="table-wrap" data-label="${t('Rounds')}"><table class="table-compact duel-rounds">
    <thead><tr><th class="col-n">#</th><th>${t('Map')}</th>
      <th class="num col-p">${duelistName(players, a)}</th><th class="num col-p">${duelistName(players, b)}</th></tr></thead>
    <tbody>${d.rounds.map((r, i) => {
      const meta = maps[r.map];
      const { title, sub } = mapText(ctx, r.map, meta);
      const stars = r.stars ?? meta?.[M.STARS];
      return html`<tr class="${r.void ? 'duel-void' : ''}">
        <td class="col-n faint">${r.n ?? i + 1}</td>
        <td class="duel-map"><a class="map" href="/map/${r.map}">${cover(meta)}<span class="map-text">
          <span class="map-title" title="${title}">${title}</span>
          <span class="map-sub">${stars ? html`${starsBadge(ctx, stars)} ` : ''}${meta ? sub : ''}</span></span></a>
          ${r.void ? html`<span class="duel-note">${t('Didn’t count: {reason}', { reason: voidText(ctx, r.void) })}</span>`
            : r.winner === null && r.scores.length ? html`<span class="duel-note">${t('A tie: nobody scored, and a new map was rolled')}</span>` : ''}</td>
        ${scoreCell(ctx, r, a.u)}${scoreCell(ctx, r, b.u)}
      </tr>`;
    })}</tbody>
  </table></div>`;
}

export function render(ctx: Ctx, data: Data): Safe {
  const { t, th, fmt } = ctx;
  const { duel: d, maps } = data;
  const players = data.core.players;
  const [a, b] = d.players;
  const names = namesOf(players, d);
  const loser = d.winner === a.u ? names.b : names.a;
  const when = d.end ?? d.start;
  const facts: Value[] = [
    formatText(ctx, d),
    statusText(ctx, d.status),
    d.stars && `${fmt.num(d.stars[0], 2)}–${fmt.num(d.stars[1], 2)}★`,
    d.wager && th('{n} each on it', { n: bananas(ctx, d.wager) }),
    when && html`<span title="${fmt.dateTime(when)}">${fmt.date(when)}</span>`,
  ].filter(Boolean);

  return html`
    <header class="page-head">
      <span class="eyebrow"><a href="/challenges/duels">${t('Duels')}</a> · ${t('Duel {code}', { code: d.code ?? `#${d.id}` })}</span>
      <h1>${t('{a} vs {b}', names)} ${experimentalTag(ctx)}</h1>
    </header>
    ${experimentalNote(ctx)}

    <section class="duel-board ${d.status === 'abandoned' ? 'duel-muted' : ''}" aria-label="${t('Final score')}">
      ${side(ctx, a, d, players)}
      <div class="duel-board-score"><span>${fmt.num(a.pts)}</span><span class="duel-dash" aria-label="${t('to')}">–</span><span>${fmt.num(b.pts)}</span></div>
      ${side(ctx, b, d, players)}
    </section>
    <p class="duel-facts">${facts.map((f, i) => html`${i ? html`<span class="sep-dot" aria-hidden="true"> · </span>` : ''}${f}`)}</p>
    ${d.status === 'abandoned' ? html`<p class="notice">${t('Abandoned: no round counted for 30 minutes, so it doesn’t count for anyone’s rating and any wager went back.')}</p>`
      : d.status === 'forfeit' ? html`<p class="notice">${d.ranked ? t('{name} forfeited, which counts as a loss.', { name: loser }) : t('{name} forfeited.', { name: loser })}</p>` : ''}
    <div class="btn-row mt-3">
      ${d.mp ? html`<a class="btn" href="${matchUrl(d.mp)}" target="_blank" rel="noopener">${t('Match on osu!')} ↗</a>` : ''}
      <a class="btn" href="/challenges/duels">${t('All duels')}</a>
    </div>

    <section class="section">
      <div class="section-head"><h2>${t('Rounds')}</h2></div>
      ${d.rounds.length ? roundsTable(ctx, d, maps, players) : empty(t('No rounds were played.'))}
    </section>`;
}
