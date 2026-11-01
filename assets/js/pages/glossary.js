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
    [t('King of the hill'), t('A pool of maps each month, one per slot (NM, HD, HR, DT and FM on catch-specific maps, and CV on a convert) in an Open and a Challenger tier. The best play on a map holds its crown; whoever holds it when the month ends keeps it. The most crowns in a month makes you King of the hill.')],
    [t('Bounties'), t('Prizes the community puts on hard maps, for the first FC, the first pass or taking the #1. A moderator posts one with the bot’s !bounty, anyone can add a prize, and the bot spots the claim by itself. Claiming one makes you a Bounty hunter.')],
    [t('Bananas 🍌'), t('The community’s play money, named after catch’s bonus fruit. You earn them by playing well: snipes, first FCs on 5★ maps and up, crowns, the map of the week, Dan stages, badges and the daily game. You spend them on bounties, tips and the shop. They’re never bought or sold. The bot keeps the books, and you sign in on this site with osu! to collect what you earned.')],
    [t('Pouch'), t('Where your bananas wait until you first sign in on this site with osu!. It holds 300; anything past that is lost, so sign in early.')],
    [t('Posting a bounty'), t('Takes 1,000 bananas earned (tips, refunds and the launch grant don’t count), a stake of 500 or more and a 20% fee, which is burned. One a month. The first play that meets the goal takes the whole pot; if nobody does, 70% goes back to the funders.')],
    [t('Verified'), t('The Discord role for Portuguese osu! accounts, given by the bot’s /verify command.')],
    [t('This is me'), t('A button on every player profile. Press it on yours and your rows are highlighted across the site. It’s saved in your browser only.')],
  ]],
];

export default async function glossary(root) {
  setTitle(t('Glossary'));
  root.innerHTML = String(html`
    ${pageHead({ title: t('Glossary'), intro: t('What the numbers and badges on this site mean, and the words the community uses for them.') })}
    ${SECTIONS.map(([title, terms]) => html`<section class="section">
      <h2>${title}</h2>
      <dl class="glossary">${terms.map(([term, text]) => html`<div><dt>${term}</dt><dd>${text}</dd></div>`)}</dl>
    </section>`)}
    <p class="section muted">${t('Still stuck? Ask in the Discord: someone’s always around.')} <a href="#/join">${t('How to join')}</a></p>
  `);
}
