// /top10/plays: "Plays of <year>", the score showcase (§4.1). Anyone signed in adds a score (an osu! score link, or one
// of a player's plays of the year, which the site already has) or a clip (YouTube, Twitch, Streamable: for plays the
// site can't see), with an optional caption. Everyone can 🔥 endorse each entry once; the most endorsed rise to the top.
// ?player=<id> shows one player's. No bananas for submissions.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { playerLinkId, rowOf } from '../ui/players.ts';
import { signInButton } from '../ui/bananas.ts';
import { MAX_CAPTION, scoreCard, toSec, top10Tabs, troubleNote, type Phase, type Season, type ShowPlay, type Trouble } from '../ui/top10.ts';
import type { Candidate } from '../ui/top10-players.ts';

export interface Data {
  core: CorePack;
  season: Season;
  phase: Phase;
  plays: ShowPlay[];
  trouble: Trouble;
  player: number | null;
  candidates: Candidate[];
  signInHere: boolean;
}

/** The most entries one person can add in a year, and of their own scores (§4.1). */
export const LIMIT = 15;
export const OWN_LIMIT = 5;

const nameOf = (core: CorePack, id: number) => { const r = rowOf(core.players, id); return r < 0 ? `#${id}` : core.players.name.at(r); };

export function playItem(ctx: Ctx, d: Pick<Data, 'core' | 'phase'>, p: ShowPlay): Safe {
  const { t, fmt } = ctx;
  const n = p.endorsements ?? 0;
  const created = toSec(p.created);
  return html`<li class="t10-show" data-play="${p.id}">
    <div class="t10-show-who">${playerLinkId(ctx, d.core.players, p.player, 'avatar-sm')}${p.clip ? html`<span class="t10-pill">🎬 ${t('clip')}</span>` : ''}</div>
    ${p.score_ref || p.score ? scoreCard(ctx, p.score, p.score_ref) : ''}
    ${p.clip ? html`<a class="t10-clip" href="${p.clip}" target="_blank" rel="noopener">▶ ${t('Watch the clip')} ↗</a>` : ''}
    ${p.caption ? html`<p class="t10-caption">“${p.caption}”</p>` : ''}
    <div class="t10-show-foot">
      <button class="t10-endorse ${p.endorsed ? 't10-endorse-on' : ''}" type="button" data-endorse="${p.id}" aria-pressed="${String(Boolean(p.endorsed))}"
        ${ctx.me === null || d.phase === 'before' ? raw('disabled') : ''} aria-label="${t('Endorse: {n}', { n: fmt.num(n) })}">🔥 <b>${fmt.num(n)}</b></button>
      <span class="small faint">${t('shown by {name}', { name: nameOf(d.core, p.submitter) })}${created ? html` · ${fmt.ago(created)}` : ''}</span>
      ${p.submitter === ctx.me ? html`<button class="btn btn-small t10-remove" type="button" data-delete="${p.id}">${t('Remove')}</button>` : ''}
    </div>
  </li>`;
}

/** How many entries you've added this year, of the limits (§4.1). */
export function usedLine(ctx: Ctx, d: Pick<Data, 'plays' | 'season'>): string {
  const { t, fmt } = ctx;
  const mine = d.plays.filter(p => p.submitter === ctx.me);
  const own = mine.filter(p => p.player === ctx.me).length;
  return t('A score from {year} by a PT player that voters should see. Your own count too: it’s how you make your case. {used} of {limit} used ({own} of {ownLimit} your own).',
    { year: d.season.year, used: fmt.num(mine.length), limit: LIMIT, own: fmt.num(own), ownLimit: OWN_LIMIT });
}

/** The form: a score link, a player's plays of the year, or a clip; and the caption. */
export function addForm(ctx: Ctx, d: Data): Safe {
  const { t } = ctx;
  const options = d.candidates.filter(c => c.active).map(c => html`<option value="${c.id}" ${c.id === d.player ? raw('selected') : ''}>${c.name}</option>`);
  return html`<details class="t10-add card" data-add ${d.player !== null ? '' : raw('open')}>
    <summary><h2 class="card-h m-0">${t('Showcase a play')}</h2></summary>
    <p class="small muted" data-used>${usedLine(ctx, d)}</p>
    <div class="chips" role="group" aria-label="${t('What to add')}">
      <button class="chip active" type="button" data-kind="pick" aria-pressed="true">${t('Pick from their plays')}</button>
      <button class="chip" type="button" data-kind="link" aria-pressed="false">${t('Paste a score link')}</button>
      <button class="chip" type="button" data-kind="clip" aria-pressed="false">${t('A clip')}</button>
    </div>
    <form class="t10-add-form" data-form novalidate>
      <label class="t10-field" data-for="pick clip"><span>${t('Player')}</span>
        <select class="select" name="player" data-player-select><option value="">${t('Choose a player…')}</option>${options}</select></label>
      <div data-for="pick" data-year-plays></div>
      <label class="t10-field" data-for="link" hidden><span>${t('osu! score link')}</span>
        <input class="input" name="score" type="url" inputmode="url" placeholder="https://osu.ppy.sh/scores/…" autocomplete="off"></label>
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
  const canAdd = ctx.me !== null && d.phase === 'open' && !d.trouble;
  return html`${top10Tabs(ctx, 'plays', year)}
    <header class="page-head"><h1>${t('Plays of {year}', { year })}</h1>
      <p>${t('The year’s notable scores, picked by the community, for voters who don’t follow everyone. 🔥 the ones that deserve a look; the most endorsed rise to the top.')}</p></header>
    ${troubleNote(ctx, d.trouble === 'signin' ? null : d.trouble)}
    ${canAdd ? addForm(ctx, d) : ctx.me === null ? html`<p class="notice">${t('Sign in with osu! to showcase plays and endorse them.')} ${signInButton(ctx, d.signInHere)}</p>`
      : d.phase === 'before' ? html`<p class="notice">${t('The showcase opens with voting on 1 December.')}</p>` : ''}
    <div class="t10-filters">
      <label class="t10-field t10-field-inline"><span>${t('Player')}</span>
        <select class="select" data-filter-player><option value="">${t('Everyone')}</option>
          ${d.candidates.filter(c => c.active || c.id === d.player).map(c => html`<option value="${c.id}" ${c.id === d.player ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
      ${d.player !== null ? html`<a class="small" href="/top10/dossier/${d.player}/${year}">${t('{name}’s year', { name: nameOf(d.core, d.player) })} →</a>` : ''}
    </div>
    ${list.length ? html`<ul class="t10-show-grid" data-plays>${list.map(p => playItem(ctx, d, p))}</ul>`
      : html`<p class="empty" data-plays>${d.player !== null ? t('Nothing showcased for {name} yet.', { name: nameOf(d.core, d.player) }) : t('Nothing showcased yet.')}</p>`}`;
}
