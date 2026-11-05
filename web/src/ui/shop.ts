// The shop's catalogue, as assets/js/core/bananas.js SHOP has it: what bananas buy and for how much, and the colours a
// name can take. The shop's page draws it (views/shop.ts), and a player's requests to the bot name what they bought
// with it (ui/requests.ts).

import type { Ctx } from '../kernel/ctx.ts';
import { bananas } from './bananas.ts';

export interface ShopItem {
  item: string;
  group: 'look' | 'community';
  /** A timed item's price is per period of `days`. */
  price: number;
  name: string;
  about: string;
  /** How long a timed item lasts, and how many periods can be bought at once (stacked, up to a year), named by `unit`. */
  days?: number;
  periods?: readonly number[];
  unit?: 'month' | 'week';
  /** The earned bananas it needs, as posting a bounty does. */
  gate?: number;
  /** Only one player in PT gets it per Lisbon month: the first the bot accepts. */
  monthly?: boolean;
  /** A moderator approves it first; refunded if refused. */
  approval?: boolean;
}

/**
 * The shop, as bananas.js SHOP has it (CURRENCY-DESIGN.md §5; prices and gates as bananas-contract.md §6 lists them,
 * which the bot's Bananas options must match: the bot doesn't export them). The same items and numbers: change both
 * together. `look` is cosmetics, `community` picks a moderator approves first.
 */
export function shopItems({ t }: Ctx): ShopItem[] {
  return [
    { item: 'title', group: 'look', price: 500, name: t('Profile title'),
      about: t('Show one of your titles or badges next to your name.') },
    { item: 'signature', group: 'look', price: 350, name: t('Signature play'),
      about: t('Pin one of your plays to the top of your profile.') },
    { item: 'colour', group: 'look', price: 500, days: 30, periods: [1, 2, 3, 6, 12], unit: 'month', gate: 1000, name: t('Name colour'),
      about: t('Your name in a colour you pick on the site’s leaderboards, 30 days at a time, up to a year.') },
    { item: 'role', group: 'look', price: 150, days: 7, periods: [1, 2, 4, 8, 13, 26, 52], unit: 'week', gate: 1000, name: t('Discord colour role'),
      about: t('A colour role on the Discord, a week at a time, up to a year.') },
    { item: 'motw', group: 'community', price: 400, approval: true, name: t('Map of the week nomination'),
      about: t('Put a map forward for the map of the week.') },
    { item: 'wildcard', group: 'community', price: 1500, gate: 1000, monthly: true, approval: true, name: t('King of the hill wildcard'),
      about: t('Pick the convert map (4.5–6.5★) for next month’s Challenger tier.') },
  ];
}

/** The palette a name or a Discord role can take (the bot's ShopColours), by name, as the site shows it. */
export const colours = ({ t }: Ctx): [string, string][] =>
  [['rosa', t('Rosa')], ['gold', t('Gold')], ['mint', t('Mint')], ['sky', t('Sky')], ['lilac', t('Lilac')], ['sand', t('Sand')]];
export const colourName = (ctx: Ctx, key: string): string => colours(ctx).find(c => c[0] === key)?.[1] ?? key;

/** "3 months" / "26 weeks": how long `n` periods of a timed item last (a month here is 30 days). */
export const periodsText = (ctx: Ctx, s: ShopItem, n: number): string =>
  (s.unit === 'week' ? ctx.tn(n, '{n} week', '{n} weeks') : ctx.tn(n, '{n} month', '{n} months'));
/** "500 🍌 per 30 days", or just the price for an item that isn't timed. */
export const priceText = (ctx: Ctx, s: ShopItem): string =>
  (s.days ? ctx.t('{price} per {days} days', { price: bananas(ctx, s.price), days: s.days }) : bananas(ctx, s.price));
