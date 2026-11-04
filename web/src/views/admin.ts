// /admin: the admin panel (contract §8), as assets/js/pages/admin.js draws it, for the osu! ids the site and the bot
// list as admins. Nothing here changes anything by itself: every save or action is an admin.* request the bot takes
// from the inbox within 15 minutes, checks again and applies or refuses with a code. Anyone else, signed in or not, gets
// "Admins only" and no data.
//
// The page reads admin.json (the bot's settings schema, current values and log: ui/admin.ts) and the admin's own
// requests (/api/admin/requests), so a change shows as "waiting for the bot" until the bot's next pull and export.
//   Settings  one card per group, each setting with its value as a typed field (number, toggle or list), the default,
//             a "changed" mark and Reset when it's overridden, and when it takes effect. A King of the hill slot and
//             tier's star band (its Min and Max settings) is one row with a two-thumb slider. Each card saves on its own:
//             "Review changes" lists old → new, and "Send" queues one admin.set (or admin.reset, back to the default)
//             per changed key. Fields are checked against min, max, step and length first, for a clear error.
//   Actions   King of the hill's pool (approve, reroll one slot and tier, redraft), cancelling a bounty with or without
//             refunds, adjusting a player's bananas, banning or unbanning a map. Each takes two steps: review, then send.
//   Log       your requests still waiting for the bot first, then the bot's log of admin actions, refusals in words.
// Everything here is pure, the parts admin.mount.ts draws again included; it reads the fields and sends the requests.

import { html, raw, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { HILL_SLOTS, HILL_TIERS } from '../kernel/model.ts';
import { empty, pageHead } from '../ui/page.ts';
import { rowOf, type Players } from '../ui/players.ts';
import { playerPicker, pickedRow } from '../ui/pickers.ts';
import { mapLabel, type MapMeta } from '../ui/maps.ts';
import { bananas, mapIdFrom, signInButton } from '../ui/bananas.ts';
import { goalLabel } from '../ui/bounty.ts';
import { monthLabel, slotName, tierName } from '../ui/hill.ts';
import {
  GROUPS, actionText, describe, effectText, groupName, isAdmin, refusalText, starEdge, valueText,
  type ActionArgs, type AdminRequest, type Panel, type Setting, type SettingValue,
} from '../ui/admin.ts';
import type { Hill } from './hill.ts';
import type { Board, OpenBounty } from './bounties.ts';

/** The admin's own requests, as /api/admin/requests answered (`status` 403: not an admin). */
export interface Mine {
  ok: boolean;
  status: number;
  requests: AdminRequest[];
}

/** What the page loads once signed in. */
export interface Loaded {
  mine: Mine;
  /** admin.json, or null while the bot doesn't publish one. */
  panel: Panel | null;
  core: CorePack;
  /** hill.json (only the month is read), or null before King of the hill. */
  hill: Pick<Hill, 'current'> | null;
  /** bounties.json, or null in data from before it. */
  board: Pick<Board, 'open' | 'maps'> | null;
}

export interface Data {
  /** Signing in works on this address (bananas.js signInHere()). */
  signInHere: boolean;
  /** Null when signed out: nothing else loads then. */
  loaded: Loaded | null;
}

/** The page a visitor gets: the panel, or why not. */
export type View = 'signed-out' | 'admins-only' | 'no-bananas' | 'unreadable' | 'panel';

export function viewOf(ctx: Ctx, data: Data): View {
  const l = data.loaded;
  if (ctx.me === null || !l) return 'signed-out';
  // The endpoint knows who's an admin; when it can't be asked, admin.json's list says whether to show why.
  if (l.mine.status === 403 || (!l.mine.ok && !isAdmin(ctx.me, l.panel))) return 'admins-only';
  if (!l.mine.ok) return l.mine.status === 503 ? 'no-bananas' : 'unreadable';
  return 'panel';
}

/** The panel's state, from its data. mount() keeps one of its own, whose `requests` grow as it sends. */
export interface Admin {
  players: Players;
  panel: Panel | null;
  settings: Setting[];
  byKey: Map<string, Setting>;
  /** The settings' groups, in GROUPS' order (one the site doesn't know first). */
  groups: string[];
  requests: AdminRequest[];
  /** The open bounties with a number: one from before Bananas has none, and can't be cancelled. */
  open: OpenBounty[];
  listed: Set<number>;
  maps: Record<string, MapMeta>;
  /** King of the hill's month, drafted or live. */
  month: NonNullable<Hill['current']> | null;
  draft: boolean;
  /** The requests the bot has logged (its log has them, so they aren't listed twice). */
  logged: Set<string>;
}

export function adminOf(l: Loaded): Admin {
  const settings = l.panel?.settings ?? [];
  const open = (l.board?.open ?? []).filter(r => Number.isSafeInteger(r[8]));
  const month = l.hill?.current ?? null;
  return {
    players: l.core.players,
    panel: l.panel,
    settings,
    byKey: new Map(settings.map(s => [s.key, s])),
    groups: [...new Set(settings.map(s => s.group))].sort((a, b) => GROUPS.indexOf(a) - GROUPS.indexOf(b)),
    requests: l.mine.requests,
    open,
    listed: new Set(open.map(r => r[8]!)),
    maps: l.board?.maps ?? {},
    month,
    draft: month?.status === 'draft',
    logged: new Set((l.panel?.actions ?? []).map(a => a.requestId).filter((id): id is string => Boolean(id))),
  };
}

/** The bot's log lines shown at most. */
const LOG_LIMIT = 100;
/** Log lines before "Show all". */
export const LOG_SHOWN = 15;
const CHEVRON = raw('<svg class="admin-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const keyId = (key: string) => key.replace(/[^A-Za-z0-9]/g, '-');

// ---- Settings fields ----------------------------------------------------------------------------------------------------

/** The field for one setting, showing `value`. Lists with a fixed length get one box each; open lists a text box. */
export function field(ctx: Ctx, s: Setting, value: SettingValue): Safe {
  const { t } = ctx;
  const id = `set-${keyId(s.key)}`;
  const range = { min: s.min ?? '', max: s.max ?? '', step: s.step ?? (s.type === 'int' || s.type === 'intList' ? 1 : 'any') };
  if (s.type === 'bool') {
    return html`<label class="admin-toggle"><input type="checkbox" id="${id}" ${value ? raw('checked') : ''}> <span>${t('On')}</span></label>`;
  }
  const list = value as number[] | null;
  if (s.type === 'intList' && s.length) {
    return html`<div class="admin-list" role="group" aria-labelledby="${id}-text">${Array.from({ length: s.length }, (_, i) => html`<input class="input admin-num" type="number"
      inputmode="numeric" ${i === 0 ? raw(`id="${id}"`) : ''} data-i="${i}" min="${range.min}" max="${range.max}" step="${range.step}"
      value="${list?.[i] ?? ''}" aria-label="${t('Value {n} of {total}', { n: i + 1, total: s.length })}">`)}</div>`;
  }
  if (s.type === 'intList') {
    return html`<input class="input admin-text" type="text" id="${id}" inputmode="numeric" value="${(list ?? []).join(', ')}" aria-describedby="${id}-hint">
      <span class="faint small" id="${id}-hint">${t('1 to 10 whole numbers, separated by commas')}</span>`;
  }
  return html`<input class="input admin-num" type="number" id="${id}" inputmode="${s.type === 'int' ? 'numeric' : 'decimal'}"
    min="${range.min}" max="${range.max}" step="${range.step}" value="${value as number}">`;
}

const inRange = (s: Setting, n: number) => (s.min === null || n >= s.min) && (s.max === null || n <= s.max);
const rangeText = (ctx: Ctx, s: Setting) =>
  (s.min !== null && s.max !== null ? ctx.t('from {min} to {max}', { min: ctx.fmt.num(s.min), max: ctx.fmt.num(s.max) }) : '');

/** What's in a setting's field: the checkbox, the list's values (one per box, or split at its commas), or the box. */
export type Typed = boolean | string[] | string;

/** A field checked: its value, or what's wrong with it. */
export type Checked = { value: SettingValue; error?: undefined } | { error: string; value?: undefined };

/** Checks what's in a setting's field: { value } or { error } (in words, with the allowed range). */
export function checkValue(ctx: Ctx, s: Setting, typed: Typed): Checked {
  const { t } = ctx;
  if (s.type === 'bool') return { value: typed as boolean };
  if (s.type === 'intList') {
    const parts = typed as string[];
    const nums = parts.map(Number);
    if (parts.some(p => p === '') || nums.some(n => !Number.isInteger(n))) return { error: t('Whole numbers only.') };
    if (!s.length && (nums.length < 1 || nums.length > 10)) return { error: t('Give 1 to 10 values.') };
    if (nums.some(n => !inRange(s, n))) return { error: t('Each value goes {range}.', { range: rangeText(ctx, s) }) };
    return { value: nums };
  }
  const text = typed as string;
  const n = Number(text);
  if (text === '' || !Number.isFinite(n)) return { error: t('Enter a number.') };
  if (s.type === 'int' && !Number.isInteger(n)) return { error: t('Whole numbers only.') };
  if (!inRange(s, n)) return { error: t('It goes {range}.', { range: rangeText(ctx, s) }) };
  if (s.type === 'double' && s.step) {
    const steps = (n - (s.min ?? 0)) / s.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) return { error: t('Use steps of {step}.', { step: s.step }) };
  }
  return { value: n };
}

// ---- Star bands: a slot and tier's Min and Max settings on one two-thumb slider ------------------------------------------

export const starsText = (ctx: Ctx, [lo, hi]: readonly number[]): string =>
  `${lo.toLocaleString(ctx.locale)}★ – ${hi.toLocaleString(ctx.locale)}★`;

/** The slider for a band, showing [lo, hi] on the settings' own scale and steps (the .range look of the Maps filter). */
export const rangeField = (ctx: Ctx, min: Setting, max: Setting, [lo, hi]: readonly number[]): Safe => html`<div class="range admin-stars" role="group" aria-labelledby="set-${keyId(min.key)}-text">
    <div class="range-track"><div class="range-fill"></div></div>
    <input type="range" min="${min.min}" max="${min.max}" step="${min.step}" value="${lo}" aria-label="${ctx.t('Minimum stars')}">
    <input type="range" min="${max.min}" max="${max.max}" step="${max.step}" value="${hi}" aria-label="${ctx.t('Maximum stars')}">
  </div>
  <output class="range-out on" data-out>${starsText(ctx, [lo, hi])}</output>`;

// ---- Settings rows and cards --------------------------------------------------------------------------------------------

/** A setting's request still waiting for the bot (a set or a reset), or null. */
const pendingFor = (m: Admin, key: string): AdminRequest | null =>
  m.requests.find(r => r.status === 'pending' && (r.type === 'admin.set' || r.type === 'admin.reset') && r.payload.key === key) ?? null;

function settingRow(ctx: Ctx, m: Admin, s: Setting): Safe {
  const { t } = ctx;
  const id = `set-${keyId(s.key)}`;
  const pending = pendingFor(m, s.key);
  return html`<div class="admin-setting" data-key="${s.key}">
      <div class="admin-setting-text">
        <label for="${id}" id="${id}-text">${describe(ctx, s)}</label>
        <span class="admin-meta"><code>${s.key}</code><span aria-hidden="true"> · </span>${t('default {value}', { value: valueText(ctx, s.default) })}<span aria-hidden="true"> · </span>${effectText(ctx, s.effect)}</span>
        ${s.overridden ? html`<span class="admin-changed">${t('Changed from the default')} <button class="link-button" type="button" data-reset aria-label="${t('Reset {key} to its default', { key: s.key })}">${t('Reset')}</button></span>` : ''}
        ${pending ? html`<span class="req-status">${pending.type === 'admin.reset' ? t('Waiting for the bot: back to the default') : t('Waiting for the bot: {value}', { value: valueText(ctx, pending.payload.value) })}</span>` : ''}
      </div>
      <div class="admin-setting-field">${field(ctx, s, s.value)}</div>
      <p class="admin-error" role="alert" hidden></p>
    </div>`;
}

/** A band's row: both settings, the slider, and one "waiting" line with the band as it will be. */
function rangeRow(ctx: Ctx, m: Admin, min: Setting, max: Setting, { slot, tier }: { slot: string; tier: string }): Safe {
  const { t } = ctx;
  const id = `set-${keyId(min.key)}`;
  const pending = [min, max].map(s => pendingFor(m, s.key));
  const after = [min, max].map((s, i) => (!pending[i] ? s.value
    : pending[i].type === 'admin.reset' ? s.default : pending[i].payload.value)) as number[];
  const mod = slot === 'HR' || slot === 'DT' ? slot : null;
  const name = `${slotName(ctx, slot)} · ${tierName(ctx, tier)}`;
  return html`<div class="admin-setting admin-range" data-key="${min.key}" data-max="${max.key}">
      <div class="admin-setting-text">
        <span class="admin-range-name" id="${id}-text">${name}</span>
        <span class="admin-meta"><code>${min.key.replace('MinStars', '{Min,Max}Stars')}</code><span aria-hidden="true"> · </span>${mod ? html`${t('stars with {mod} on', { mod })}<span aria-hidden="true"> · </span>` : ''}${t('default {value}', { value: starsText(ctx, [min.default as number, max.default as number]) })}<span aria-hidden="true"> · </span>${effectText(ctx, min.effect)}</span>
        ${min.overridden || max.overridden ? html`<span class="admin-changed">${t('Changed from the default')} <button class="link-button" type="button" data-reset aria-label="${t('Reset {key} to its default', { key: name })}">${t('Reset')}</button></span>` : ''}
        ${pending.some(Boolean) ? html`<span class="req-status">${t('Waiting for the bot: {value}', { value: starsText(ctx, after) })}</span>` : ''}
      </div>
      <div class="admin-setting-field">${rangeField(ctx, min, max, [min.value as number, max.value as number])}</div>
      <p class="admin-error" role="alert" hidden></p>
    </div>`;
}

/** A group's rows: a band's Min and Max settings share one row; anything else is a row of its own. */
export const groupRows = (ctx: Ctx, m: Admin, group: string): Value[] => m.settings.filter(s => s.group === group).map(s => {
  const star = starEdge(s.key);
  const min = star && m.byKey.get(s.key.replace(/MaxStars$/, 'MinStars'));
  const max = star && m.byKey.get(s.key.replace(/MinStars$/, 'MaxStars'));
  if (!star || !min || !max || min === max) return settingRow(ctx, m, s);
  return star.edge === 'Min' ? rangeRow(ctx, m, min, max, star) : '';
});

/** A group's summary: how many settings, and how many are changed from the default or waiting for the bot. */
export function groupSummary(ctx: Ctx, m: Admin, group: string): Safe {
  const { tn } = ctx;
  const inGroup = m.settings.filter(s => s.group === group);
  const changed = inGroup.filter(s => s.overridden).length;
  const waiting = inGroup.filter(s => pendingFor(m, s.key)).length;
  return html`<span class="admin-group-name">${groupName(ctx, group)}</span>
      <span class="admin-group-meta">${[
        tn(inGroup.length, '{n} setting', '{n} settings'),
        changed && tn(changed, '{n} changed from the default', '{n} changed from the default'),
        waiting && tn(waiting, '{n} waiting for the bot', '{n} waiting for the bot'),
      ].filter(Boolean).join(' · ')}</span>
      <span class="admin-group-edits" data-edits></span>${CHEVRON}`;
}

/** A card's first saving step: "Review changes…" and how many there are. */
export const saveStep = (ctx: Ctx, n = 0): Safe => html`<div class="shop-step" data-step="save">
    <button class="btn btn-small" type="button" data-review ${n ? '' : raw('disabled')}>${ctx.t('Review changes…')}</button>
    <span class="faint small" data-count>${n ? ctx.tn(n, '{n} change', '{n} changes') : ctx.t('No changes')}</span>
    <p class="shop-error" role="alert" hidden></p>
  </div>`;

/** Each group folds (closed to start), its summary saying what's changed, waiting or edited without being sent. */
const groupCard = (ctx: Ctx, m: Admin, group: string): Safe => html`<details class="admin-group" data-group="${group}">
    <summary class="admin-group-head" id="g-${keyId(group)}">${groupSummary(ctx, m, group)}</summary>
    <div class="admin-group-body">
      <div class="admin-settings">${groupRows(ctx, m, group)}</div>
      <div class="admin-save">${saveStep(ctx)}</div>
    </div>
  </details>`;

/** A change a card is about to send: the setting, its new value, and whether that's a reset to the default. */
export interface Change {
  s: Setting;
  value?: SettingValue;
  reset?: boolean;
}

/** A card's second step: each change, old → new. */
export const confirmChanges = (ctx: Ctx, list: readonly Change[]): Safe => html`<div class="shop-step shop-confirm" data-step="confirm">
    <p>${ctx.tn(list.length, 'Send this change to the bot?', 'Send these {n} changes to the bot?')}</p>
    <ul class="admin-diff">${list.map(c => html`<li><code>${c.s.key}</code> ${valueText(ctx, c.s.value)} → <b>${valueText(ctx, c.value)}</b>${c.reset ? html` <span class="faint">(${ctx.t('the default')})</span>` : ''}</li>`)}</ul>
    <div class="btn-row"><button class="btn btn-small btn-primary" type="button" data-send>${ctx.t('Send')}</button><button class="btn btn-small" type="button" data-back>${ctx.t('Back')}</button></div>
    <p class="shop-error" role="alert" hidden></p>
  </div>`;

// ---- Actions ------------------------------------------------------------------------------------------------------------

/** An action: a small form whose Review button checks it and shows a confirmation. */
const actionForm = (name: string, fields: Value, buttons: Value): Safe => html`<div class="admin-action" data-action="${name}">
    <div class="shop-step" data-step="form">${fields}${buttons}<p class="shop-error" role="alert" hidden></p></div>
  </div>`;
const review = (label: string, which = '', primary = false): Safe =>
  html`<button class="btn btn-small ${primary ? 'btn-primary' : ''}" type="button" data-review="${which}">${label}</button>`;

/** A request's state: waiting, done, or refused with the reason in words. */
export const status = (ctx: Ctx, state: string, code?: string | null, reason?: string | null): Safe => (state === 'pending'
  ? html`<span class="req-status">${ctx.t('waiting for the bot, up to 15 minutes')}</span>`
  : state === 'accepted' ? html`<span class="req-status req-ok">✓ ${ctx.t('done')}</span>`
    : html`<span class="req-status req-no">✕ ${ctx.t('refused: {reason}', { reason: refusalText(ctx, code, reason) })}</span>`);

const when = (ctx: Ctx, iso: string): Safe => {
  const s = Date.parse(iso) / 1000;
  return html`<span class="faint" title="${ctx.fmt.dateTime(s)}">${ctx.fmt.ago(s)}</span>`;
};

/** Your requests of some kinds still waiting for the bot, as lines at the top of their card (a listed bounty says it in its row). */
export function waitingList(ctx: Ctx, m: Admin, prefix: string): Safe | '' {
  const waiting = m.requests.filter(r => r.status === 'pending' && r.type.startsWith(prefix)
    && !(r.type === 'admin.bounty.cancel' && m.listed.has(r.payload.id!)));
  return waiting.length ? html`<ul class="req-list admin-waiting">${waiting.map(r => html`<li><span>${actionText(ctx, r.type, r.payload, m.players)}</span> ${status(ctx, 'pending')} ${when(ctx, r.t)}</li>`)}</ul>` : '';
}

/**
 * King of the hill's pool. A draft waits for an admin: then it's the first card, open, with Approve as the page's one
 * primary action. Once live, approve and redraft would only be refused, so the tools fold away.
 */
function poolCard(ctx: Ctx, m: Admin): Safe {
  const { t } = ctx;
  const { month, draft } = m;
  const slotOptions = HILL_SLOTS.map((s: string) => html`<option value="${s}">${slotName(ctx, s)}</option>`);
  const tierOptions = HILL_TIERS.map((s: string) => html`<option value="${s}">${tierName(ctx, s)}</option>`);
  const poolTools = html`
    ${actionForm('approve', '', review(t('Approve the pool…'), '', draft))}
    ${actionForm('reroll', html`<div class="field"><label for="reroll-slot">${t('Slot')}</label><select class="select" id="reroll-slot">${slotOptions}</select></div>
      <div class="field"><label for="reroll-tier">${t('Tier')}</label><select class="select" id="reroll-tier">${tierOptions}</select></div>`, review(t('Reroll…')))}
    ${actionForm('redraft', '', review(t('Redraft the pool…')))}`;
  return html`<section class="section card admin-card ${draft ? 'admin-attention' : ''}" id="admin-pool" aria-labelledby="admin-pool-h">
    <h2 class="card-h" id="admin-pool-h">${draft ? t('King of the hill pool: waiting for approval') : t('King of the hill pool')}</h2>
    <div data-waiting="admin.hill.">${waitingList(ctx, m, 'admin.hill.')}</div>
    ${draft ? html`<p>${t('{month}’s pool is drafted but not live. Look it over in Discord with !hill pool, then approve it, reroll a slot or draft it again.', { month: monthLabel(ctx, month!.month) })}</p>${poolTools}`
      : html`${month ? html`<p class="muted small">${t('{month}’s pool is live.', { month: monthLabel(ctx, month.month) })}</p>` : ''}
        <details class="admin-fold"><summary>${t('Pool tools')}${CHEVRON}</summary>${poolTools}</details>`}
  </section>`;
}

const cancelWaiting = (m: Admin, id: number) =>
  m.requests.some(r => r.status === 'pending' && r.type === 'admin.bounty.cancel' && r.payload.id === id);

/** An open bounty with its own Cancel; one with a cancel already waiting says so instead. */
function bountyRow(ctx: Ctx, m: Admin, r: OpenBounty): Safe {
  const { t, fmt } = ctx;
  const [mapId, , goal, , , , , , id, pot, , poster, expires] = r;
  const posterRow = poster ? rowOf(m.players, poster) : -1;
  const what = html`<span class="admin-bounty-what"><span><b>#${id}</b> ${goalLabel(ctx, goal) ?? goal} · <a href="/map/${mapId}">${mapLabel(ctx, mapId, m.maps[mapId])}</a></span>
      <span class="faint small">${[pot ? t('{amount} pot', { amount: bananas(ctx, pot) }) : '', poster ? (posterRow >= 0 ? m.players.name.at(posterRow) : '') : t('house bounty'), expires ? t('ends {date}', { date: fmt.date(expires) }) : ''].filter(Boolean).join(' · ')}</span></span>`;
  if (cancelWaiting(m, id!)) return html`<li class="admin-bounty">${what}${status(ctx, 'pending')}</li>`;
  return html`<li class="admin-bounty admin-action" data-action="cancel" data-id="${id}">${what}
      <div class="shop-step" data-step="form">
        <label class="admin-toggle"><input type="checkbox" class="cancel-refund" checked> <span>${t('Refund everyone')}</span></label>
        ${review(t('Cancel…'))}<p class="shop-error" role="alert" hidden></p>
      </div></li>`;
}

function bountyCard(ctx: Ctx, m: Admin): Safe {
  const { t } = ctx;
  return html`<section class="section card admin-card" id="admin-bounties" aria-labelledby="admin-bounties-h">
    <h2 class="card-h" id="admin-bounties-h">${t('Open bounties')} <span class="faint">${m.open.length}</span></h2>
    <div data-waiting="admin.bounty.">${waitingList(ctx, m, 'admin.bounty.')}</div>
    ${m.open.length ? html`<ul class="admin-bounties">${m.open.map(r => bountyRow(ctx, m, r))}</ul>` : html`<p class="muted small">${t('No open bounties.')}</p>`}
    <details class="admin-fold"><summary>${t('Cancel another bounty by number')}${CHEVRON}</summary>
      ${actionForm('cancel', html`<div class="field"><label for="cancel-id">${t('Bounty #')}</label><input class="input admin-num cancel-id" type="number" id="cancel-id" inputmode="numeric" min="1" step="1"></div>
        <label class="admin-toggle"><input type="checkbox" class="cancel-refund" checked> <span>${t('Refund everyone, the fee included')}</span></label>`, review(t('Cancel the bounty…')))}
    </details>
  </section>`;
}

function toolsCard(ctx: Ctx, m: Admin): Safe {
  const { t } = ctx;
  return html`<section class="section card admin-card" id="admin-tools" aria-labelledby="admin-tools-h">
    <h2 class="card-h" id="admin-tools-h">${t('Players and maps')}</h2>
    <div data-waiting="admin.bananas.">${waitingList(ctx, m, 'admin.bananas.')}</div>
    <div data-waiting="admin.map.">${waitingList(ctx, m, 'admin.map.')}</div>
    ${actionForm('adjust', html`<div class="field"><label for="adjust-who">${t('Player')}</label>${playerPicker(m.players, 'adjust-who', -1, t('Player name…'))}</div>
      <div class="field"><label for="adjust-amount">${t('Bananas (− to take)')}</label><input class="input admin-num" type="number" id="adjust-amount" inputmode="numeric" step="1"></div>
      <div class="field"><label for="adjust-note">${t('Note')}</label><input class="input" type="text" id="adjust-note" maxlength="100" placeholder="${t('admin correction')}"></div>`, review(t('Adjust…')))}
    ${actionForm('map', html`<div class="field"><label for="map-id">${t('Beatmap id or link')}</label><input class="input" type="text" id="map-id" autocomplete="off"></div>`,
      html`${review(t('Ban…'), 'ban')}${review(t('Unban…'), 'unban')}`)}
  </section>`;
}

/** An action form's fields as they are (mount reads them off the page): only the ones the form has are there. */
export interface ActionFields {
  slot?: string;
  tier?: string;
  /** A listed bounty's number (its row's), or what's in "Bounty #". */
  id?: string;
  refund?: boolean;
  who?: string;
  amount?: string;
  note?: string;
  map?: string;
}

/** What an action asks the bot for, with a line to read before sending (`note`). */
export interface Action {
  type: string;
  payload: ActionArgs;
  note?: string;
  error?: undefined;
  focus?: undefined;
}

/** Why an action can't be reviewed yet, and the field to fix (a selector). */
export interface Problem {
  error: string;
  focus?: string;
  type?: undefined;
}

/** What an action form (data-action `kind`, its Review button's data-review `which`) asks for. */
export function actionOf(ctx: Ctx, players: Players, kind: string | undefined, which: string | undefined,
  f: ActionFields): Action | Problem {
  const { t } = ctx;
  switch (kind) {
    case 'approve': return { type: 'admin.hill.approve', payload: {} };
    case 'redraft':
      return { type: 'admin.hill.redraft', payload: {}, note: t('This throws the current draft away and drafts a new pool.') };
    case 'reroll': return { type: 'admin.hill.reroll', payload: { slot: f.slot, tier: f.tier } };
    case 'cancel': {
      const id = Number(f.id);
      if (!Number.isSafeInteger(id) || id < 1) return { error: t('Enter the bounty’s number.'), focus: '.cancel-id' };
      const refund = Boolean(f.refund);
      return {
        type: 'admin.bounty.cancel', payload: { id, refund },
        note: refund ? '' : t('Without refunds, the bananas in it stay burned.'),
      };
    }
    case 'adjust': {
      const row = pickedRow(players, f.who ?? '');
      if (row < 0) return { error: t('Pick a player from the list.'), focus: '#adjust-who' };
      const amount = Number(f.amount);
      if (!Number.isSafeInteger(amount) || amount === 0) {
        return { error: t('Enter a whole amount other than 0 (− to take).'), focus: '#adjust-amount' };
      }
      const note = (f.note ?? '').trim();
      return {
        type: 'admin.bananas.adjust', payload: { osuId: players.id[row], amount, ...(note ? { note } : {}) },
        note: note ? t('Note: {note}', { note }) : '',
      };
    }
    case 'map': {
      const beatmapId = mapIdFrom(f.map ?? '');
      if (!beatmapId) return { error: t('Paste a beatmap id or an osu! beatmap link.'), focus: '#map-id' };
      return {
        type: which === 'unban' ? 'admin.map.unban' : 'admin.map.ban', payload: { beatmapId },
        note: which === 'unban' ? t('An unban recalculates pp for every play on the map, which costs osu! requests.') : '',
      };
    }
    default: return { error: '' };
  }
}

/** An action's second step: what it asks for in a line, and Send or Back. */
export const confirmAction = (ctx: Ctx, players: Players, a: Action): Safe => html`<div class="shop-step shop-confirm" data-step="confirm">
    <p>${ctx.th('{action}: send to the bot?', { action: actionText(ctx, a.type, a.payload, players) })}</p>
    ${a.note ? html`<p class="muted small">${a.note}</p>` : ''}
    <div class="btn-row"><button class="btn btn-small btn-primary" type="button" data-send>${ctx.t('Send')}</button><button class="btn btn-small" type="button" data-back>${ctx.t('Back')}</button></div>
    <p class="shop-error" role="alert" hidden></p>
  </div>`;

// ---- The log and the page -----------------------------------------------------------------------------------------------

/** The log: your requests the bot hasn't logged yet, then the bot's log; the first LOG_SHOWN unless `all`. */
export function logList(ctx: Ctx, m: Admin, all: boolean): Safe {
  const { t } = ctx;
  const own = m.requests.filter(r => r.status === 'pending' || !m.logged.has(r.requestId));
  const rows = [
    ...own.map(r => html`<li class="${r.status === 'pending' ? 'admin-pending' : ''}"><span>${actionText(ctx, r.type, r.payload, m.players)}</span>
        ${status(ctx, r.status, r.code, r.reason)} <span class="faint">${t('you')}</span> ${when(ctx, r.t)}</li>`),
    ...(m.panel?.actions ?? []).slice(0, LOG_LIMIT).map(a => html`<li><span>${actionText(ctx, a.kind, a.args, m.players)}</span>
        ${status(ctx, a.status, a.code, a.reason)} <span class="faint">${a.name}${a.via === 'discord' ? ` · ${t('via Discord')}` : ''}</span> ${when(ctx, a.at)}</li>`),
  ];
  if (!rows.length) return empty(t('Nothing yet.'));
  const shown = all ? rows : rows.slice(0, LOG_SHOWN);
  return html`<ul class="req-list admin-log">${shown}</ul>${rows.length > shown.length
    ? html`<button class="btn btn-small" type="button" data-log-all>${t('Show all {n}', { n: rows.length })}</button>` : ''}`;
}

function settingsSection(ctx: Ctx, m: Admin, panel: Panel): Safe {
  const { t, fmt } = ctx;
  return html`<section class="section" id="admin-settings" aria-labelledby="admin-settings-h">
    <div class="admin-settings-head">
      <h2 id="admin-settings-h">${t('Settings')}</h2>
      ${panel.generatedAt ? html`<span class="muted small">${t('as the bot last published them, {ago}', { ago: fmt.ago(panel.generatedAt) })}</span>` : ''}
    </div>
    <div class="admin-filter">
      <div class="field"><label for="admin-find">${t('Find a setting')}</label><input class="input" type="search" id="admin-find" autocomplete="off" placeholder="${t('e.g. stars, tip, shop')}"></div>
      <label class="admin-toggle"><input type="checkbox" id="admin-changed-only"> <span>${t('Only the ones changed from the default')}</span></label>
    </div>
    <p class="muted small" id="admin-find-none" hidden>${t('No setting matches.')}</p>
    ${m.groups.map(g => groupCard(ctx, m, g))}
  </section>`;
}

export function render(ctx: Ctx, data: Data): Safe {
  const { t } = ctx;
  const head = pageHead({
    title: t('Admin'),
    intro: t('Changes go to the bot as requests. It checks them, applies them within 15 minutes and logs them at the bottom of this page.'),
  });
  const only = (extra?: Value) => html`${head}${empty(html`<p>${t('Admins only.')}</p>${extra ?? ''}`)}`;
  const view = viewOf(ctx, data);
  if (view === 'signed-out') return only(signInButton(ctx, data.signInHere));
  if (view === 'admins-only') return only();
  if (view !== 'panel') {
    return html`${head}${empty(view === 'no-bananas' ? t('Admin requests need Bananas set up on this copy of the site.')
      : t('Your requests couldn’t be read. Try again in a moment.'))}`;
  }
  const m = adminOf(data.loaded!);
  return html`${head}
    ${poolCard(ctx, m)}
    ${bountyCard(ctx, m)}
    ${toolsCard(ctx, m)}
    ${m.panel ? settingsSection(ctx, m, m.panel) : html`<p class="notice">${t('The bot hasn’t published its settings yet, so only the actions are here.')}</p>`}
    <section class="section card" id="admin-log" aria-labelledby="admin-log-h"><h2 class="card-h" id="admin-log-h">${t('Log')}</h2><div data-log>${logList(ctx, m, false)}</div></section>`;
}
