import { html } from '../core/html.js';
import { setTitle } from '../core/ui.js';

// The bot's slash commands (PT-CTB-Discord-Bot/Commands), described for players. Most also exist as !prefix commands.
const GROUPS = [
  ['Scores', [
    ['/rs [player]', 'Shows the most recent osu!catch score. Without a name, it uses the account linked with /setname.'],
    ['/rsnf [player]', 'The most recent score, not counting fails.'],
    ['/rsc · /rsnfc', 'The same, but converts only.'],
    ['/compare [player]', 'Compares your score with the last one shown in the channel.'],
    ['/leaderboard', 'A map’s Portuguese leaderboard.'],
    ['/stats', 'Stats for the last map mentioned in the channel.'],
    ['/addscore <link>', 'Adds a score from its osu! score link.'],
    ['/addunrankedscore', 'Adds a loved/unranked score from its replay file.'],
  ]],
  ['Profiles and tops', [
    ['/profile [player]', 'Your community profile: converts and loved pp, ranks and more.'],
    ['/top · /topc', 'Top plays in Loved & Unranked or in Converts.'],
    ['/show · /showc', 'Shows one of those top plays in detail.'],
    ['/catchtop', 'Top ranked plays imported from the osu! data dump.'],
    ['/catchleaderboard', 'The Portuguese leaderboard of official osu!catch pp.'],
    ['/modranking <mod>', 'Players ranked by the pp of their plays with a mod (HD, HR, DT…).'],
    ['/modtop <mod>', 'The best individual plays with a mod.'],
    ['/nochoke', 'How much pp you’d have if no play had misses.'],
    ['/pakachan', 'The pp of your converts top 100.'],
  ]],
  ['pp gains', [
    ['/ppgain <map>', 'How much pp you’d gain by SSing a loved/unranked map.'],
    ['/ppgainc <map>', 'The same for converts.'],
    ['/ppgainraw <pp>', 'How much a play worth X pp would add to your total.'],
    ['/gethdgain', 'How much pp HD would add to your top plays.'],
  ]],
  ['Dan course', [
    ['/danstats [player]', 'Dan course progress.'],
    ['/updatedan', 'Looks for Dan passes in your recent plays.'],
    ['/claimdanrole', 'Gives you the Discord role that matches your Dan points.'],
  ]],
  ['Account and settings', [
    ['/verify', 'Verifies your osu! account and gives you the verified role (Portuguese accounts).'],
    ['/setname <name>', 'Links your Discord account to your osu! name, so you don’t have to type it.'],
    ['/scorestyle', 'Picks the look of the bot’s messages: classic, Bathbot or the new "sleek" style.'],
  ]],
  ['Fun', [
    ['/roll [max]', 'A random number.'],
    ['/coinflip', 'Heads or tails.'],
    ['/ping', 'Checks that the bot is awake.'],
    ['/help', 'The command list inside Discord.'],
  ]],
  ['Moderation', 'Only our lord and saviour has access to these commands.', [
    ['/ban · /showbanned', 'Removes a map from the leaderboards / shows removed maps.'],
    ['/loadrecentscores', 'Imports everyone’s recent plays now (the bot also does this by itself every 30 minutes).'],
    ['/clear', 'Deletes recent messages in the channel.'],
  ]],
];

export default async function commands(root) {
  setTitle('Bot commands');
  root.innerHTML = String(html`
    <header class="page-head">
      <h1>Bot commands</h1>
      <p class="page-tag">What the bot can do</p>
      <p>Type <span class="kbd">/</span> in Discord to see every command. Most also work with a <span class="kbd">!</span> prefix (for example <span class="kbd">!rs</span>).</p>
    </header>
    <div class="grid grid-2">
      <div class="card">
        <h2 class="card-h">Why is the bot called Alphonse?</h2>
        <p style="margin:0">Tris used to be <b>Edward Elric</b> on osu!. When he relaunched the bot in 2021, Nelson suggested the obvious: the bot is his brother. The Discord account still says DanProject, after the Dan course it was first built for in 2018.</p>
      </div>
      <div class="card">
        <h2 class="card-h">The most-typed command</h2>
        <p style="margin:0">Not one of ours: owo’s <span class="kbd">&lt;rc</span> has been typed on the server about 11,800 times. Yes, we know you’ve typed <span class="kbd">&lt;rc</span> more often than “hello”.</p>
      </div>
    </div>
    ${GROUPS.map(group => {
      const [title, note, list] = group.length === 3 ? group : [group[0], null, group[1]];
      return html`<section class="section">
        <h2>${title}</h2>
        ${note ? html`<p class="muted small">${note}</p>` : ''}
        <div class="cmd-list">${list.map(([name, text]) => html`<div class="cmd"><code>${name}</code><span class="muted">${text}</span></div>`)}</div>
      </section>`;
    })}
  `);
}
