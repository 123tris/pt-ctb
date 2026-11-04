// The Dan course, the Dan tab of Challenges (/challenges/dan, where /dan still leads), as assets/js/pages/dan.js draws
// it: the 19 stages as a ladder, the chosen stage's map and who passed it (?stage=3), then the Dan leaderboard and the
// Discord roles. From dan.json, with players from the core pack. dan.mount.ts picks a stage from the ladder.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { S, DAN_STAGES, DAN_ROLES, danRole } from '../kernel/model.ts';
import { empty } from '../ui/page.ts';
import { avatarSrc, avatarUrl, playerLinkId, rowOf, type Players } from '../ui/players.ts';
import { mapLink, type MapMeta } from '../ui/maps.ts';
import { posBadge, scoreStats, type Play } from '../ui/scores.ts';
import { danName } from '../ui/events.ts';
import { danRoleLore } from '../ui/lore.ts';

/** A stage's map, its details, and who passed it ([player, ...play], best first). */
export interface DanStage {
  index: number;
  map: number;
  meta: MapMeta;
  passers: [number, ...unknown[]][];
}

/** dan.json: each stage, and the leaderboard ([player, points, stages passed, highest stage or -1]), most first. */
export interface Dan {
  stages: DanStage[];
  ladder: [number, number, number, number][];
}

/** A stage of the course (model.js DAN_STAGES, whose rows mix strings and numbers), typed. */
interface Stage {
  index: number;
  key: string;
  glyph: string;
  points: number;
  passAcc: number;
}
const STAGES = DAN_STAGES as unknown as readonly Stage[];

/** The tab's line under the tab strip. */
export const intro = ({ th }: Ctx): Safe => th('The Dan course is the community’s ladder of challenges: 19 maps, each harder than the last. Up to the 10th Dan you pass with 98% accuracy; from the Hebrew letters on (Aleph to Shin) you need 99%. Every stage gives points, and points give Discord roles. Use {updatedan} and {claimdanrole}.', {
  updatedan: html`<span class="kbd">/updatedan</span>`, claimdanrole: html`<span class="kbd">/claimdanrole</span>`,
});

/**
 * The stage shown: ?stage=, or else the highest anyone has passed. One that isn't a stage shows the first (the old
 * page broke on those).
 */
export function readStage(dan: Dan, query: Record<string, string | undefined>): number {
  const n = Number(query.stage ?? dan.stages.findLastIndex(s => s.passers.length)) || 0;
  return Number.isInteger(n) && n >= 0 && n < STAGES.length ? n : 0;
}

/** An avatar's src for a player by osu! id: osu!'s own for someone the site doesn't list. */
const avatarSrcId = (ctx: Ctx, players: Players, id: number, size: number): Safe => {
  const row = rowOf(players, id);
  return row < 0 ? html`src="${avatarUrl(id)}"` : avatarSrc(ctx, players, row, size);
};
const nameOf = (players: Players, id: number) => {
  const row = rowOf(players, id);
  return row < 0 ? '' : players.name.at(row);
};

/** A stage on the ladder: its points, glyph and name, how many passed, and the first five passers' faces. */
function stageCard(ctx: Ctx, stage: Stage, data: DanStage, players: Players, selected: boolean): Safe {
  const { t, fmt } = ctx;
  const passers = data.passers;
  // aria-pressed is "true" or empty, as the old page has it (an html`` false is nothing).
  return html`<button class="dan-stage ${stage.index > 10 ? 'hebrew' : ''} ${passers.length ? '' : 'unpassed'} ${selected ? 'selected' : ''}" data-stage="${stage.index}" type="button" aria-pressed="${selected}">
    <span class="points">${t('{n} pts', { n: fmt.num(stage.points) })}</span>
    <div class="dan-glyph">${stage.glyph}</div>
    <b>${danName(ctx, stage.index)}</b>
    <div class="small muted">${passers.length ? `${fmt.plural(passers.length, 'pass', 'passes')}` : t('No passes yet')}</div>
    ${passers.length ? html`<div class="avatars">
      ${passers.slice(0, 5).map(([uid]) => html`<img ${avatarSrcId(ctx, players, uid, 22)} alt="${nameOf(players, uid)}" title="${nameOf(players, uid)}" width="22" height="22" loading="lazy" decoding="async">`)}
      ${passers.length > 5 ? html`<span class="more">+${passers.length - 5}</span>` : ''}
    </div>` : ''}
  </button>`;
}

/** Every stage on the ladder, `selected` pressed. */
export const ladder = (ctx: Ctx, dan: Dan, players: Players, selected: number): Safe =>
  html`${STAGES.map(stage => stageCard(ctx, stage, dan.stages[stage.index], players, stage.index === selected))}`;

/** The chosen stage: its points and accuracy, its map, and everyone who passed it, best first. */
export function stageDetail(ctx: Ctx, dan: Dan, players: Players, selected: number): Safe {
  const { t, fmt } = ctx;
  const stage = STAGES[selected];
  const data = dan.stages[selected];
  return html`<div class="card">
    <div class="detail-head">
      <h2>${danName(ctx, stage.index)}</h2>
      <span class="faint small">${t('{points} points · needs {acc}%', { points: fmt.num(stage.points), acc: fmt.num(stage.passAcc) })}</span>
    </div>
    <div class="mb-3">${mapLink(ctx, data.map, data.meta)}</div>
    ${data.passers.length ? html`<div class="table-wrap" data-label="${t('Players who passed the {dan}', { dan: danName(ctx, stage.index) })}"><table class="table-compact">
      <thead><tr><th>#</th><th>${t('Player')}</th><th class="num col-opt">${t('Score')}</th><th class="col-opt">${t('Play')}</th><th class="num">${t('Date')}</th></tr></thead>
      <tbody>${data.passers.map(([uid, ...rest], i) => {
        const s = rest as Play;
        return html`<tr>
        <td>${posBadge(ctx, i + 1)}</td>
        <td class="cell-player">${playerLinkId(ctx, players, uid)}<span class="cell-sub"><span class="score-line">${scoreStats(ctx, s)}</span></span></td>
        <td class="num col-opt">${fmt.num(s[S.SCORE])}</td>
        <td class="col-opt"><span class="score-line">${scoreStats(ctx, s)}</span></td><td class="num faint">${fmt.date(s[S.TIME])}</td>
      </tr>`;
      })}</tbody>
    </table></div>` : empty(t('Nobody has passed this stage yet. Glory awaits.'))}
  </div>`;
}

/** The tab's panel: the ladder with `selected` open, the leaderboard and the roles. */
export function render(ctx: Ctx, dan: Dan, players: Players, selected: number): Safe {
  const { t, fmt } = ctx;
  const lore = danRoleLore(ctx);
  return html`
    <div class="section-head"><h2>${t('From Zeroth Dan to Shin')}</h2><span class="muted small">${t('The Dan has run on the server since June 2018. Alphonse sleeps; the site doesn’t.')}</span></div>
    <div class="dan-ladder" id="ladder" role="group" aria-label="${t('Dan stages')}">${ladder(ctx, dan, players, selected)}</div>
    <section class="section" id="detail">${stageDetail(ctx, dan, players, selected)}</section>

    <section class="section grid grid-2">
      <div>
        <h2>${t('Dan leaderboard')}</h2>
        ${dan.ladder.length ? html`<div class="table-wrap"><table class="table-compact">
          <thead><tr><th>#</th><th>${t('Player')}</th><th class="num">${t('Points')}</th><th class="num col-opt">${t('Stages')}</th><th class="col-opt">${t('Highest')}</th></tr></thead>
          <tbody>${dan.ladder.map(([uid, points, count, highest], i) => html`<tr class="${uid === ctx.me ? 'me' : ''}">
            <td class="rank">${i + 1}</td>
            <td class="cell-player">${playerLinkId(ctx, players, uid, 'avatar-sm')}<span class="cell-sub">${fmt.plural(count, 'stage')}${highest >= 0 ? ` · ${t('highest {dan}', { dan: danName(ctx, highest) })}` : ''}</span></td>
            <td class="num">${fmt.num(points)}</td>
            <td class="num col-opt">${count}</td><td class="col-opt">${highest >= 0 ? danName(ctx, highest) : '—'}</td>
          </tr>`)}</tbody>
        </table></div>` : empty(t('Nobody has Dan points yet.'))}
      </div>
      <div>
        <h2>${t('Roles')}</h2>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>${t('Role')}</th><th class="num">${t('Points')}</th><th class="num">${t('Players')}</th></tr></thead>
          <tbody>${[...DAN_ROLES].reverse().map(([min, name]) => {
            const holders = dan.ladder.filter(([, points]) => danRole(points) === name).length;
            const story = lore[name];
            const note = story && (holders === 0 && story.empty ? story.empty : story.text);
            return html`<tr>
              <td><span class="badge badge-gold">${name}</span>${note ? html`<div class="role-lore">${note}</div>` : ''}</td><td class="num">${fmt.num(min as number)}+</td>
              <td class="num">${holders}</td>
            </tr>`;
          })}</tbody>
        </table></div>
        <p class="mt-3 small muted">${t('Stages are worth from {min} (Zeroth Dan) to {max} (Shin) points. Each stage only counts once; replaying it for a higher score only improves your place on this page.', { min: fmt.num(STAGES[0].points), max: fmt.num(STAGES[18].points) })}</p>
      </div>
    </section>
  `;
}
