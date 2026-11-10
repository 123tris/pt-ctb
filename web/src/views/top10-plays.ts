// /top10/plays: "Plays of <year>", the score showcase (§4.1). Anyone signed in adds a score (an osu! score link, or one
// of a player's plays of the year, which the site already has) or a clip (YouTube, Twitch, Streamable: for plays the
// site can't see), with an optional caption. Everyone can endorse each entry once; the most endorsed rise to the top.
// ?player=<id> shows one player's. No bananas for submissions. The showcase has its own window, which opens before
// voting does (season.showcase). A PT player's own scores come first: the form starts on their plays, best first, and
// "Your best scores" shows their plays in it, with how many of the OWN_LIMIT they may add they have (?player=<their id>
// is the way in from the hub and their dossier: caseLink).

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { playerLinkId, rowOf } from '../ui/players.ts';
import { signInButton } from '../ui/bananas.ts';
import {
  MAX_CAPTION, lisbon, replayLink, scoreCard, toSec, top10Tabs, troubleNote, type Phase, type Scope, type Season, type Showcase, type ShowPlay, type Trouble,
} from '../ui/top10.ts';
import type { Candidate } from '../ui/top10-players.ts';

export interface Data {
  /** Which part (§13.11): the season's plays, or "Legendary plays" from any year. */
  scope: Scope;
  core: CorePack;
  season: Season;
  phase: Phase;
  /** The showcase's window: it opens before voting does. */
  showcase: Showcase;
  plays: ShowPlay[];
  trouble: Trouble;
  player: number | null;
  candidates: Candidate[];
  signInHere: boolean;
  /** Whether the viewer is a PT player, who can showcase their own scores. */
  eligible: boolean;
}

/** The most entries one person can add in a season, and of their own scores (§4.1); legendary plays: 10 and 5 (§13.11). */
export const LIMIT = 15;
export const OWN_LIMIT = 5;
export const LEGENDARY_LIMIT = 10;
export const limitOf = (scope: Scope): number => (scope === 'alltime' ? LEGENDARY_LIMIT : LIMIT);

/** The way to showcase your own best scores: the showcase, on your plays (the hub and your dossier show it). */
export function caseLink(ctx: Ctx, scope: Scope = 'year'): Safe {
  return html`<a class="btn btn-primary" href="/top10/plays?${scope === 'alltime' ? 'scope=alltime&' : ''}player=${ctx.me}">${ctx.t('Make your case: showcase up to {n} of your best scores →', { n: OWN_LIMIT })}</a>`;
}

/** Your own scores you've showcased: the ones that count to OWN_LIMIT. */
const ownOf = (ctx: Ctx, plays: readonly ShowPlay[]) => plays.filter(p => p.submitter === ctx.me && p.player === ctx.me);

const nameOf = (core: CorePack, id: number) => { const r = rowOf(core.players, id); return r < 0 ? `#${id}` : core.players.name.at(r); };

export function playItem(ctx: Ctx, d: Pick<Data, 'core' | 'showcase'>, p: ShowPlay): Safe {
  const { t, fmt } = ctx;
  const n = p.endorsements ?? 0;
  const created = toSec(p.created);
  return html`<li class="t10-show" data-play="${p.id}">
    <div class="t10-show-who">${playerLinkId(ctx, d.core.players, p.player, 'avatar-sm')}${p.clip ? html`<span class="t10-pill">${t('clip')}</span>` : ''}</div>
    ${p.score_ref || p.score ? scoreCard(ctx, p.score, p.score_ref) : ''}
    ${p.clip ? html`<a class="t10-clip" href="${p.clip}" target="_blank" rel="noopener">${t('Watch the clip')}</a>` : ''}
    ${replayLink(ctx, p.replay)}
    ${p.caption ? html`<p class="t10-caption">“${p.caption}”</p>` : ''}
    <div class="t10-show-foot">
      <button class="t10-endorse ${p.endorsed ? 't10-endorse-on' : ''}" type="button" data-endorse="${p.id}" aria-pressed="${String(Boolean(p.endorsed))}"
        ${ctx.me === null || d.showcase === 'before' ? raw('disabled') : ''} aria-label="${t('Endorse: {n}', { n: fmt.num(n) })}">${t('Endorse')} <b>${fmt.num(n)}</b></button>
      <span class="small faint">${t('shown by {name}', { name: nameOf(d.core, p.submitter) })}${created ? html` · ${fmt.ago(created)}` : ''}</span>
      ${p.submitter === ctx.me ? html`<span class="t10-own-actions">${d.showcase === 'open' ? html`<button class="btn btn-small" type="button" data-edit="${p.id}">${t('Edit')}</button>` : ''}<button class="btn btn-small t10-remove" type="button" data-delete="${p.id}">${t('Remove')}</button></span>` : ''}
    </div>
  </li>`;
}

/** Editing your own entry (PATCH /api/top10/plays/:id): its caption and clip. A clip-only entry keeps a clip. */
export function editForm(ctx: Ctx, p: ShowPlay): Safe {
  const { t } = ctx;
  const clipOnly = !p.score_ref && !p.score && !p.replay;
  return html`<form class="t10-edit-form" data-edit-form="${p.id}" novalidate>
    <label class="t10-field"><span>${t('Caption (optional)')}</span>
      <input class="input" name="caption" maxlength="${MAX_CAPTION}" value="${p.caption ?? ''}" autocomplete="off"></label>
    <label class="t10-field"><span>${clipOnly ? t('Clip link (YouTube, Twitch or Streamable)') : t('Clip link (optional)')}</span>
      <input class="input" name="clip" type="url" inputmode="url" value="${p.clip ?? ''}" placeholder="https://youtu.be/…" autocomplete="off"></label>
    <p class="small t10-form-msg" data-edit-msg role="status"></p>
    <div class="btn-row"><button class="btn btn-primary btn-small" type="submit">${t('Save')}</button>
      <button class="btn btn-small" type="button" data-edit-cancel="${p.id}">${t('Cancel')}</button></div>
  </form>`;
}

/** How many entries you've added this year, of the limits (§4.1). */
export function usedLine(ctx: Ctx, d: Pick<Data, 'plays' | 'season' | 'scope'>): string {
  const { t, fmt } = ctx;
  const mine = d.plays.filter(p => p.submitter === ctx.me);
  const own = mine.filter(p => p.player === ctx.me).length;
  const vars = { year: d.season.year, used: fmt.num(mine.length), limit: limitOf(d.scope), own: fmt.num(own), ownLimit: OWN_LIMIT };
  const line = d.scope === 'alltime'
    ? t('A play from any year that made PT catch history, for the all-time ballot. {used} of {limit} used ({own} of {ownLimit} your own).', vars)
    : t('A score from {year} by a PT player that voters should see. Your own count too: it’s how you make your case. {used} of {limit} used ({own} of {ownLimit} your own).', vars);
  return `${line} ${t('One play per other player.')}`;
}

/**
 * "Your best scores", at a glance (for a PT player, while the showcase is open): your plays in the showcase, the ones
 * you added (n of OWN_LIMIT) and any others did.
 */
export function mineBox(ctx: Ctx, d: Pick<Data, 'plays' | 'scope' | 'core'>): Safe {
  const { t, fmt } = ctx;
  const own = ownOf(ctx, d.plays);
  const yours = d.plays.filter(p => p.player === ctx.me);
  const vars = { n: fmt.num(own.length), limit: OWN_LIMIT };
  return html`<section class="t10-mine card" data-mine aria-labelledby="t10-mine-h">
    <h2 class="card-h m-0" id="t10-mine-h">${d.scope === 'alltime' ? t('Your legendary plays') : t('Your best scores')} <span class="t10-pill">${t('{n} of {limit}', vars)}</span></h2>
    <p class="small muted">${d.scope === 'alltime'
      ? t('You’ve added {n} of {limit} of your own plays to the legendary ones. All-time voters see them on your career page.', vars)
      : t('You’ve added {n} of {limit} of your own scores. It’s how you make your case: voters see them on your dossier.', vars)}</p>
    ${yours.length ? html`<ul class="t10-show-list">${yours.map(p => html`<li>${p.score ? scoreCard(ctx, p.score, p.score_ref) : p.clip ? html`<div class="t10-score t10-score-bare"><a href="${p.clip}" target="_blank" rel="noopener">${t('Clip')}</a></div>` : ''}
        <span class="small faint">${ctx.tn(p.endorsements ?? 0, '{n} endorsement', '{n} endorsements')}${p.submitter !== ctx.me ? html` · ${t('shown by {name}', { name: nameOf(d.core, p.submitter) })}` : ''}</span></li>`)}</ul>`
      : html`<p class="small m-0">${t('None yet: pick your best from your plays below.')}</p>`}
  </section>`;
}

/** The player the form starts on: the one asked for, else you, when you're a PT player listed there. */
export function formPlayer(ctx: Ctx, d: Pick<Data, 'player' | 'candidates' | 'scope' | 'eligible'>): number | null {
  if (d.player !== null) return d.player;
  const listed = d.candidates.some(c => c.id === ctx.me && (c.active || d.scope === 'alltime'));
  return d.eligible && listed ? ctx.me : null;
}

/** The form: a score link, a player's plays of the year, or a clip; and the caption. It starts on your own plays. */
export function addForm(ctx: Ctx, d: Data): Safe {
  const { t } = ctx;
  const start = formPlayer(ctx, d);
  const options = d.candidates.filter(c => c.active || d.scope === 'alltime').map(c => html`<option value="${c.id}" ${c.id === start ? raw('selected') : ''}>${c.name}</option>`);
  // Open, unless the page is about someone else.
  return html`<details class="t10-add card" data-add ${d.player !== null && d.player !== ctx.me ? '' : raw('open')}>
    <summary><h2 class="card-h m-0">${d.scope === 'alltime' ? t('Add a legendary play') : t('Showcase a play')}</h2></summary>
    <p class="small muted" data-used>${usedLine(ctx, d)}</p>
    <div class="chips" role="group" aria-label="${t('What to add')}">
      <button class="chip active" type="button" data-kind="pick" aria-pressed="true">${t('Search their plays')}</button>
      <button class="chip" type="button" data-kind="link" aria-pressed="false">${t('Paste a score link')}</button>
      <button class="chip" type="button" data-kind="replay" aria-pressed="false">${t('A replay file')}</button>
      <button class="chip" type="button" data-kind="clip" aria-pressed="false">${t('A clip')}</button>
    </div>
    <form class="t10-add-form" data-form novalidate>
      <label class="t10-field" data-for="pick clip"><span>${t('Player')}</span>
        <select class="select" name="player" data-player-select><option value="">${t('Choose a player…')}</option>${options}</select></label>
      <div data-for="pick" data-year-plays></div>
      <label class="t10-field" data-for="link" hidden><span>${t('osu! score link')}</span>
        <input class="input" name="score" type="url" inputmode="url" placeholder="https://osu.ppy.sh/scores/…" autocomplete="off"></label>
      <div class="t10-field" data-for="link replay" hidden><label for="t10-osr"><span data-osr-label>${t('Replay file (optional)')}</span></label>
        <input class="input t10-file" id="t10-osr" name="replay" type="file" accept=".osr" aria-describedby="t10-osr-hint">
        <span class="small faint" id="t10-osr-hint">${t('For unranked or offline plays: attach your replay file (F2 on the results screen in stable, or export in lazer). At most 2 MB. If osu! keeps this score’s replay, the site links to it instead of storing your file.')}</span></div>
      <label class="t10-field" data-for="clip" hidden><span>${t('Clip link (YouTube, Twitch or Streamable)')}</span>
        <input class="input" name="clip" type="url" inputmode="url" placeholder="https://youtu.be/…" autocomplete="off"></label>
      <label class="t10-field"><span>${t('Caption (optional)')}</span>
        <input class="input" name="caption" maxlength="${MAX_CAPTION}" placeholder="${t('Why it’s notable: “first PT FC”, “6 miss HR on a map nobody FCs”')}" autocomplete="off"></label>
      <p class="small t10-form-msg" data-msg role="status"></p>
      <button class="btn btn-primary" type="submit">${t('Add to the showcase')}</button>
    </form>
  </details>`;
}

export function render(ctx: Ctx, d: Data): Safe {
  const { t } = ctx;
  const year = d.season.year;
  const list = d.player === null ? d.plays : d.plays.filter(p => p.player === d.player);
  const canAdd = ctx.me !== null && d.showcase === 'open' && !d.trouble;
  const scopes = html`<nav class="chips t10-kinds" aria-label="${t('Which plays')}">
    <a class="chip ${d.scope === 'year' ? 'active' : ''}" href="/top10/plays" ${d.scope === 'year' ? raw('aria-current="page"') : ''}>${t('Plays of {year}', { year })}</a>
    <a class="chip ${d.scope === 'alltime' ? 'active' : ''}" href="/top10/plays?scope=alltime" ${d.scope === 'alltime' ? raw('aria-current="page"') : ''}>${t('Legendary plays')}</a></nav>`;
  return html`${top10Tabs(ctx, 'plays', year)}
    <header class="page-head"><h1>${d.scope === 'alltime' ? t('Legendary plays') : t('Plays of {year}', { year })}</h1>
      <p>${d.scope === 'alltime'
        ? t('The plays that made PT catch history, from any year, for the all-time ballot. Endorse the ones every voter should know; the most endorsed rise to the top.')
        : t('The year’s notable scores, picked by the community, for voters who don’t follow everyone. Endorse the ones that deserve a look; the most endorsed rise to the top.')}</p></header>
    ${scopes}
    ${troubleNote(ctx, d.trouble === 'signin' ? null : d.trouble)}
    ${canAdd && d.eligible ? mineBox(ctx, d) : ''}
    ${canAdd ? addForm(ctx, d) : ctx.me === null ? html`<p class="notice">${t('Sign in with osu! to showcase plays and endorse them.')} ${signInButton(ctx, d.signInHere)}</p>`
      : d.showcase === 'before' ? html`<p class="notice">${t('The showcase opens {when}: then add up to {n} of your own best scores, and the plays voters should see.', { when: lisbon(ctx, toSec(d.season.showcaseOpens ?? d.season.opens)), n: OWN_LIMIT })}</p>` : ''}
    <div class="t10-filters">
      <label class="t10-field t10-field-inline"><span>${t('Player')}</span>
        <select class="select" data-filter-player><option value="">${t('Everyone')}</option>
          ${d.candidates.filter(c => c.active || d.scope === 'alltime' || c.id === d.player).map(c => html`<option value="${c.id}" ${c.id === d.player ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
      ${d.player !== null ? html`<a class="small" href="/top10/dossier/${d.player}/${d.scope === 'alltime' ? 'alltime' : year}">${d.scope === 'alltime' ? t('{name}’s career', { name: nameOf(d.core, d.player) }) : t('{name}’s year', { name: nameOf(d.core, d.player) })}</a>` : ''}
    </div>
    ${list.length ? html`<ul class="t10-show-grid" data-plays>${list.map(p => playItem(ctx, d, p))}</ul>`
      : html`<p class="empty" data-plays>${d.player !== null ? t('Nothing showcased for {name} yet.', { name: nameOf(d.core, d.player) }) : t('Nothing showcased yet.')}</p>`}`;
}
