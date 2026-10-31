import { html } from '../core/html.js';
import { meta, players, activity, challenges, records } from '../core/data.js';
import { M, DAN_STAGES } from '../core/model.js';
import { eventItem, danName } from '../core/events.js';
import { THRONE_PLAYER, HISTORY } from '../core/lore.js';
import { ladderBand, passCounts, highestDan, topStage } from '../core/ladder.js';
import { weeklySummary } from '../core/weekly.js';
import { season } from '../core/fun.js';
import {
  setTitle, avatar, mapText, cover, setCover, starsBadge, CAT_LABEL, prefs, openSearch, isInactiveOnOsu, inactiveTag, isLegend, legendTag, officialPp,
  playerLink, mapLabel,
} from '../core/ui.js';
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
    <a class="goal-line" href="#/challenges/completion" aria-label="${label}">
      <span class="goal-pct">${fmt.num(pct, 1)}%</span>
      <span class="goal-bar" aria-hidden="true" style="--done:${pct.toFixed(2)}%"><span></span></span>
    </a>
    <p class="hero-caption"><b>${t('Every ranked map, together.')}</b> ${goal.players
      ? t('{cleared} of {total} ranked osu!catch maps cleared by {players};', { ...counts, players: fmt.plural(goal.players, 'player') })
      : t('{cleared} of {total} ranked osu!catch maps cleared;', counts)} ${left ? t('{n} to go.', { n: fmt.num(left) }) : t('nothing left.')}
      <a href="#/challenges/completion">${t('See what’s left')}</a></p>
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
    <div class="section-head"><h2>${t('Still to clear')}</h2><a href="#/challenges/completion?sort=easy">${t('See all {n}', { n: fmt.num(left) })}</a></div>
    <p class="muted small">${t('The easiest ranked maps nobody in Portugal has passed yet.')}</p>
    ${goal.next.map(([id, set, version, stars]) => {
      const named = goal.sets?.[set];
      const title = named ? `${named[0]} - ${named[1]}` : t('Map #{id}', { id });
      return html`<a class="map goal-map" href="#/map/${id}">
        ${setCover(set)}
        <span class="map-text">
          <span class="map-title" title="${title}">${title}</span>
          <span class="map-sub">${starsBadge(stars)} [${version}]</span>
        </span>
      </a>`;
    })}
    ${latest ? html`<div class="week-top"><span class="faint small">${t('Latest clear')}</span> ${playerLink(latest[1], index, 'avatar-sm')}
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
          <span class="n">${i + 1}<span class="sr-only">.</span></span>
          <span class="player">${avatar(p.id, 'avatar-sm')}<span>${p.name}</span>${isLegend(p) ? legendTag({ plain: true }) : offOsu ? inactiveTag(p, { plain: true }) : ''}</span>
          <span class="sr-only">, </span>${offOsu ? officialPp(p, { compact: true }) : html`<span class="pp">${fmt.pp(p[key])}<small>pp</small></span>`}
        </a>`;
      })}
    </div>
    <p class="card-foot"><a href="#/rankings/${{ c: 'converts', u: 'loved', r: 'ranked' }[cat]}">${t('Full leaderboard')}</a></p>
  </div>`;
}

export default async function home(root, { isCurrent }) {
  const [m, list, act, ch, rec] = await Promise.all([meta(), players(), activity(), challenges(), records().catch(() => null)]);
  if (!isCurrent()) return;
  setTitle('');
  const index = new Map(list.map(p => [p.id, p]));
  const mine = index.get(prefs.get('me', null)) ?? null;
  const boss = index.get(THRONE_PLAYER);
  const bossHeld = rec?.throne?.held ?? (boss ? boss.firsts.c + boss.firsts.u + boss.firsts.r : 0);
  const week = ch.week;
  const weekMeta = week ? ch.maps[week.map] : null;
  const weekText = week ? mapText(week.map, weekMeta) : null;
  const counts = passCounts(list);

  root.innerHTML = String(html`
    <section class="hero">
      <div>
        <h1>${th('Portugal’s {catch} community', { catch: html`<em>osu!catch</em>` })}</h1>
        <p>${t('Leaderboards, the Dan course and weekly challenges, from everything the PT-CTB Discord’s bot tracks.')}</p>
        <div class="hero-actions">
          ${CONFIG.discordInvite ? html`<a class="btn btn-primary" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">${t('Join the Discord')}</a>` : ''}
          <a href="#/rankings">${t('See the leaderboards')}</a>
          ${mine ? html`<a href="#/player/${mine.id}">${t('Your profile')}</a>` : html`<button type="button" class="link-button" data-find>${t('Find yourself')}</button>`}
        </div>
      </div>
      <dl class="hero-stats">
        <div><dt>${t('Players tracked')}</dt><dd>${fmt.num(m.totals.players)}</dd></div>
        <div><dt>${t('Scores')}</dt><dd>${fmt.num(m.totals.scores)}</dd></div>
        <div><dt>${t('Maps played')}</dt><dd>${fmt.num(m.totals.maps)}</dd></div>
        <div><dt>${t('Fruits caught')}</dt><dd>${fmt.num(m.totals.fruits)}</dd></div>
      </dl>
      <div class="hero-ladder">
        ${ladderBand(counts, { mine: highestDan(mine) })}
        <p class="hero-caption">${ladderCaption(counts)} <a href="#/challenges/dan">${t('Open the Dan course')}</a></p>
        ${goalBand(m.completion)}
      </div>
    </section>

    ${season() === 'xmas' ? html`<p class="mt-4 notice">${th('{greeting}, you lot. Play less, eat more. 🎅', { greeting: html`<span lang="pt-PT">Feliz Natal</span>` })}</p>` : ''}

    ${boss && bossHeld ? html`<a class="throne-strip card-link" href="#/records?at=throne">
      ${avatar(boss.id, 'avatar-md')}
      <span><b>${t('{name} still holds {n} #1s.', { name: boss.name, n: fmt.num(bossHeld) })}</b> <span class="muted">${t('Snipe him. He keeps asking.')}</span></span>
      <span class="throne-go">${t('Dethrone Tris')}</span>
    </a>` : ''}

    <section class="section">
      <div class="section-head"><h2>${t('Portugal’s best')}</h2><a href="#/rankings">${t('All leaderboards')}</a></div>
      <div class="grid grid-3">
        ${miniBoard(list, 'cv', 'c')}
        ${miniBoard(list, 'ul', 'u')}
        ${miniBoard(list, 'pp', 'r')}
      </div>
    </section>

    <section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('Map of the week')}</h2><a href="#/challenges/week">${t('Challenges')}</a></div>
        ${week ? html`<a class="card-flush card card-link" href="#/map/${week.map}">
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
        <div class="section-head"><h2>${t('Recent activity')}</h2><a href="#/activity">${t('See all')}</a></div>
        <div class="feed">${act.events.slice(0, 5).map(e => eventItem(e, index, act.maps))}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('Since 2018')}</h2><a href="#/team">${t('Team Portugal')}</a></div>
      <ol class="since">${HISTORY.map(([year, text]) => html`<li><span class="since-year">${year}</span><p>${text}</p></li>`)}</ol>
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('How to join')}</h2><a href="#/join">${t('The full guide')}</a></div>
      <div class="steps steps-row">
          <div class="step"><div><b>${t('Join the Discord server')}</b><p>${t('That’s where the bot lives and where the community chats, shares plays and sets up matches.')}</p></div></div>
          <div class="step"><div><b>${th('Verify your account with {command}', { command: html`<span class="kbd">/verify</span>` })}</b><p>${t('You sign in to osu! and, if your account is Portuguese, you get the verified role straight away.')}</p></div></div>
          <div class="step"><div><b>${t('Play!')}</b><p>${th('The bot fetches recent plays for everyone it tracks every 15 minutes, and new plays show up here within a few minutes after that. You can also use {command} to show your latest one.', { command: html`<span class="kbd">/rs</span>` })}</p></div></div>
        </div>
    </section>
  `);
  root.querySelector('[data-find]')?.addEventListener('click', openSearch);
}
