import { html } from '../core/html.js';
import { meta, players, activity, challenges, records, bounties } from '../core/data.js';
import { M, DAN_STAGES } from '../core/model.js';
import { eventItem, danName } from '../core/events.js';
import { THRONE_PLAYER, HISTORY } from '../core/lore.js';
import { ladderBand, passCounts, highestDan, topStage } from '../core/ladder.js';
import { weeklySummary } from '../core/weekly.js';
import { SLOT_NAME, TIER_NAME, monthLabel, timeLeft, andList } from '../core/hill.js';
import { WANTED } from '../core/challenge-chips.js';
import { season } from '../core/fun.js';
import {
  setTitle, avatar, mapText, cover, setCover, starsBadge, CAT_LABEL, myId, openSearch, isInactiveOnOsu, inactiveTag, isLegend, legendTag, officialPp,
  playerLink, mapLabel, nameClass,
} from '../core/ui.js';
import { bananas, signInHere } from '../core/bananas.js';
import * as fmt from '../core/fmt.js';
import { t, th } from '../core/i18n.js';
import { CONFIG } from '../config.js';

/** Under the ladder: how far up Portugal has got, and what's left. */
function ladderCaption(counts) {
  const top = topStage(counts);
  if (top < 0) return t('Nobody has passed a stage yet. Zeroth Dan is right there.');
  const next = DAN_STAGES[top + 1]?.key;
  const stage = danName(top);
  const climbed = !next ? t('Portugal has climbed to the {stage}.', { stage })
    : next === 'Shin' ? t('Portugal has climbed to the {stage}; Shin is still waiting.', { stage })
    : t('Portugal has climbed to the {stage}; {next} to Shin are still waiting.', { stage, next });
  return html`<b>${t('The Dan course, since 2018.')}</b> ${climbed}
    <span lang="pt-PT" title="${t('Still plenty of soup to eat: lots of growing to do')}">Ainda há muita sopa para comer.</span>`;
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
  const counts = { cleared: fmt.num(goal.cleared), total: fmt.num(goal.total) };
  const label = t('{pct}% of ranked osu!catch maps cleared in Portugal: {cleared} of {total}', { pct: fmt.num(pct, 1), ...counts });
  return html`<div class="hero-goal">
    <a class="goal-line" href="/challenges/completion" aria-label="${label}">
      <span class="goal-pct">${fmt.num(pct, 1)}%</span>
      <span class="goal-bar" aria-hidden="true" style="--done:${pct.toFixed(2)}%"><span></span></span>
    </a>
    <p class="hero-caption"><b>${t('Every ranked map, together.')}</b> ${goal.players
      ? t('{cleared} of {total} ranked osu!catch maps cleared by {players};', { ...counts, players: fmt.plural(goal.players, 'player') })
      : t('{cleared} of {total} ranked osu!catch maps cleared;', counts)} ${left ? t('{n} to go.', { n: fmt.num(left) }) : t('nothing left.')}
      <a href="/challenges/completion">${t('See what’s left')}</a></p>
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
    <div class="section-head"><h2>${t('Still to clear')}</h2><a href="/challenges/completion?sort=easy">${t('See all {n}', { n: fmt.num(left) })}</a></div>
    <p class="muted small">${t('The easiest ranked maps nobody in Portugal has passed yet.')}</p>
    ${goal.next.map(([id, set, version, stars]) => {
      const named = goal.sets?.[set];
      const title = named ? `${named[0]} - ${named[1]}` : t('Map #{id}', { id });
      return html`<a class="map goal-map" href="/map/${id}">
        ${setCover(set)}
        <span class="map-text">
          <span class="map-title" title="${title}">${title}</span>
          <span class="map-sub">${starsBadge(stars)} [${version}]</span>
        </span>
      </a>`;
    })}
    ${latest ? html`<div class="week-top"><span class="faint small">${t('Latest clear')}</span> ${playerLink(latest[1], index, 'avatar-sm')}
      ${latest[2] ? html`<span class="muted small" title="${fmt.date(latest[2])}">${fmt.ago(latest[2])}</span>` : ''}
      <a class="dim-link" href="/map/${latest[0]}">${mapLabel(latest[0], goal.maps?.[latest[0]])}</a></div>` : ''}
  </section>`;
}

// ---- This month ------------------------------------------------------------------------------------------------------
// Under the recent activity, what's on beyond the week: King of the hill's month and the open bounties, in the shape of
// "This week so far". meta.json's `hill` (tools/lib/hill.mjs hillNow) and bounties.json (small); the home page never
// loads hill.json. Each part hides on its own when there's nothing running.

/** The month's pool: how many crowns are taken, then up to three slots nobody holds, or who holds the most. */
function hillSummary(month, index) {
  if (month?.status !== 'live') return '';
  const ended = month.end <= Date.now() / 1000;
  const free = month.pool.filter(r => r[3] === null);
  const held = new Map();
  for (const r of month.pool) if (r[3] !== null) held.set(r[3], (held.get(r[3]) ?? 0) + 1);
  const most = Math.max(0, ...held.values());
  const leaders = [...held].filter(([, n]) => n === most).map(([id]) => id);
  const counts = { month: monthLabel(month.month), held: fmt.num(month.pool.length - free.length), total: fmt.num(month.pool.length) };
  const lead = leaders.length ? th(ended ? 'Most crowns: {players} with {crowns}' : 'Holding the most crowns right now: {players} with {crowns}', {
    players: andList(leaders.map(id => playerLink(id, index, 'avatar-sm'))), crowns: fmt.plural(most, 'crown'),
  }) : '';
  return html`<section class="week-summary">
    <div class="section-head"><h2>${t('King of the hill')}</h2><a href="/challenges/hill">${t('See the pool')}</a></div>
    ${ended ? html`<p class="muted small">${t('{month} has ended: {held} of {total} crowns kept, final after the bot’s next update.', counts)}</p>
      ${lead ? html`<div class="week-top">${lead}</div>` : ''}`
    : html`<p class="muted small">${t('{month}: {held} of {total} crowns taken, {left}.', { ...counts, left: timeLeft(month.end) })}</p>
      ${free.slice(0, 3).map(([slot, tier, id]) => html`<div class="week-top"><span class="faint small">${SLOT_NAME[slot]} · ${TIER_NAME[tier]}</span>
        <span class="muted">${t('Up for grabs')}</span> <a class="dim-link" href="/map/${id}">${mapLabel(id, month.maps[id])}</a></div>`)}
      ${!free.length && lead ? html`<div class="week-top">${lead}</div>` : ''}`}
  </section>`;
}

/**
 * The open bounties with the most on offer, at most three: the biggest Bananas pots first (row[9]), then the most
 * pledges still standing, then the newest. A pot leads its line in gold; the pledges follow.
 */
function bountySummary(board) {
  const open = board?.open ?? [];
  if (!open.length) return '';
  const live = r => r[7].filter(p => !p[4]);
  const top = [...open].sort((a, b) => (b[9] ?? 0) - (a[9] ?? 0) || live(b).length - live(a).length || (b[3] ?? 0) - (a[3] ?? 0)).slice(0, 3);
  return html`<section class="week-summary">
    <div class="section-head"><h2>${t('Open bounties')}</h2><a href="/challenges/bounties">${t('See all {n}', { n: fmt.num(open.length) })}</a></div>
    ${top.map(r => {
      const [first, ...more] = live(r);
      const prize = first ? (first[1] ? t('{prize} · from {by}', { prize: first[0], by: first[1] }) : first[0]) : '';
      return html`<div class="week-top"><span class="faint small">${WANTED[r[2]]}</span>
        ${r[9] ? html`<b class="home-pot">${bananas(r[9])}</b>` : ''}
        ${prize ? html`<span class="muted">${more.length ? t('{prize} and {n} more', { prize, n: fmt.num(more.length) }) : prize}</span>` : ''}
        <a class="dim-link" href="/map/${r[0]}">${mapLabel(r[0], board.maps[r[0]])}</a></div>`;
    })}
  </section>`;
}

function miniBoard(list, key, cat) {
  const rows = list.filter(p => p[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 5);
  const me = myId();
  return html`<div class="card">
    <h3 class="board-title"><a class="title-link" href="/rankings/${{ c: 'converts', u: 'loved', r: 'ranked' }[cat]}"><span class="cat cat-${cat}">${CAT_LABEL[cat]}</span></a></h3>
    <div class="mini-board">
      ${rows.map((p, i) => {
        // The official top 5 includes players inactive on osu! (osu! shows them at 0 pp), tagged as such; legends
        // (lore.js) get their own tag on any board.
        const offOsu = cat === 'r' && isInactiveOnOsu(p);
        return html`<a class="line ${p.id === me ? 'me' : ''}" href="/player/${p.id}">
          <span class="n">${i + 1}<span class="sr-only">.</span></span>
          <span class="player">${avatar(p.id, 'avatar-sm')}<span class="${nameClass(p)}">${p.name}</span>${isLegend(p) ? legendTag({ plain: true }) : offOsu ? inactiveTag(p, { plain: true }) : ''}</span>
          <span class="sr-only">, </span>${offOsu ? officialPp(p, { compact: true }) : html`<span class="pp">${fmt.pp(p[key])}<small>pp</small></span>`}
        </a>`;
      })}
    </div>
  </div>`;
}

export default async function home(root, { isCurrent }) {
  const [m, list, act, ch, rec, board] = await Promise.all([
    meta(), players(), activity(), challenges(), records().catch(() => null), bounties().catch(() => null),
  ]);
  if (!isCurrent()) return;
  setTitle('');
  const index = new Map(list.map(p => [p.id, p]));
  const mine = index.get(myId()) ?? null;
  const boss = index.get(THRONE_PLAYER);
  const bossHeld = rec?.throne?.held ?? (boss ? boss.firsts.c + boss.firsts.u + boss.firsts.r : 0);
  const week = ch.week;
  const weekMeta = week ? ch.maps[week.map] : null;
  const weekText = week ? mapText(week.map, weekMeta) : null;
  const counts = passCounts(list);

  root.innerHTML = String(html`
    <header class="page-head home-head">
      <h1>${th('Portugal’s {catch} community', { catch: html`<em>osu!catch</em>` })}</h1>
      <p>${t('Leaderboards, the Dan course and weekly challenges, from everything the PT-CTB Discord’s bot tracks: {scores} scores by {players} players on {maps} maps.',
        { scores: fmt.num(m.totals.scores), players: fmt.num(m.totals.players), maps: fmt.num(m.totals.maps) })}</p>
      <div class="hero-actions">
        ${CONFIG.discordInvite ? html`<a class="btn btn-primary" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">${t('Join the Discord')}</a>` : ''}
        <a href="/join">${t('How to join')}</a>
        ${mine ? html`<a href="/player/${mine.id}">${t('Your profile')}</a>` : signInHere() ? html`<button type="button" class="link-button" data-signin>${t('Sign in with osu!')}</button>`
          : html`<button type="button" class="link-button" data-find>${t('Find yourself')}</button>`}
      </div>
    </header>
    <div class="hero-ladder">
      ${ladderBand(counts, { mine: highestDan(mine) })}
      <p class="hero-caption">${ladderCaption(counts)} <a href="/challenges/dan">${t('Open the Dan course')}</a></p>
      ${goalBand(m.completion)}
    </div>

    ${season() === 'xmas' ? html`<p class="mt-4 notice">${th('{greeting}, you lot. Play less, eat more. 🎅', { greeting: html`<span lang="pt-PT">Feliz Natal</span>` })}</p>` : ''}

    ${boss && bossHeld ? html`<a class="throne-strip card-link" href="/records?at=throne">
      ${avatar(boss.id, 'avatar-md')}
      <span><b>${t('{name} still holds {n} #1s.', { name: boss.name, n: fmt.num(bossHeld) })}</b> <span class="muted">${t('Snipe him. He keeps asking.')}</span></span>
      <span class="throne-go">${t('Dethrone Tris')}</span>
    </a>` : ''}

    <section class="section">
      <div class="section-head"><h2>${t('Portugal’s best')}</h2><a href="/rankings">${t('All leaderboards')}</a></div>
      <div class="grid grid-3">
        ${miniBoard(list, 'cv', 'c')}
        ${miniBoard(list, 'ul', 'u')}
        ${miniBoard(list, 'pp', 'r')}
      </div>
    </section>

    <section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('Map of the week')}</h2><a href="/challenges/week">${t('Challenges')}</a></div>
        ${week ? html`<a class="card-flush card card-link" href="/map/${week.map}">
          ${cover(weekMeta, 'cover', 'week-cover')}
          <div class="card-body">
            <div class="text-lg map-title">${weekText.title}</div>
            <div class="map-sub">${starsBadge(weekMeta?.[M.STARS])} ${weekText.sub}</div>
            <p class="m-0 mt-2 small muted">${t('{plays} this week · {players} in total. Ends {when}.', { plays: fmt.plural(week.weekly.length, 'play'), players: fmt.plural(week.board.length, 'player'), when: fmt.ago(week.end) })}</p>
          </div>
        </a>` : html`<div class="empty">${t('No map of the week yet.')}</div>`}
        ${weeklySummary(ch.weekly, ch.maps, index)}
        ${goalNext(m.completion, index)}
      </div>
      <div>
        <div class="section-head"><h2>${t('Recent activity')}</h2><a href="/activity">${t('See all')}</a></div>
        <div class="feed feed-open">${act.events.slice(0, 5).map(e => eventItem(e, index, act.maps))}</div>
        ${hillSummary(m.hill, index)}
        ${bountySummary(board)}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('Since 2018')}</h2><a href="/team">${t('Team Portugal')}</a></div>
      <ol class="since">${HISTORY.map(([year, text]) => html`<li><span class="since-year">${year}</span><p>${text}</p></li>`)}</ol>
    </section>
  `);
  root.querySelector('[data-find]')?.addEventListener('click', openSearch);
}
