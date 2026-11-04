// The bot's commands (/commands), as assets/js/pages/commands.js draws them. The list comes from the bot itself: on
// start it writes commands.json to its data folder, and the exporter publishes it, so this page can't drift from what
// /help shows in Discord. Until that file exists (or when it can't be read), the hand-written list below (the bot as
// it was on 2026-10-25) is shown instead.

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';

/** One command in commands.json, as the bot writes it. */
export interface BotCommand {
  slash?: string | null;
  prefix?: string[] | null;
  description: string;
  options?: { name: string }[] | null;
  /** 'everyone', or who else may use it. */
  access: string;
}

/** commands.json: the bot's command groups, in its own order. */
export interface CommandsFile {
  generatedAt?: number;
  groups: { name: string; commands: BotCommand[] }[];
}

export interface Data {
  /** The bot's list, or null for the hand-written one. */
  file: CommandsFile | null;
}

/** A command (its name and options) and what it does. */
type Command = [name: string, text: Value];
/** A group: title and commands, or title, a note under it and commands. */
type Group = [title: string, list: Command[]] | [title: string, note: string, list: Command[]];

const fallback = ({ t }: Ctx): Group[] => [
  [t('Scores'), [
    ['/rs [player]', t('Shows the most recent osu!catch score. Without a name, it uses the account linked with /setname.')],
    ['/rsnf [player]', t('The most recent score, not counting fails.')],
    ['/rsc · /rsnfc', t('The same, but converts only.')],
    ['/compare [player]', t('Compares your score with the last one shown in the channel.')],
    ['/leaderboard', t('A map’s Portuguese leaderboard.')],
    ['/stats', t('Stats for the last map mentioned in the channel.')],
    ['/addscore <link or map id>', t('Adds a score from its osu! score or map link, or just the map id.')],
    ['/addunrankedscore', t('Adds a loved/unranked score from its replay file.')],
  ]],
  [t('Profiles and tops'), [
    ['/profile [player]', t('Your community profile: converts and loved pp, ranks and more.')],
    ['/top · /topc', t('Top plays in Loved & Unranked or in Converts.')],
    ['/show · /showc', t('Shows one of those top plays in detail.')],
    ['/catchtop', t('Top ranked plays imported from the osu! data dump.')],
    ['/catchleaderboard', t('The Portuguese leaderboard of official osu!catch pp.')],
    ['/modranking <mod>', t('Players ranked by the pp of their plays with a mod (HD, HR, DT…).')],
    ['/modtop <mod>', t('The best individual plays with a mod.')],
    ['/nochoke', t('How much pp you’d have if no play had misses.')],
    ['/pakachan', t('The pp of your converts top 100.')],
  ]],
  [t('pp gains'), [
    ['/ppgain <map>', t('How much pp you’d gain by SSing a loved/unranked map.')],
    ['/ppgainc <map>', t('The same for converts.')],
    ['/ppgainraw <pp>', t('How much a play worth X pp would add to your total.')],
    ['/gethdgain', t('How much pp HD would add to your top plays.')],
  ]],
  [t('Dan course'), [
    ['/danstats [player]', t('Dan course progress.')],
    ['/updatedan', t('Looks for Dan passes in your recent plays.')],
    ['/claimdanrole', t('Gives you the Discord role that matches your Dan points.')],
  ]],
  [t('Account and settings'), [
    ['/verify', t('Verifies your osu! account and gives you the verified role (Portuguese accounts).')],
    ['/setname <name>', t('Links your Discord account to your osu! name, so you don’t have to type it.')],
    ['/scorestyle', t('Picks the look of the bot’s messages: classic, Bathbot or the new "sleek" style.')],
  ]],
  [t('Fun'), [
    ['/roll [max]', t('A random number.')],
    ['/coinflip', t('Heads or tails.')],
    ['/ping', t('Checks that the bot is awake.')],
    ['/help', t('The command list inside Discord.')],
  ]],
  [t('Moderation'), t('Only our lord and saviour has access to these commands.'), [
    ['/ban · /showbanned', t('Removes a map from the leaderboards / shows removed maps.')],
    ['/loadrecentscores', t('Imports everyone’s recent plays now (the bot also does this by itself every 15 minutes, and the site catches up within a few minutes).')],
    ['/clear', t('Deletes recent messages in the channel.')],
  ]],
];

/** A description with its `code` spans (command words, like `!bounty pledge`) as code. */
const withCode = (text: string): Value[] => text.split('`').map((part, i) => (i % 2 ? html`<code>${part}</code>` : part));

/**
 * commands.json as the same groups as the hand-written list. The bot writes its group names and descriptions in
 * English; pt.js translates the ones it knows, and a new one shows in English until it's added.
 */
function fromBot({ t }: Ctx, file: CommandsFile): Group[] {
  return file.groups.map(group => {
    const moderators = group.commands.every(c => c.access !== 'everyone');
    const list = group.commands.map((c): Command => {
      const options = (c.options ?? []).map(o => `[${o.name}]`).join(' ');
      // A prefix-only command (no slash) goes by its first prefix, so the aliases are the rest.
      const aliases = (c.prefix ?? []).slice(c.slash ? 0 : 1).join(' · ');
      return [[c.slash ?? c.prefix?.[0], options].filter(Boolean).join(' '),
        html`${withCode(t(c.description))}${aliases ? html` <span class="faint">${t('Also {aliases}.', { aliases })}</span>` : ''}${!moderators && c.access !== 'everyone' ? html` <span class="faint">(${t('moderators')})</span>` : ''}`];
    });
    return moderators ? [t(group.name), t('Only our lord and saviour has access to these commands.'), list] : [t(group.name), list];
  });
}

/** The bot's groups, or the hand-written ones without a file or for one in a shape this page can't read (as before). */
function groups(ctx: Ctx, file: CommandsFile | null): Group[] {
  if (!file) return fallback(ctx);
  try {
    return fromBot(ctx, file);
  } catch {
    return fallback(ctx);
  }
}

export const title = ({ t }: Ctx) => t('Bot commands');

export function render(ctx: Ctx, { file }: Data): Safe {
  const { t, th, fmt } = ctx;
  const kbd = (text: string) => html`<span class="kbd">${text}</span>`;
  return html`
    <header class="page-head">
      <h1>${t('Bot commands')}</h1>
      <p>${th('Type {slash} in Discord to see every command. Most also work with a {bang} prefix (for example {rs}).', { slash: kbd('/'), bang: kbd('!'), rs: kbd('!rs') })}</p>
    </header>
    <div class="grid grid-2">
      <div class="card">
        <h2 class="card-h">${t('Why is the bot called Alphonse?')}</h2>
        <p class="m-0">${th('Tris used to be {name} on osu!. When he relaunched the bot in 2021, Nelson suggested the obvious: the bot is his brother. The Discord account still says DanProject, after the Dan course it was first built for in 2018.', { name: html`<b>Edward Elric</b>` })}</p>
      </div>
      <div class="card">
        <h2 class="card-h">${t('The most-typed command')}</h2>
        <p class="m-0">${th('Not one of ours: owo’s {rc} has been typed on the server about {n} times. Yes, we know you’ve typed {rc} more often than “hello”.', { rc: kbd('<rc'), n: fmt.num(11800) })}</p>
      </div>
    </div>
    ${groups(ctx, file).map(group => {
      const [name, note, list] = group.length === 3 ? group : [group[0], null, group[1]];
      return html`<section class="section">
        <h2>${name}</h2>
        ${note ? html`<p class="muted small">${note}</p>` : ''}
        <div class="cmd-list">${list.map(([command, text]) => html`<div class="cmd"><code>${command}</code><span class="muted">${text}</span></div>`)}</div>
      </section>`;
    })}
  `;
}
