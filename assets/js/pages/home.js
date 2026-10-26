import { html } from '../core/html.js';
import { meta, players, activity, challenges, records } from '../core/data.js';
import { M, DAN_STAGES } from '../core/model.js';
import { eventItem, danName } from '../core/events.js';
import { LAST_REWORK, THRONE_PLAYER, HISTORY } from '../core/lore.js';
import { ladderBand, passCounts, highestDan, topStage } from '../core/ladder.js';
import { weeklySummary } from '../core/weekly.js';
import { season } from '../core/fun.js';
import {
  setTitle, avatar, mapText, cover, setCover, starsBadge, CAT_LABEL, prefs, openSearch, isInactiveOnOsu, inactiveTag, isLegend, legendTag, officialPp,
  playerLink, mapLabel,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { CONFIG } from '../config.js';

/** Under the ladder: how far up Portugal has got, and what's left. */
function ladderCaption(counts) {
  const top = topStage(counts);
  if (top < 0) return html`Nobody has passed a stage yet. Zeroth Dan is right there.`;
  const next = DAN_STAGES[top + 1]?.key;
  const left = !next ? '' : next === 'Shin' ? '; Shin is still waiting' : `; ${next} to Shin are still waiting`;
  return html`<b>The Dan course, since 2018.</b> Portugal has climbed to the ${danName(top)}${left}.
    <span lang="pt-PT" title="Still plenty of soup to eat: lots of growing to do">Ainda há muita sopa para comer.</span>`;
}

// ---- The completion goal ---------------------------------------------------------------------------------------------
// meta.json `completion` (tools/lib/completion.mjs homeGoal); the home page never loads the whole completion.json. Data
// from before the goal has none (both parts hide), and data from before homeGoal has only { cleared, total } (the band
// shows, "Still to clear" hides). DESIGN.md "Home page" has the layout.

/**
 * The hero's second band, under the Dan ladder and in its shape: the share of ranked maps cleared as a figure on a thin
 * meter (the ladder's counterpart: how far across, where the ladder is how far up), then a caption with a bold lead-in.
 */
function goalBand(goal) {
  if (!goal?.total) return '';
  const pct = (goal.cleared / goal.total) * 100;
  const left = goal.total - goal.cleared;
  const label = `${fmt.num(pct, 1)}% of ranked osu!catch maps cleared in Portugal: ${fmt.num(goal.cleared)} of ${fmt.num(goal.total)}`;
  return html`<div class="hero-goal">
    <a class="goal-line" href="#/challenges/completion" aria-label="${label}">
      <span class="goal-pct">${fmt.num(pct, 1)}%</span>
      <span class="goal-bar" aria-hidden="true" style="--done:${pct.toFixed(2)}%"><span></span></span>
    </a>
    <p class="hero-caption"><b>Every ranked map, together.</b> ${fmt.num(goal.cleared)} of ${fmt.num(goal.total)} ranked osu!catch maps
      cleared${goal.players ? ` by ${fmt.plural(goal.players, 'player')}` : ''}; ${left ? `${fmt.num(left)} to go.` : 'nothing left.'}
      <a href="#/challenges/completion">See what’s left</a></p>
  </div>`;
}

/**
 * "Still to clear", under the map of the week: the easiest maps nobody has passed (the quickest way to move the
 * band's figure) and the newest first clear. Rows of `next`: [mapId, setId, version, stars, rankedDay, osu! plays].
 */
function goalNext(goal, index) {
  if (!goal?.next?.length) return '';
  const left = goal.total - goal.cleared;
  const latest = goal.latest;
  return html`<section class="goal-next">
    <div class="section-head"><h2>Still to clear</h2><a href="#/challenges/completion?sort=easy">See all ${fmt.num(left)}</a></div>
    <p class="muted small">The easiest ranked maps nobody in Portugal has passed yet.</p>
    ${goal.next.map(([id, set, version, stars]) => {
      const named = goal.sets?.[set];
      const title = named ? `${named[0]} - ${named[1]}` : `Map #${id}`;
      return html`<a class="map goal-map" href="#/map/${id}">
        ${setCover(set)}
        <span class="map-text">
          <span class="map-title" title="${title}">${title}</span>
          <span class="map-sub">${starsBadge(stars)} [${version}]</span>
        </span>
      </a>`;
    })}
    ${latest ? html`<div class="week-top"><span class="faint small">Latest clear</span> ${playerLink(latest[1], index, 'avatar-sm')}
      ${latest[2] ? html`<span class="muted small" title="${fmt.date(latest[2])}">${fmt.ago(latest[2])}</span>` : ''}
      <a class="dim-link" href="#/map/${latest[0]}">${mapLabel(latest[0], goal.maps?.[latest[0]])}</a></div>` : ''}
  </section>`;
}

function miniBoard(list, key, cat) {
  const rows = list.filter(p => p[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 5);
  const me = prefs.get('me', null);
  return html`<div class="card">
    <h3 class="board-title"><span class="cat cat-${cat}">${CAT_LABEL[cat]}</span></h3>
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
  const counts = passCounts(list);

  root.innerHTML = String(html`
    <section class="hero">
      <div>
        <h1>Portugal’s <em>osu!catch</em> community</h1>
        <p>Leaderboards, the Dan course and weekly challenges, from everything the PT-CTB Discord’s bot tracks.</p>
        <div class="hero-actions">
          ${CONFIG.discordInvite ? html`<a class="btn btn-primary" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">Join the Discord</a>` : ''}
          <a href="#/rankings">See the leaderboards</a>
          ${mine ? html`<a href="#/player/${mine.id}">Your profile</a>` : html`<button type="button" class="link-button" data-find>Find yourself</button>`}
        </div>
      </div>
      <dl class="hero-stats">
        <div><dt>Players tracked</dt><dd>${fmt.num(m.totals.players)}</dd></div>
        <div><dt>Scores</dt><dd>${fmt.num(m.totals.scores)}</dd></div>
        <div><dt>Maps played</dt><dd>${fmt.num(m.totals.maps)}</dd></div>
        <div><dt>Fruits caught</dt><dd>${fmt.num(m.totals.fruits)}</dd></div>
        <div class="hero-rework" title="Last osu!catch pp change: ${fmt.date(LAST_REWORK)}"><dt>Days without a pp rework</dt><dd>${fmt.num(reworkDays)}</dd></div>
      </dl>
      <div class="hero-ladder">
        ${ladderBand(counts, { mine: highestDan(mine) })}
        <p class="hero-caption">${ladderCaption(counts)} <a href="#/challenges/dan">Open the Dan course</a></p>
        ${goalBand(m.completion)}
      </div>
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
        ${weeklySummary(ch.weekly, ch.maps, index)}
        ${goalNext(m.completion, index)}
      </div>
      <div>
        <div class="section-head"><h2>Recent activity</h2><a href="#/activity">See all →</a></div>
        <div class="feed">${act.events.slice(0, 5).map(e => eventItem(e, index, act.maps))}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Since 2018</h2><a href="#/team">Team Portugal →</a></div>
      <ol class="since">${HISTORY.map(([year, text]) => html`<li><span class="since-year">${year}</span><p>${text}</p></li>`)}</ol>
    </section>

    <section class="section">
      <div class="section-head"><h2>How to join</h2><a href="#/join">The full guide →</a></div>
      <div class="steps steps-row">
          <div class="step"><div><b>Join the Discord server</b><p>That’s where the bot lives and where the community chats, shares plays and sets up matches.</p></div></div>
          <div class="step"><div><b>Verify your account with <span class="kbd">/verify</span></b><p>You sign in to osu! and, if your account is Portuguese, you get the verified role straight away. </p></div></div>
          <div class="step"><div><b>Play!</b><p>The bot fetches recent plays for everyone it tracks every 30 minutes. You can also use <span class="kbd">/rs</span> to show your latest one.</p></div></div>
        </div>
    </section>
  `);
  root.querySelector('[data-find]')?.addEventListener('click', openSearch);
}
