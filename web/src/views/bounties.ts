// Bounties, a tab of Challenges (/challenges/bounties), as assets/js/pages/bounties.js draws it: bounties.json
// (tools/lib/bounties.mjs), the bounties posted with the bot's !bounty, the ones claimed and the automatic wanted list,
// and with Bananas on (economy.json) each bounty's pot, "Post a bounty" and Fund. Data from before bounties.json has
// only the wanted list, in challenges.json. Players come from the core pack.
//
// Posting needs RULES.gate earned, a stake of RULES.minStake or more plus the fee, and one post a month. The form shows
// the cost, the wallet (less what's already waiting for the bot) and each rule as a checklist before the button; Fund
// has the shop's two steps (amount, then confirm). The markup of both is here; bounties.mount.ts opens them and sends
// the requests, which the bot judges.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { M } from '../kernel/model.ts';
import { empty } from '../ui/page.ts';
import { playerLinkId, ppText, type Players } from '../ui/players.ts';
import { mapLink, type MapMeta } from '../ui/maps.ts';
import { catChip, type Cat } from '../ui/scores.ts';
import { RULES, bananas, fee, signInButton, walletLine, type Wallet } from '../ui/bananas.ts';
import { claimMods, goalLabel, goalLine, potLine, prizeTags, type Goal, type Pledge, type Pot } from '../ui/bounty.ts';
import { challengeChips, type Running } from '../ui/challenge-chips.ts';

/**
 * An open bounty: [map, cat, goal, posted, players, closest miss, target, pledges, id, pot, funds, poster, expires,
 * mods, stake]. From `id` on it's the bounty's Bananas, all null for one from before them.
 */
export type OpenBounty = [number, Cat, Goal, number | null, number, number | null, number | null, Pledge[], number | null,
  number | null, Pot['funds'], number | null, number | null, string | null, ...unknown[]];

/**
 * A claimed bounty: [map, cat, goal, status, player, at, mods, acc, combo, pp, prizes, payout]. `done` is a goal a play
 * from before the bounty had already met.
 */
export type ClaimedBounty = [number, Cat, Goal, 'claimed' | 'done', number, number | null, string, number | null, number | null,
  number | null, Pledge[], number | null];

/** A boss map nobody has FC'd: [map, cat, players, fewest misses]. */
export type Wanted = [number, Cat, number, number];

/** bounties.json. */
export interface Board {
  open: OpenBounty[];
  hall: ClaimedBounty[];
  wanted: Wanted[];
  maps: Record<string, MapMeta>;
}

/** economy.json's wallets, by osu! id. */
export interface Economy {
  players?: Record<string, Wallet>;
}

/** A request to the bot (economy/api.js), as bananas.js myRequests() lists them. */
export interface WalletRequest {
  type: string;
  status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  /** When it was sent, ISO 8601. */
  t: string;
}

export interface Data {
  players: Players;
  board: Board | null;
  /** challenges.json's maps and, in data from before bounties.json, its wanted list. */
  challenges: { maps: Record<string, MapMeta>; bounties?: Wanted[] };
  economy: Economy | null;
  running: Running;
  /** Signing in works on this address (bananas.js signInHere()). */
  signInHere: boolean;
}

/** The tab's line under the tab strip. */
export const intro = ({ t }: Ctx): string =>
  t('Prizes the community puts up for hard maps: full combo one, pass it first or take its #1, and the bot announces the claim on Discord.');

/** A map's name as plain text, for a button's accessible name. */
export const mapName = (id: number, meta: MapMeta): string =>
  (meta?.[M.TITLE] ? `${meta[M.ARTIST]} - ${meta[M.TITLE]} [${meta[M.VERSION]}]` : `#${id}`);

/** The signed-in visitor's wallet, or null (signed out, or none yet: the bot makes one after the first sign-in). */
export const walletOf = (ctx: Ctx, economy: Economy | null): Wallet | null =>
  (ctx.me !== null ? economy?.players?.[ctx.me] ?? null : null);

const lisbonMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit' });
const monthOf = (sec: number) => lisbonMonth.format(new Date(sec * 1000));

/** A rule the bot will check: [met, text, short] (`short` names what's missing, for the line by "Post a bounty…"). */
export type Check = [boolean, string, string];

/**
 * The rules the bot will check, as the site sees them now. `asked` are the player's bounty.create requests the bot
 * hasn't refused: one it accepted since the last export isn't on the board yet, so a map counts once whichever of the
 * two has it. `free` is the wallet less what's waiting for the bot.
 */
export function postChecks(ctx: Ctx, w: Wallet, free: number, stake: number, open: readonly OpenBounty[], me: number, asked: readonly WalletRequest[]): Check[] {
  const { t, fmt } = ctx;
  const total = stake + fee(stake);
  const month = monthOf(ctx.now());
  const mine = open.filter(r => r[11] === me);
  const waiting = asked.filter(r => monthOf(Date.parse(r.t) / 1000) === month);
  const thisMonth = new Set([...mine.filter(r => r[3] && monthOf(r[3]) === month).map(r => r[0]), ...waiting.map(r => r.payload.map)]).size;
  const openCount = new Set([...mine.map(r => r[0]), ...waiting.map(r => r.payload.map)]).size;
  return [
    [w.e >= RULES.gate, t('{gate} earned (you: {earned})', { gate: fmt.num(RULES.gate), earned: fmt.num(w.e) }),
      t('{n} more earned needed to post.', { n: fmt.num(RULES.gate - w.e) })],
    [stake >= RULES.minStake, t('A stake of {min} or more', { min: fmt.num(RULES.minStake) }), t('The stake starts at {min}.', { min: bananas(ctx, RULES.minStake) })],
    [free >= total, t('Your wallet covers {total} (you have {balance})', { total: bananas(ctx, total), balance: bananas(ctx, free) }),
      t('Short by {n} for a stake of {stake}.', { n: bananas(ctx, total - free), stake: fmt.num(stake) })],
    [thisMonth < RULES.postsPerMonth, t('One bounty a month (this month: {n})', { n: fmt.num(thisMonth) }), t('You’ve posted this month’s bounty. Next month!')],
    [openCount < RULES.openAtOnce, t('Two open at most (you have {n})', { n: fmt.num(openCount) }), t('You have two bounties open already.')],
  ];
}

/** The line by "Post a bounty…": the first rule that fails at the minimum stake, or ''. */
export const postHint = (ctx: Ctx, w: Wallet, free: number, open: readonly OpenBounty[], me: number, asked: readonly WalletRequest[]): string =>
  postChecks(ctx, w, free, RULES.minStake, open, me, asked).find(c => !c[0])?.[2] ?? '';

const checkList = (ctx: Ctx, checks: readonly Check[]): Safe => html`<ul class="checks-list">${checks.map(([ok, text]) => html`<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✕'}</span> ${text}<span class="sr-only"> (${ok ? ctx.t('met') : ctx.t('not met')})</span></li>`)}</ul>`;

/** What the post form's chips have picked. */
export interface PostChoice {
  goal: Goal;
  mods: string[];
  days: number;
}

/** A chip of the post form; its group's chips get pressed as the choice changes. */
const chip = (attr: string, value: string | number, label: string, on: boolean): Safe =>
  html`<button class="chip ${on ? 'active' : ''}" type="button" data-${raw(attr)}="${value}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
const chipGroupOf = (attr: string, label: string, items: [string | number, string][], on: (value: string) => boolean): Safe => html`<div class="field"><span class="field-label" id="post-${raw(attr)}-label">${label}</span>
    <div class="chips" role="group" aria-labelledby="post-${raw(attr)}-label">${items.map(([value, text]) => chip(attr, value, text, on(String(value))))}</div></div>`;

/** Whether a post form chip (data-goal, data-mod or data-days) is on for the choice. */
export const chipOn = (choice: PostChoice): Record<'goal' | 'mod' | 'days', (value: string) => boolean> => ({
  goal: v => choice.goal === v,
  mod: v => choice.mods.includes(v),
  days: v => choice.days === Number(v),
});

/** The post form's fields: the map (`mapText`, as typed or from "Post a bounty on it"), the stake and the chips. */
export function postFields(ctx: Ctx, mapText: string, choice: PostChoice): Safe {
  const { t } = ctx;
  const on = chipOn(choice);
  return html`
      <div class="post-grid">
        <div class="field"><label for="post-map">${t('Map')}</label>
          <input class="input" id="post-map" value="${mapText}" placeholder="${t('Map id or osu! link')}" autocomplete="off"></div>
        <div class="field"><label for="post-stake">${t('Stake')}</label>
          <input class="input" id="post-stake" type="number" inputmode="numeric" min="${RULES.minStake}" step="50" value="${RULES.minStake}"></div>
        ${chipGroupOf('goal', t('Goal'), [['fc', t('Full combo')], ['pass', t('First pass')], ['snipe', t('Take the #1')]], on.goal)}
        ${chipGroupOf('mod', t('Mods asked for (optional)'), RULES.mods.map((m): [string, string] => [m, m]), on.mod)}
        ${chipGroupOf('days', t('Runs for'), RULES.days.map((d): [number, string] => [d, t('{n} days', { n: d })]), on.days)}
      </div>
      <p class="small muted" id="post-snipe" hidden>${t('A snipe bounty targets whoever holds the #1 when it’s posted, unless they have the snipe shield on.')}</p>
      <div id="post-sum"></div>
      <div class="btn-row">
        <button class="btn btn-primary" type="submit" disabled>${t('Post bounty')}</button>
        <span class="small muted" id="post-why" aria-live="polite"></span>
      </div>`;
}

/** Under the post form's fields: what it costs, what's left after, and each rule. */
export function postSummary(ctx: Ctx, stake: number, free: number, checks: readonly Check[]): Safe {
  const { t } = ctx;
  const total = stake + fee(stake);
  return html`
      <dl class="kv post-cost">
        <div><dt>${t('Stake')}</dt><dd>${bananas(ctx, stake)}</dd></div>
        <div><dt>${t('Fee (burned)')}</dt><dd>${bananas(ctx, fee(stake))}</dd></div>
        <div><dt>${t('Total')}</dt><dd>${bananas(ctx, total)}</dd></div>
        ${total > free ? html`<div><dt>${t('Short by')}</dt><dd>${bananas(ctx, total - free)}</dd></div>`
          : html`<div><dt>${t('Left after')}</dt><dd>${bananas(ctx, free - total)}</dd></div>`}
      </dl>
      ${checkList(ctx, checks)}`;
}

/** Fund's first step: how much to add to bounty `id`'s pot. */
export const fundPick = (ctx: Ctx, id: number, amount: number): Safe => html`<form class="fund-row" novalidate>
        <div class="field"><label for="fund-${id}">${ctx.t('Add to the pot')}</label>
          <input class="input" id="fund-${id}" type="number" inputmode="numeric" min="${RULES.minFund}" step="5" value="${amount}"></div>
        <button class="btn btn-small" type="submit">${ctx.t('Fund…')}</button>
        <p class="small muted fund-note" aria-live="polite"></p>
        <p class="small faint">${ctx.t('Funding a bounty means you can’t claim it yourself.')}</p>
      </form>`;

/** The line under Fund's amount: what's wrong with it, or the wallet before and after. */
export function fundNote(ctx: Ctx, amount: number, free: number): string {
  const { t } = ctx;
  return amount < RULES.minFund ? t('At least {min}.', { min: bananas(ctx, RULES.minFund) })
    : amount > free ? t('Your wallet has {balance} free.', { balance: bananas(ctx, free) })
      : t('Your wallet: {balance}, then {after}. No fee. If nobody claims it, 70% comes back.', { balance: bananas(ctx, free), after: bananas(ctx, free - amount) });
}

/** Fund's second step: the amount, the map and the wallet before and after, to confirm. */
export const fundConfirm = (ctx: Ctx, amount: number, map: string, free: number): Safe => html`<div class="fund-confirm">
        <p>${ctx.th('Add {amount} to the pot on {map}?', { amount: html`<b>${bananas(ctx, amount)}</b>`, map })}</p>
        <p class="small muted">${ctx.t('Your wallet goes from {balance} to {after}. You won’t be able to claim this bounty.', { balance: bananas(ctx, free), after: bananas(ctx, free - amount) })}</p>
        <div class="btn-row">
          <button class="btn btn-small btn-primary" type="button" data-confirm>${ctx.t('Confirm')}</button>
          <button class="btn btn-small" type="button" data-cancel>${ctx.t('Cancel')}</button>
        </div>
        <p class="small fund-error" aria-live="polite"></p>
      </div>`;

/** Why Fund can't go further: signed out, or no wallet yet. */
export const fundSignIn = (ctx: Ctx, signInHere: boolean): Safe =>
  html`<p class="small muted">${ctx.t('Sign in with osu! to fund a bounty.')}</p>${signInButton(ctx, signInHere)}`;
export const noWallet = (ctx: Ctx): Safe =>
  html`<p class="small muted">${ctx.t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`;

/** The "Post a bounty" section: the rules in one line, then the form (signed in) or a sign-in button. */
function postSection(ctx: Ctx, data: Data, open: readonly OpenBounty[]): Safe {
  const { t, fmt } = ctx;
  const w = walletOf(ctx, data.economy);
  return html`<section id="post-bounty">
    <div class="section-head"><h2>${t('Post a bounty')}</h2></div>
    <p class="muted small">${t('Posting takes {gate} bananas earned, a stake of {stake} or more held until the bounty ends, and a fee of 20% of the stake, which is burned. One a month, two open at most. Anyone signed in can add {fund} or more to a pot.', {
      gate: fmt.num(RULES.gate), stake: fmt.num(RULES.minStake), fund: fmt.num(RULES.minFund),
    })} ${t('Nobody can claim a bounty they posted or funded.')}</p>
    ${ctx.me === null ? html`<div class="btn-row">${signInButton(ctx, data.signInHere, t('Sign in to post or fund'))}</div>`
      : !w ? noWallet(ctx)
        : html`<div class="btn-row"><button class="btn" type="button" id="post-open" aria-expanded="false" aria-controls="post-form">${t('Post a bounty…')}</button>
          <span class="small muted" id="post-wallet">${walletLine(ctx, w, 0)}</span></div>
          <p class="small post-hint" id="post-hint">${postHint(ctx, w, w.b, open, ctx.me, [])}</p>
        <form class="post-form" id="post-form" hidden novalidate></form>`}
  </section>`;
}

/** The tab's panel: the open bounties, posting (first when signed in), the hall of fame and the wanted list. */
export function render(ctx: Ctx, data: Data): Safe {
  const { t, th, tn, fmt } = ctx;
  const { players, board, economy: eco, running } = data;
  const maps = board?.maps ?? data.challenges.maps;
  const open = board?.open ?? [];
  const hall = board?.hall ?? [];
  const wanted = board?.wanted ?? data.challenges.bounties ?? [];
  const signedIn = ctx.me !== null;
  const openSection = html`<section class="${eco && signedIn ? 'section' : ''}">
    <div class="section-head"><h2>${t('Open bounties')}</h2></div>
    ${open.length ? html`<div class="rows">${open.map(([id, cat, goal, posted, n, misses, target, pledges, bountyId, pot, funds, poster, expires, mods]) => html`<div class="row bounty">
      <div>${mapLink(ctx, id, maps[id])}</div>
      <div class="row-meta">${catChip(ctx, cat)}
        <span>${n ? tn(n, '{n} player tried', '{n} players tried') : t('nobody has tried')}</span>
        ${goal === 'fc' && misses !== null ? html`<span>${t('closest: {misses}', { misses: fmt.plural(misses, 'miss', 'misses') })}</span>` : ''}
        ${posted ? html`<span class="faint">${t('posted {ago}', { ago: fmt.ago(posted) })}</span>` : ''}
        ${challengeChips(ctx, id, running, 'bounty')}</div>
      <div class="bounty-foot">${goalLine(ctx, goal, target, players)}${mods ? claimMods(mods) : ''}${prizeTags(ctx, pledges)}</div>
      ${pot ? potLine(ctx, { pot, funds, poster, expires }, players) : ''}
      ${eco && bountyId ? html`<div class="bounty-fund" data-map="${id}"><button class="btn btn-small" type="button" data-fund="${bountyId}" aria-expanded="false"
          aria-label="${t('Fund the bounty on {map}', { map: mapName(id, maps[id]) })}">${t('Fund')}</button>
        <div class="fund-form" hidden></div></div>` : ''}
    </div>`)}</div>` : empty(t('No open bounties right now.'))}
  </section>`;
  // Signed in, posting comes first (it's what you can do); signed out, what's on offer does.
  const post = eco ? postSection(ctx, data, open) : '';
  return html`
    ${signedIn ? html`${post}${openSection}` : html`${openSection}${post ? html`<div class="section">${post}</div>` : ''}`}

    <section class="section">
      <div class="section-head"><h2>${t('Hall of fame')}</h2><span class="muted small">${t('Bounties claimed, newest first.')}</span></div>
      ${hall.length ? html`<div class="rows">${hall.map(([id, , goal, status, uid, at, mods, acc, combo, pp, prizes, payout]) => html`<div class="row bounty ${status === 'done' ? 'bounty-done' : ''}">
        <div class="row-main">${mapLink(ctx, id, maps[id])}
          <div class="justify-start row-meta">${playerLinkId(ctx, players, uid, 'avatar-sm')} <span>${goalLabel(ctx, goal)}</span>
            ${at ? html`<time class="faint" datetime="${new Date(at * 1000).toISOString()}">${fmt.date(at)}</time>` : ''}</div></div>
        <div class="row-meta">${claimMods(mods)} ${acc !== null ? html`<span class="acc">${fmt.acc(acc)}</span>` : ''}
          ${combo !== null ? html`<span class="combo">${fmt.num(combo)}x</span>` : ''} ${pp !== null ? ppText(ctx, pp) : ''}</div>
        ${status === 'done' ? html`<div class="bounty-foot"><span class="faint">${t('already done before it was posted')}</span></div>`
          : prizes.length || payout ? html`<div class="bounty-foot">${payout ? html`<span class="pot">${th('took {amount}', { amount: html`<b>${bananas(ctx, payout)}</b>` })}</span>` : ''}${prizeTags(ctx, prizes)}</div>` : ''}
      </div>`)}</div>` : empty(t('Nobody has claimed a bounty yet.'))}
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('Wanted')}</h2><span class="muted small">${t('Boss maps (6.5★ and up) that several Portuguese players have passed but nobody has FC’d.')}</span></div>
      <p class="muted small">${eco ? th('Post any of these with {command} or the form above.', { command: html`<code>!bounty create</code>` })
        : th('A moderator can post any of these with {command}.', { command: html`<code>!bounty add</code>` })}</p>
      ${wanted.length ? html`<div class="rows">${wanted.map(([id, cat, n, fewest]) => html`<div class="row">
        <div>${mapLink(ctx, id, maps[id])}</div>
        <div class="row-meta">${catChip(ctx, cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span>${t('closest: {misses}', { misses: fmt.plural(fewest, 'miss', 'misses') })}</span><span class="bounty-tag">${t('Nobody’s FC’d this. Yet.')}</span>
          ${eco && signedIn ? html`<button class="link-button" type="button" data-post-map="${id}">${t('Post a bounty on it')}</button>` : ''}</div>
      </div>`)}</div>` : empty(t('Every boss map has an FC or a bounty on it.'))}
    </section>`;
}
