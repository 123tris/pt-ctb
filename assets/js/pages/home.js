import { html } from '../core/html.js';
import { meta, players, activity, challenges, records } from '../core/data.js';
import { M } from '../core/model.js';
import { eventItem } from '../core/events.js';
import { LAST_REWORK, THRONE_PLAYER } from '../core/lore.js';
import { season } from '../core/fun.js';
import {
  setTitle, avatar, mapText, cover, starsBadge, CAT_LABEL, prefs, openSearch, isInactiveOnOsu, inactiveTag, isLegend, legendTag, officialPp,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { CONFIG } from '../config.js';

function miniBoard(list, key, cat) {
  const rows = list.filter(p => p[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 5);
  const me = prefs.get('me', null);
  return html`<div class="card">
    <h3><span class="cat cat-${cat}">${CAT_LABEL[cat]}</span></h3>
    <div class="mini-board">
      ${rows.map((p, i) => {
        // The official top 5 includes players inactive on osu! (osu! shows them at 0 pp), tagged as such; legends
        // (lore.js) get their own tag on any board.
        const offOsu = cat === 'r' && isInactiveOnOsu(p);
        return html`<a class="line ${p.id === me ? 'me' : ''}" href="#/player/${p.id}">
          <span class="n">${i + 1}</span>
          <span class="player">${avatar(p.id, 'avatar-sm')}<span>${p.name}</span>${isLegend(p) ? legendTag() : offOsu ? inactiveTag() : ''}</span>
          ${offOsu ? officialPp(p, { compact: true }) : html`<span class="pp">${fmt.pp(p[key])}<small>pp</small></span>`}
        </a>`;
      })}
    </div>
    <p class="card-foot"><a href="#/rankings/${{ c: 'converts', u: 'loved', r: 'ranked' }[cat]}">Full leaderboard →</a></p>
  </div>`;
}

export default async function home(root, { isCurrent }) {
  const [m, list, act, ch, rec] = await Promise.all([meta(), players(), activity(), challenges(), records().catch(() => null)]);
  if (!isCurrent()) return;
  setTitle('');
  const index = new Map(list.map(p => [p.id, p]));
  const mine = index.get(prefs.get('me', null)) ?? null;
  const reworkDays =Math.floor((Date.now() / 1000 - LAST_REWORK) / 86400);
  const boss = index.get(THRONE_PLAYER);
  const bossHeld = rec?.throne?.held ?? (boss ? boss.firsts.c + boss.firsts.u + boss.firsts.r : 0);
  const week = ch.week;
  const weekMeta = week ? ch.maps[week.map] : null;
  const weekText = week ? mapText(week.map, weekMeta) : null;

  root.innerHTML = String(html`
    <section class="hero">
      <div>
        <span class="flag-rule" aria-hidden="true"></span>
        <h1>Portugal’s <em>osu!catch</em> community</h1>
        <p class="hero-tag">Catching fruit and choking since 2018.</p>
        <p>Leaderboards, profiles, the Dan course, weekly challenges and games: everything the PT-CTB server’s bot tracks, in one place.</p>
        <div class="btn-row">
          ${CONFIG.discordInvite ? html`<a class="btn btn-discord" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">Join the Discord</a>` : ''}
          <a class="btn btn-primary" href="#/rankings">See the leaderboards</a>
          <a class="btn" href="#/games">Play a game</a>
        </div>
        ${mine ? html`<p class="find-me">Welcome back, <a href="#/player/${mine.id}">${mine.name}</a>. Your rows are highlighted on every leaderboard.</p>`
          : html`<p class="find-me">Play osu!catch in Portugal? <button type="button" data-find>Find yourself</button> and press “This is me” on your profile. New to all this? <a href="#/glossary">Read the glossary</a>.</p>`}
      </div>
      <dl class="hero-stats">
        <div><dt>Players tracked</dt><dd>${fmt.num(m.totals.players)}</dd></div>
        <div><dt>Scores</dt><dd>${fmt.num(m.totals.scores)}</dd></div>
        <div><dt>Maps played</dt><dd>${fmt.num(m.totals.maps)}</dd></div>
        <div><dt>Fruits caught</dt><dd>${fmt.num(m.totals.fruits)}</dd></div>
        <div class="hero-rework" title="Last osu!catch pp change: ${fmt.date(LAST_REWORK)}"><dt>Days without a pp rework</dt><dd>${fmt.num(reworkDays)}</dd></div>
      </dl>
    </section>

    ${season() === 'xmas' ? html`<p class="notice" style="margin-top:16px">Feliz Natal, you lot. Play less, eat more. 🎅</p>` : ''}

    ${boss && bossHeld ? html`<a class="throne-strip card-link" href="#/records?at=throne">
      ${avatar(boss.id, 'avatar-md')}
      <span><b>${boss.name} still holds ${fmt.num(bossHeld)} #1s.</b> <span class="muted">Snipe him. He keeps asking.</span></span>
      <span class="throne-go">Dethrone Tris →</span>
    </a>` : ''}

    <section class="section">
      <div class="section-head"><h2>Portugal’s best</h2><a href="#/rankings">All leaderboards →</a></div>
      <div class="grid grid-3">
        ${miniBoard(list, 'cv', 'c')}
        ${miniBoard(list, 'ul', 'u')}
        ${miniBoard(list, 'pp', 'r')}
      </div>
    </section>

    <a class="dan-strip card-link" href="#/challenges/dan">
      <span class="dan-strip-glyphs" aria-hidden="true">0 · א · ש</span>
      <span><b>The Dan course</b> <span class="muted">19 challenge maps from Zeroth Dan to Shin. Pass stages, earn points and Discord roles.</span></span>
      <span class="dan-strip-go">Open the Dan course →</span>
    </a>

    <section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>Map of the week</h2><a href="#/challenges/week">Challenges →</a></div>
        ${week ? html`<a class="card card-link" href="#/map/${week.map}" style="padding:0;overflow:hidden">
          ${cover(weekMeta, 'cover', 'week-cover')}
          <div style="padding:16px">
            <div class="map-title" style="font-size:1.05rem">${weekText.title}</div>
            <div class="map-sub">${starsBadge(weekMeta?.[M.STARS])} ${weekText.sub}</div>
            <p class="small muted" style="margin:10px 0 0">${fmt.plural(week.weekly.length, 'play')} this week · ${fmt.plural(week.board.length, 'player')} in total. Ends ${fmt.ago(week.end)}.</p>
          </div>
        </a>` : html`<div class="empty">No map of the week yet.</div>`}
      </div>
      <div>
        <div class="section-head"><h2>Recent activity</h2><a href="#/activity">See all →</a></div>
        <div class="feed">${act.events.slice(0, 5).map(e => eventItem(e, index, act.maps))}</div>
      </div>
    </section>

    <section class="section grid grid-2">
      <div class="card">
        <h2>How to join</h2>
        <div class="steps">
          <div class="step"><div><b>Join the Discord server</b><p>That’s where the bot lives and where the community chats, shares plays and sets up matches.</p>
            ${CONFIG.discordInvite ? html`<a class="btn btn-small btn-discord" style="margin-top:8px" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">Join the Discord</a>` : ''}</div></div>
          <div class="step"><div><b>Verify your account with <span class="kbd">/verify</span></b><p>You sign in to osu! and, if your account is Portuguese, you get the verified role straight away. <a href="#/verify">How does it work?</a></p></div></div>
          <div class="step"><div><b>Play!</b><p>The bot fetches recent plays for everyone it tracks every 30 minutes. You can also use <span class="kbd">/rs</span> to show your latest one.</p></div></div>
        </div>
      </div>
      <div class="card">
        <h2>What’s here</h2>
        <div class="link-list">
          <a href="#/challenges/dan"><b>Dan course</b><span>19 stages, from Zeroth Dan to Shin.</span></a>
          <a href="#/records"><b>Records</b><span>Biggest combos, most #1s, hardest maps.</span></a>
          <a href="#/games/guess"><b>Guess the map</b><span>Do you recognise the cover?</span></a>
          <a href="#/calculator"><b>Calculator</b><span>How much pp is that play worth?</span></a>
          <a href="#/compare"><b>Compare</b><span>Head to head with a rival.</span></a>
          <a href="#/commands"><b>Commands</b><span>Everything the bot can do.</span></a>
          <a href="#/glossary"><b>Glossary</b><span>pp, converts, FC, mods: the words explained.</span></a>
          <a href="#/players"><b>All players</b><span>Every Portuguese player the bot tracks.</span></a>
        </div>
      </div>
    </section>
  `);
  root.querySelector('[data-find]')?.addEventListener('click', openSearch);
}
