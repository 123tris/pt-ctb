import { html } from '../core/html.js';
import { setTitle, pageHead, modsBadges, gradeBadge } from '../core/ui.js';
import { MOD } from '../core/model.js';

// The words the site and the Discord use, for anyone who's new to osu!catch or to the community.
const SECTIONS = [
  ['Scores and pp', [
    ['pp', 'Performance points: how much a play is worth, based on the map’s difficulty, your accuracy, combo and mods. A player’s total pp is their best plays added up, each worth 95% of the one before, so your top plays count most.'],
    ['Star rating (★)', 'How hard a map is. The badge colour follows osu!’s own scale, from blue (easy) through pink and purple to black (6.5★ and up is “boss map” territory here).'],
    ['Accuracy', 'The share of fruits, drops and droplets you caught. Dan stages ask for 98% or 99%.'],
    ['Combo, misses and FC', 'Combo counts fruit caught in a row. A miss breaks it. An FC (full combo) means no misses at all.'],
    ['Grades', html`In osu!catch the grade comes from accuracy alone: ${gradeBadge('X')} is 100%, ${gradeBadge('S')} over 98%, ${gradeBadge('A')} over 94%, ${gradeBadge('B')} over 90%, ${gradeBadge('C')} over 85%, and ${gradeBadge('D')} below that. Silver letters mean the play used HD or FL.`],
    ['#1 and snipes', 'The best Portuguese score on a map is its #1. Taking someone’s #1 is a snipe, and the Activity page lists every one.'],
  ]],
  ['Leaderboards', [
    ['Converts', 'osu!standard maps played in catch mode. osu! converts them automatically, so every standard map is also a catch map. This community keeps its own pp leaderboard for them.'],
    ['Specifics', 'Maps made for osu!catch itself. “Converts or specifics?” is the community’s oldest argument.'],
    ['Loved & Unranked', 'Loved, pending and graveyarded maps. osu! gives no pp for them, so the bot works pp out with the current osu!catch formula.'],
    ['Ranked (official)', 'osu!’s own osu!catch leaderboard, with the pp and global rank from each player’s osu! profile.'],
    ['Inactive', 'A player who’s inactive on osu! or has no new plays stored in over a year. They stay on the leaderboards, greyed out, and the “Show inactive players” box hides them.'],
    ['Legend', 'A former Portuguese top-5 player who’s no longer active. Their name carries a “legend” tag: legends don’t disappear.'],
  ]],
  ['Mods', [
    ['Easier', html`${modsBadges(MOD.EZ)} Easy (bigger fruit, slower), ${modsBadges(MOD.NF)} No Fail, ${modsBadges(MOD.HT)} Half Time (75% speed). They lower a play’s pp.`],
    ['Harder', html`${modsBadges(MOD.HD)} Hidden (fruit fades out), ${modsBadges(MOD.HR)} Hard Rock (smaller fruit, faster), ${modsBadges(MOD.DT)} Double Time (150% speed; Nightcore, NC, is the same with a beat), ${modsBadges(MOD.FL)} Flashlight. They raise a play’s pp.`],
    ['Other', html`${modsBadges(MOD.SD)} Sudden Death and ${modsBadges(MOD.PF)} Perfect fail you on a miss or a lost SS. NM (no mod) is a play without any.`],
  ]],
  ['The community', [
    ['Dan course', 'The community’s ladder of 19 challenge maps, from Zeroth Dan to Shin. Passing stages earns points and Discord roles. It lives under Challenges.'],
    ['Verified', 'The Discord role for Portuguese osu! accounts, given by the bot’s /verify command.'],
    ['This is me', 'A button on every player profile. Press it on yours and your rows are highlighted across the site. It’s saved in your browser only.'],
  ]],
];

export default async function glossary(root) {
  setTitle('Glossary');
  root.innerHTML = String(html`
    ${pageHead({ title: 'Glossary', quote: 'glossary', intro: 'What the numbers and badges on this site mean, and the words the community uses for them.' })}
    ${SECTIONS.map(([title, terms]) => html`<section class="section">
      <h2>${title}</h2>
      <dl class="glossary">${terms.map(([term, text]) => html`<div><dt>${term}</dt><dd>${text}</dd></div>`)}</dl>
    </section>`)}
    <p class="section muted">Still stuck? Ask in the Discord: someone’s always around. <a href="#/join">How to join →</a></p>
  `);
}
