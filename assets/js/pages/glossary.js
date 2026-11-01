import { html } from '../core/html.js';
import { setTitle, pageHead, modsBadges, gradeBadge } from '../core/ui.js';
import { MOD } from '../core/model.js';
import { t, th } from '../core/i18n.js';

// The words the site and the Discord use, for anyone who's new to osu!catch or to the community.
const SECTIONS = [
  [t('Scores and pp'), [
    ['pp', t('Performance points: how much a play is worth, based on the map’s difficulty, your accuracy, combo and mods. A player’s total pp is their best plays added up, each worth 95% of the one before, so your top plays count most.')],
    [t('Star rating (★)'), t('How hard a map is. The badge colour follows osu!’s own scale, from blue (easy) through pink and purple to black (6.5★ and up is “boss map” territory here).')],
    [t('Accuracy'), t('The share of fruits, drops and droplets you caught. Dan stages ask for 98% or 99%.')],
    [t('Combo, misses and FC'), t('Combo counts fruit caught in a row. A miss breaks it. An FC (full combo) means no misses at all.')],
    [t('Grades'), th('In osu!catch the grade comes from accuracy alone: {X} is 100%, {S} over 98%, {A} over 94%, {B} over 90%, {C} over 85%, and {D} below that. Silver letters mean the play used HD or FL.',
      Object.fromEntries(['X', 'S', 'A', 'B', 'C', 'D'].map(g => [g, gradeBadge(g)])))],
    [t('#1 and snipes'), t('The best Portuguese score on a map is its #1. Taking someone’s #1 is a snipe, and the Activity page lists every one.')],
  ]],
  [t('Leaderboards'), [
    [t('Converts'), t('osu!standard maps played in catch mode. osu! converts them automatically, so every standard map is also a catch map. This community keeps its own pp leaderboard for them.')],
    [t('Specifics'), t('Maps made for osu!catch itself. “Converts or specifics?” is the community’s oldest argument.')],
    [t('Loved & Unranked'), t('Loved, pending and graveyarded maps. osu! gives no pp for them, so the bot works pp out with the current osu!catch formula.')],
    [t('Ranked (official)'), t('osu!’s own osu!catch leaderboard, with the pp and global rank from each player’s osu! profile.')],
    [t('Inactive'), t('A player who’s inactive on osu! or has no new plays stored in over a year. They stay on the leaderboards, greyed out, and the “Show inactive players” box hides them.')],
    [t('Legend'), t('A former Portuguese top-5 player who’s no longer active. Their name carries a “legend” tag: legends don’t disappear.')],
  ]],
  [t('Mods'), [
    [t('Easier'), th('{EZ} Easy (bigger fruit, slower), {NF} No Fail, {HT} Half Time (75% speed). They lower a play’s pp.', { EZ: modsBadges(MOD.EZ), NF: modsBadges(MOD.NF), HT: modsBadges(MOD.HT) })],
    [t('Harder'), th('{HD} Hidden (fruit fades out), {HR} Hard Rock (smaller fruit, faster), {DT} Double Time (150% speed; Nightcore, NC, is the same with a beat), {FL} Flashlight. They raise a play’s pp.', { HD: modsBadges(MOD.HD), HR: modsBadges(MOD.HR), DT: modsBadges(MOD.DT), FL: modsBadges(MOD.FL) })],
    [t('Other'), th('{SD} Sudden Death and {PF} Perfect fail you on a miss or a lost SS. NM (no mod) is a play without any.', { SD: modsBadges(MOD.SD), PF: modsBadges(MOD.PF) })],
  ]],
  [t('The community'), [
    [t('Dan course'), t('The community’s ladder of 19 challenge maps, from Zeroth Dan to Shin. Passing stages earns points and Discord roles. It lives under Challenges.')],
    [t('King of the hill'), t('A pool of maps each month, one per slot (NM, HD, HR, DT and FM on catch-specific maps, and Convert on a convert) in two tiers: Open (6–9★) and the easier Challenger (4.5–6.5★). The best play on a map holds its crown; whoever holds it when the month ends keeps it. The most crowns in a month makes you King of the hill. HT, EZ and speed changes never count.')],
    [t('Bounties'), t('Prizes on hard maps for the first FC, the first pass or taking the #1. Players past 1,000 bananas earned post them with a pot, moderators post house bounties, and anyone signed in can add to a pot. The first play that meets the goal takes it all, and the bot spots it by itself. Nobody can claim a bounty they posted or funded.'), 'bounties'],
    [t('Crown'), t('King of the hill’s prize for one slot: the best play on that slot’s map holds it, and whoever holds it when the month ends keeps it.'), 'crown'],
    [t('Verified'), t('The Discord role for Portuguese osu! accounts, given by the bot’s /verify command.')],
    [t('Signing in'), t('“Sign in with osu!” is the only way the site knows who you are: osu! confirms your account, and only your player id and name come back. Signed in, your rows are highlighted across the site and you can collect and spend bananas. It lasts 30 days in that browser, or until you sign out.'), 'signin'],
  ]],
  [t('Bananas'), [
    [t('Bananas'), t('The community’s play money, named after catch’s bonus fruit. You earn them by playing well: snipes, first FCs on 5★ maps and up, crowns, the map of the week, Dan stages, badges and the daily game. You spend them on bounties, tips and the shop. They’re never bought or sold. The bot keeps the books, and you sign in on this site with osu! to collect what you earned.'), 'bananas'],
    [t('Wallet and earned'), t('Your wallet is what you can spend. Earned counts only what playing brought you: it’s what the 1,000 needed to post a bounty is checked against, so tips, refunds and the launch grant don’t add to it.'), 'wallet'],
    [t('Pouch'), t('Where your bananas wait until you first sign in on this site with osu!. It holds 300; anything past that is lost, so sign in early.'), 'pouch'],
    [t('Posting a bounty'), t('Takes 1,000 bananas earned (tips, refunds and the launch grant don’t count), a stake of 500 or more and a 20% fee, which is burned. One a month. The first play that meets the goal takes the whole pot; if nobody does, 70% goes back to the funders.'), 'posting'],
    [t('Tip'), t('Bananas you give another player, 5 to 50 a day. They come out of your wallet and don’t count towards the other player’s earned.'), 'tip'],
    [t('Snipe shield'), t('A switch on your own wallet: while it’s on, snipe bounties can’t target your #1s.'), 'shield'],
    [t('Shop'), t('Where bananas buy a profile title, a pinned signature play, a name colour, a Discord colour role, a map of the week nomination or King of the hill’s wildcard. What you spend there is burned.'), 'shop'],
    [t('Signature play'), t('One of your plays, pinned to the top of your profile. Bought in the shop.'), 'signature'],
    [t('Name colour'), t('Your name in a colour you pick, wherever names are listed on the site. It’s bought 30 days at a time, up to a year at once, and more adds to the time left. The Discord colour role works the same way, a week at a time.'), 'colour'],
    [t('Wildcard'), t('Picks the convert map (4.5–6.5★) for next month’s King of the hill Challenger tier. One a month for all of PT, first bought, once a moderator approves it.'), 'wildcard'],
  ]],
];

/** #/glossary?at=bananas goes straight to that entry (the "What are bananas?" links). */
export default async function glossary(root, { query = {} } = {}) {
  setTitle(t('Glossary'));
  root.innerHTML = String(html`
    ${pageHead({ title: t('Glossary'), intro: t('What the numbers and badges on this site mean, and the words the community uses for them.') })}
    ${SECTIONS.map(([title, terms]) => html`<section class="section">
      <h2>${title}</h2>
      <dl class="glossary">${terms.map(([term, text, id]) => html`<div ${id ? html`id="g-${id}"` : ''} class="${id && id === query.at ? 'target' : ''}"><dt>${term}</dt><dd>${text}</dd></div>`)}</dl>
    </section>`)}
    <p class="section muted">${t('Still stuck? Ask in the Discord: someone’s always around.')} <a href="#/join">${t('How to join')}</a></p>
  `);
  if (query.at) root.querySelector(`#g-${CSS.escape(query.at)}`)?.scrollIntoView({ block: 'center' });
}
