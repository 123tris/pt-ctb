// The admin panel's words and rules (contract §8), as assets/js/core/admin.js has them, for views/admin.ts: admin.json's
// shapes (the bot's settings schema and action log, tools/lib/admin.mjs), who's an admin, the settings' groups, effects
// and descriptions in the visitor's language, a value as text, what an action asks for in a line, the bot's refusal
// codes and the endpoints' answers in words. Sending requests needs the browser: views/admin.mount.ts.
//
// The bot is the authority: it checks the admin list and every value again, and refuses with a `code`. The site's
// checks (ADMIN_OSU_IDS on the server, admin.json's `admins` and ranges here) only hide what isn't yours and give nicer
// errors sooner.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { bananas } from './bananas.ts';
import { slotName, tierName } from './hill.ts';
import { playerName, type Players } from './players.ts';

/** A setting's value: a number, on/off, or a list of whole numbers. */
export type SettingValue = number | boolean | number[];

/** One setting in admin.json: its schema, current value and default. */
export interface Setting {
  key: string;
  group: string;
  type: 'int' | 'double' | 'bool' | 'intList';
  min: number | null;
  max: number | null;
  step: number | null;
  /** A list's fixed length, or null for an open list (1 to 10 values). */
  length: number | null;
  value: SettingValue;
  default: SettingValue;
  overridden: boolean;
  /** When a change takes effect: now, next_draft or next_recap. */
  effect: string;
  /** The bot's English, for a key the site doesn't know yet. */
  description: string;
}

/** What an admin request or logged action asks for (its payload, or the log's args). */
export interface ActionArgs {
  key?: string;
  value?: SettingValue;
  slot?: string;
  tier?: string;
  id?: number;
  refund?: boolean;
  osuId?: number;
  amount?: number;
  note?: string;
  beatmapId?: number;
}

/** A line of the bot's log of admin actions, newest first, from the site or Discord. */
export interface LoggedAction {
  at: string;
  /** The site request it answers; none for one sent on Discord. */
  requestId?: string | null;
  osuId: number;
  name: string;
  via: string;
  kind: string;
  args: ActionArgs;
  status: string;
  reason?: string | null;
  code?: string | null;
}

/** admin.json. */
export interface Panel {
  generatedAt: number;
  admins: { osuId: number; name: string }[];
  settings: Setting[];
  actions: LoggedAction[];
}

/** One of the signed-in admin's own requests (economy/store.js listRequests), newest first. */
export interface AdminRequest {
  requestId: string;
  type: string;
  payload: ActionArgs;
  /** When it was sent, ISO 8601. */
  t: string;
  status: string;
  reason: string | null;
  code: string | null;
}

/** The admins when admin.json doesn't say (the bot's and the server's default, economy/api.js ADMIN_DEFAULT). */
const ADMIN_DEFAULT = [3821475, 6205809];

/** Whether an osu! id is one of the admins, by admin.json's list (or the default without one). */
export const isAdmin = (id: number | null, panel: Panel | null): boolean =>
  Boolean(id) && (panel?.admins?.length ? panel.admins.map(a => a.osuId) : ADMIN_DEFAULT).includes(id!);

/** Why an admin request didn't go through, from the endpoint's status and answer (its own message, in words). */
export function problemText(ctx: Ctx, status: number, body: { error?: string } | null | undefined): string {
  const { t } = ctx;
  return status === 401 ? t('Your sign-in has run out. Sign in with osu! again.')
    : status === 403 ? t('Admins only.')
      : status === 503 ? t('Admin requests need Bananas set up on this copy of the site.')
        : status === 429 ? t('Too many admin requests are waiting for the bot. It takes them every 15 minutes; try again after.')
          // The endpoints' messages are in pt.js too (core/admin.js SERVER_TEXT).
          : body?.error ? t(body.error) : t('That didn’t go through. Try again in a moment.');
}

/** The toast after sending: one for however many went. */
export const sentText = (ctx: Ctx, n: number): string => (n === 1
  ? ctx.t('Sent to the bot. It applies it within 15 minutes; the log below shows the answer.')
  : ctx.t('{n} changes sent to the bot. It applies them within 15 minutes; the log below shows the answers.', { n }));

// ---- Settings: names, groups, effects ---------------------------------------------------------------------------------

/**
 * A table of texts made once per language, as the old module made its tables when it loaded: keyed by the Ctx's t(),
 * which is the same function for every Ctx of one language.
 */
function perLanguage<T>(make: (t: Ctx['t']) => T): (ctx: Ctx) => T {
  const made = new WeakMap<Ctx['t'], T>();
  return ({ t }) => {
    let table = made.get(t);
    if (table === undefined) made.set(t, table = make(t));
    return table;
  };
}

/** The groups in the order the page shows them. */
export const GROUPS = [
  'King of the hill', 'King of the hill: stars', 'Bananas: earning', 'Bananas: bounties and tips', 'Bananas: shop', 'Weekly',
];

const groupNames = perLanguage(t => ({
  'King of the hill': t('King of the hill'),
  'King of the hill: stars': t('King of the hill: stars'),
  'Bananas: earning': t('Bananas: earning'),
  'Bananas: bounties and tips': t('Bananas: bounties and tips'),
  'Bananas: shop': t('Bananas: shop'),
  Weekly: t('Weekly'),
} as Record<string, string>));

export const groupName = (ctx: Ctx, group: string): string => groupNames(ctx)[group] ?? group;

const effects = perLanguage(t => ({
  now: t('Takes effect now'),
  next_draft: t('From the next pool draft or reroll'),
  next_recap: t('From the next weekly recap'),
} as Record<string, string>));

/** When a change takes effect, in words (the bot's code for one the site doesn't know). */
export const effectText = (ctx: Ctx, effect: string): string => effects(ctx)[effect] ?? effect;

const shopItemNames = perLanguage(t => ({
  title: t('Profile title'), signature: t('Signature play'), colour: t('Name colour'), motw: t('Map of the week pick'),
  wildcard: t('King of the hill wildcard'), role: t('Discord colour role'),
} as Record<string, string>));

/** Each setting's description in the visitor's language, by key (contract §8's table). */
const descriptions = perLanguage(t => ({
  'Hill.NoRepeatMonths': t('Months a pooled map sits out before it can be picked again.'),
  'Hill.FewPlayers': t('Maps at most this many PT players have played are picked first.'),
  'Hill.ModChecksPerSlot': t('Maps the HR and DT slots check against osu!’s modded stars (2 osu! requests each).'),
  'Hill.TournamentMapsOnly': t('Pick only catch tournament maps (o!TR’s list).'),
  'Hill.ConvertFallbackToRanked': t('When no tournament convert fits, let the convert slot take any ranked one.'),
  'Hill.SlotModShare': t('A slot prefers maps whose tournament plays were mostly (this %) with its mod.'),
  'Hill.FreeModShare': t('FM prefers maps played under two or more of NM, HD and HR, each at least this %.'),
  'Hill.PinPool': t('Pin the month’s pool post.'),
  'Hill.ComboWeight': t('hillScore’s weight on the combo fraction. New plays only.'),
  'Hill.AccWeight': t('hillScore’s weight on accuracy squared. New plays only.'),
  'Hill.HiddenMultiplier': t('The FM slot’s multiplier for HD. New plays only.'),
  'Hill.HardRockMultiplier': t('The FM slot’s multiplier for HR. New plays only.'),
  'Hill.HiddenHardRockMultiplier': t('The FM slot’s multiplier for HDHR. New plays only.'),
  'Hill.BoardSize': t('How many players each map’s board keeps.'),
  'Bananas.DailyPlay': t('The first pass of the Lisbon day.'),
  'Bananas.DailyStreak3Bonus': t('Extra on the daily play from a 3-day streak.'),
  'Bananas.DailyStreak7Bonus': t('Extra on the daily play from a 7-day streak.'),
  'Bananas.DailyPlayMinStars': t('The daily play’s lowest star rating.'),
  'Bananas.DailyGame': t('The site’s daily game, by the try it was solved on (1st, 2nd, 3rd).'),
  'Bananas.DailyGameWeekBonus': t('Solving all 7 days of the Lisbon week.'),
  'Bananas.Snipe': t('Taking a PT #1.'),
  'Bananas.SnipeStarBonus': t('A snipe’s extra by star band.'),
  'Bananas.SnipeAge1YearBonus': t('A snipe’s extra for a #1 held a year.'),
  'Bananas.SnipeAge3YearBonus': t('A snipe’s extra for a #1 held three years.'),
  'Bananas.SnipeFlat': t('A back-and-forth snipe or one in the map’s cooldown.'),
  'Bananas.SnipeBackAndForthDays': t('Days a #1 traded back counts as back-and-forth.'),
  'Bananas.SnipeMapCooldownDays': t('Days after a full snipe the same map pays flat.'),
  'Bananas.SnipeMinPlayers': t('PT players with a play on the map (the taker included) before a snipe pays.'),
  'Bananas.HillTake': t('Taking a King of the hill board’s #1.'),
  'Bananas.HillTakesPerSlot': t('Paid hill takes per slot a month.'),
  'Bananas.WeeklySoftCap': t('Repeatable earnings a week before they pay half.'),
  'Bananas.FirstFc': t('A map’s first PT FC, by star tier.'),
  'Bananas.FirstFcMinStars': t('A first FC’s lowest star rating.'),
  'Bananas.FirstPass': t('A map’s first PT pass.'),
  'Bananas.FirstPassMinStars': t('A first pass’s lowest star rating.'),
  'Bananas.HillCrownOpen': t('The month’s open crown.'),
  'Bananas.HillCrownChallenger': t('The month’s challenger crown.'),
  'Bananas.HillKing': t('King of the hill for the month.'),
  'Bananas.HillSlotKing': t('Holding a slot at the month’s end.'),
  'Bananas.HillAllRounder': t('The month’s all-rounder.'),
  'Bananas.MotwPlay': t('A play on the map of the week.'),
  'Bananas.MotwTop': t('The map of the week’s top 3.'),
  'Bananas.Vote': t('Voting for the next map of the week.'),
  'Bananas.DanBase': t('A first Dan pass, before the per-level part.'),
  'Bananas.DanPerLevel': t('A first Dan pass, per level.'),
  'Bananas.BadgeCommon': t('Unlocking a common badge.'),
  'Bananas.BadgeUncommon': t('Unlocking an uncommon badge.'),
  'Bananas.BadgeRare': t('Unlocking a rare badge.'),
  'Bananas.Record': t('Setting a community record.'),
  'Bananas.PouchCap': t('What the pouch holds before sign-in; above it is lost.'),
  'Bananas.BountyGate': t('Bananas earned before a player may post a bounty.'),
  'Bananas.BountyMinStake': t('A bounty’s smallest stake.'),
  'Bananas.BountyFeePercent': t('The posting fee, % of the stake (burned).'),
  'Bananas.BountiesPerMonth': t('Bounties a player may post a Lisbon month.'),
  'Bananas.BountiesOpenAtOnce': t('Bounties a player may have open at once.'),
  'Bananas.BountyMinFund': t('The smallest amount to add to a bounty.'),
  'Bananas.BountyDays': t('The lengths a bounty can run, in days.'),
  'Bananas.BountyDefaultDays': t('A bounty’s length when none is picked (one of the lengths).'),
  'Bananas.BountyExpiryRefundPercent': t('What an expired bounty refunds, % (the rest is burned).'),
  'Bananas.ClaimsPerPosterPerYear': t('Bounties a player may claim from the same poster in a year.'),
  'Bananas.TipMin': t('The smallest tip.'),
  'Bananas.TipDailySent': t('Tips a player may send a day.'),
  'Bananas.TipWeeklyReceived': t('Tips a player may receive a week.'),
  'Bananas.TipPairMonthly': t('Tips from one player to another a month.'),
  'Bananas.ShopTitle': t('A profile title.'),
  'Bananas.ShopSignature': t('A signature play.'),
  'Bananas.ShopColour': t('A name colour, per period.'),
  'Bananas.ShopColourDays': t('Days in a name colour’s period.'),
  'Bananas.ShopMotw': t('A map of the week nomination.'),
  'Bananas.ShopWildcard': t('A King of the hill wildcard map.'),
  'Bananas.ShopRole': t('A Discord colour role, per period.'),
  'Bananas.ShopRoleDays': t('Days in a Discord role’s period.'),
  'Bananas.ShopWildcardsPerMonth': t('Wildcards all of PT can buy a Lisbon month.'),
  'Weekly.PinRecap': t('Pin each weekly recap.'),
} as Record<string, string>));

/** Dictionary entries share one description per dictionary, with the entry named. */
const entryDescriptions = (ctx: Ctx, dictionary: string, item: string): string | null =>
  (dictionary === 'Bananas.ShopEarnedGate' ? ctx.t('{item}: bananas earned before buying it (0: no gate).', { item })
    : dictionary === 'Bananas.ShopMaxPeriods' ? ctx.t('{item}: periods one purchase can buy.', { item }) : null);

/** A King of the hill star band edge's key (Hill.HR.OpenMinStars) as { slot, tier, edge: 'Min' | 'Max' }, else null. */
export function starEdge(key: string): { slot: string; tier: string; edge: 'Min' | 'Max' } | null {
  const m = /^Hill\.([A-Z]{2})\.(Open|Challenger)(Min|Max)Stars$/.exec(key);
  return m ? { slot: m[1], tier: m[2].toLowerCase(), edge: m[3] as 'Min' | 'Max' } : null;
}

/** A setting's description in the visitor's language, or the bot's English for a key the site doesn't know. */
export function describe(ctx: Ctx, s: Setting): string {
  const known = descriptions(ctx)[s.key];
  if (known) return known;
  const star = starEdge(s.key);
  if (star) {
    const named = { slot: slotName(ctx, star.slot), tier: tierName(ctx, star.tier) };
    return star.edge === 'Min' ? ctx.t('{slot}, {tier}: minimum stars.', named)
      : ctx.t('{slot}, {tier}: maximum stars (not included).', named);
  }
  const [section, prop, entry] = s.key.split('.');
  return (entry && entryDescriptions(ctx, `${section}.${prop}`, shopItemNames(ctx)[entry.toLowerCase()] ?? entry)) || s.description;
}

/** A value as text: "on"/"off", "5, 3, 1", or the number. */
export const valueText = (ctx: Ctx, v: SettingValue | undefined): string =>
  (typeof v === 'boolean' ? (v ? ctx.t('on') : ctx.t('off')) : Array.isArray(v) ? v.join(', ') : String(v));

// ---- The action log -----------------------------------------------------------------------------------------------------

/** One line saying what an admin action asks for. Players are named from the core pack; settings by key, as logged. */
export function actionText(ctx: Ctx, kind: string, a: ActionArgs, players: Players): Safe | string {
  const { t, th } = ctx;
  const who = (id: number) => html`<a href="/player/${id}">${playerName(players, id)}</a>`;
  const map = (id: number | undefined) => html`<a href="/map/${id}">${t('map {id}', { id })}</a>`;
  switch (kind) {
    case 'admin.set': return th('Set {key} to {value}', { key: html`<code>${a.key}</code>`, value: html`<b>${valueText(ctx, a.value)}</b>` });
    case 'admin.reset': return th('Reset {key} to its default', { key: html`<code>${a.key}</code>` });
    case 'admin.hill.approve': return t('Approve the King of the hill pool');
    case 'admin.hill.reroll': return t('Reroll the {slot} slot ({tier})', {
      slot: a.slot != null ? slotName(ctx, a.slot) : '?', tier: a.tier != null ? tierName(ctx, a.tier) : '?',
    });
    case 'admin.hill.redraft': return t('Redraft the King of the hill pool');
    case 'admin.bounty.cancel': return a.refund === false ? t('Cancel bounty #{id} without refunds', { id: a.id })
      : t('Cancel bounty #{id} and refund everyone', { id: a.id });
    case 'admin.bananas.adjust': return th('Adjust {who} by {amount}', {
      who: who(a.osuId!), amount: html`<b>${a.amount! > 0 ? '+' : '−'}${bananas(ctx, Math.abs(a.amount ?? 0))}</b>`,
    });
    case 'admin.map.ban': return th('Ban {map}', { map: map(a.beatmapId) });
    case 'admin.map.unban': return th('Unban {map}', { map: map(a.beatmapId) });
    default: return kind;
  }
}

/** The bot's refusal codes (contract §8) in words. */
const codes = perLanguage(t => ({
  not_admin: t('The bot doesn’t have you on its admin list.'),
  unknown_request: t('The bot doesn’t know that kind of request yet.'),
  unavailable: t('That part of the bot isn’t running right now.'),
  failed: t('Something went wrong in the bot; it’s logged there.'),
  unknown_setting: t('The bot doesn’t have that setting.'),
  bad_value: t('That value isn’t the setting’s type.'),
  out_of_range: t('That value is outside the setting’s range.'),
  conflict: t('That clashes with another setting.'),
  not_overridden: t('It was already at its default.'),
  hill_refused: t('King of the hill refused it.'),
  bad_slot: t('That isn’t one of the pool’s slots.'),
  no_bounty: t('There’s no such bounty.'),
  bounty_not_open: t('That bounty isn’t open.'),
  no_player: t('That player isn’t on the bot’s list.'),
  bad_amount: t('The amount must be a whole number other than 0.'),
  below_zero: t('That would take their bananas below zero.'),
  bad_map: t('That isn’t a beatmap id.'),
  already_banned: t('That map is banned already.'),
  no_map: t('osu! doesn’t know that map.'),
  not_banned: t('That map isn’t banned.'),
} as Record<string, string>));
/** Codes whose reason carries the detail (which setting clashes, what the hill said): shown with it. */
const WITH_REASON = new Set(['conflict', 'hill_refused', 'failed']);

/** Why the bot refused, in words: the code's text, plus the bot's reason where that carries the detail. */
export function refusalText(ctx: Ctx, code: string | null | undefined, reason: string | null | undefined): string {
  const known = code ? codes(ctx)[code] : undefined;
  if (!known) return reason || ctx.t('refused');
  return WITH_REASON.has(code!) && reason ? `${known} ${reason}` : known;
}
