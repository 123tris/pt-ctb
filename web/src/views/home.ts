// The home page (/), as assets/js/pages/home.js draws it, from two files: the core pack (every player, for the boards,
// the Dan ladder and names) and the engine's home.json, which has just what the page shows of the rest. The old page
// gathers that from five files: activity, challenges, records, bounties and meta.json, about 59 KB brotli; home.json is
// about 2 KB.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { DAN_STAGES, M, THRONE_PLAYER } from '../kernel/model.ts';
import { avatar, isInactiveOnOsu, isLegend, nameClass, officialPpCompact, playerLinkId, rowOf, tipTag, type Players } from '../ui/players.ts';
import { cover, mapLabel, mapText, setCover, starsBadge, type MapMeta } from '../ui/maps.ts';
import { catLabel, type Cat } from '../ui/scores.ts';
import { eventItem, danName, type ActivityEvent } from '../ui/events.ts';
import { highestDan, ladderBand, passCounts, topStage } from '../ui/ladder.ts';
import { weeklySummary, type Weekly } from '../ui/weekly.ts';
import { andList, monthLabel, slotName, tierName, timeLeft } from '../ui/hill.ts';
import { wanted } from '../ui/challenge-chips.ts';
import { bananas } from '../ui/bananas.ts';
import { history } from '../ui/lore.ts';

/** The completion goal (meta.json `completion`): the share of ranked maps cleared, and the easiest left. */
export interface Goal {
  cleared: number;
  total: number;
  players?: number;
  /** [mapId, setId, version, stars, rankedDay, osu! plays], easiest first. */
  next?: [number, number, string, number, ...unknown[]][];
  sets?: Record<string, [string, string]>;
  /** [mapId, player, time]: the newest first clear. */
  latest?: [number, number, number | null] | null;
  maps?: Record<string, MapMeta>;
}

/** King of the hill's month in brief (meta.json `hill`). */
export interface HillNow {
  status: string;
  month: string;
  end: number;
  /** [slot, tier, mapId, holder or null]. */
  pool: [string, string, number, number | null][];
  maps: Record<string, MapMeta>;
}

/** packs/home.json (engine/…/Build.Packs.cs HomeFile). */
export interface Home {
  totals: { players: number; scores: number; maps: number; fruits: number };
  completion: Goal | null;
  hill: HillNow | null;
  events: ActivityEvent[];
  week: { map: number; end: number; plays: number; players: number } | null;
  weekly: Weekly | null;
  maps: Record<string, MapMeta>;
  throne: number | null;
  /** The open bounties ([map, …, goal, posted, …, pledges, …, pot]) and their maps, as bounties.json has them. */
  bounties: { open: unknown[][]; maps: Record<string, MapMeta> };
}

export interface Data {
  core: CorePack;
  home: Home;
  /** CONFIG.discordInvite. */
  invite: string;
  /** Whether "Sign in with osu!" works on this address (client/bananas.ts signInHere). */
  signIn: boolean;
}

/** Under the ladder: how far up Portugal has got, and what's left. */
function ladderCaption(ctx: Ctx, counts: number[]): Safe | string {
  const { t } = ctx;
  const top = topStage(counts);
  if (top < 0) return t('Nobody has passed a stage yet. Zeroth Dan is right there.');
  const next = DAN_STAGES[top + 1]?.key;
  const stage = danName(ctx, top);
  const climbed = !next ? t('Portugal has climbed to the {stage}.', { stage })
    : next === 'Shin' ? t('Portugal has climbed to the {stage}; Shin is still waiting.', { stage })
    : t('Portugal has climbed to the {stage}; {next} to Shin are still waiting.', { stage, next });
  return html`<b>${t('The Dan course, since 2018.')}</b> ${climbed}
    <span lang="pt-PT" title="${t('Still plenty of soup to eat: lots of growing to do')}">Ainda há muita sopa para comer.</span>`;
}

/**
 * The hero's second band, under the Dan ladder and in its shape: the share of ranked maps cleared as a figure on a thin
 * meter, then a caption with a bold lead-in. Data from before the goal has none (it hides).
 */
function goalBand(ctx: Ctx, goal: Goal | null): Safe | '' {
  const { t, fmt } = ctx;
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

/** "Still to clear", under the map of the week: the easiest maps nobody has passed, and the newest first clear. */
function goalNext(ctx: Ctx, goal: Goal | null, players: Players): Safe | '' {
  const { t, fmt } = ctx;
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
          <span class="map-sub">${starsBadge(ctx, stars)} [${version}]</span>
        </span>
      </a>`;
    })}
    ${latest ? html`<div class="week-top"><span class="faint small">${t('Latest clear')}</span> ${playerLinkId(ctx, players, latest[1], 'avatar-sm')}
      ${latest[2] ? html`<span class="muted small" title="${fmt.date(latest[2])}">${fmt.ago(latest[2])}</span>` : ''}
      <a class="dim-link" href="/map/${latest[0]}">${mapLabel(ctx, latest[0], goal.maps?.[latest[0]])}</a></div>` : ''}
  </section>`;
}

/** King of the hill's month: how many crowns are taken, then up to three slots nobody holds, or who holds the most. */
function hillSummary(ctx: Ctx, month: HillNow | null, players: Players): Safe | '' {
  const { t, th, fmt } = ctx;
  if (month?.status !== 'live') return '';
  const ended = month.end <= ctx.now();
  const free = month.pool.filter(r => r[3] === null);
  const held = new Map<number, number>();
  for (const r of month.pool) if (r[3] !== null) held.set(r[3], (held.get(r[3]) ?? 0) + 1);
  const most = Math.max(0, ...held.values());
  const leaders = [...held].filter(([, n]) => n === most).map(([id]) => id);
  const counts = { month: monthLabel(ctx, month.month), held: fmt.num(month.pool.length - free.length), total: fmt.num(month.pool.length) };
  const lead = leaders.length ? th(ended ? 'Most crowns: {players} with {crowns}' : 'Holding the most crowns right now: {players} with {crowns}', {
    players: andList(ctx, leaders.map(id => playerLinkId(ctx, players, id, 'avatar-sm'))), crowns: fmt.plural(most, 'crown'),
  }) : '';
  return html`<section class="week-summary">
    <div class="section-head"><h2>${t('King of the hill')}</h2><a href="/challenges/hill">${t('See the pool')}</a></div>
    ${ended ? html`<p class="muted small">${t('{month} has ended: {held} of {total} crowns kept, final after the bot’s next update.', counts)}</p>
      ${lead ? html`<div class="week-top">${lead}</div>` : ''}`
    : html`<p class="muted small">${t('{month}: {held} of {total} crowns taken, {left}.', { ...counts, left: timeLeft(ctx, month.end) })}</p>
      ${free.slice(0, 3).map(([slot, tier, id]) => html`<div class="week-top"><span class="faint small">${slotName(ctx, slot)} · ${tierName(ctx, tier)}</span>
        <span class="muted">${t('Up for grabs')}</span> <a class="dim-link" href="/map/${id}">${mapLabel(ctx, id, month.maps[id])}</a></div>`)}
      ${!free.length && lead ? html`<div class="week-top">${lead}</div>` : ''}`}
  </section>`;
}

/**
 * The open bounties with the most on offer, at most three: the biggest Bananas pots first (row[9]), then the most
 * pledges still standing, then the newest. A pot leads its line in gold; the pledges follow.
 */
function bountySummary(ctx: Ctx, board: Home['bounties']): Safe | '' {
  const { t, fmt } = ctx;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const open = (board?.open ?? []) as any[][];
  if (!open.length) return '';
  const live = (r: unknown[]) => (r[7] as unknown[][]).filter(p => !p[4]);
  const top = [...open].sort((a, b) => (b[9] ?? 0) - (a[9] ?? 0) || live(b).length - live(a).length || (b[3] ?? 0) - (a[3] ?? 0)).slice(0, 3);
  return html`<section class="week-summary">
    <div class="section-head"><h2>${t('Open bounties')}</h2><a href="/challenges/bounties">${t('See all {n}', { n: fmt.num(open.length) })}</a></div>
    ${top.map(r => {
      const [first, ...more] = live(r);
      const prize = first ? (first[1] ? t('{prize} · from {by}', { prize: first[0], by: first[1] }) : String(first[0])) : '';
      return html`<div class="week-top"><span class="faint small">${wanted(ctx)[r[2]]}</span>
        ${r[9] ? html`<b class="home-pot">${bananas(ctx, r[9])}</b>` : ''}
        ${prize ? html`<span class="muted">${more.length ? t('{prize} and {n} more', { prize, n: fmt.num(more.length) }) : prize}</span>` : ''}
        <a class="dim-link" href="/map/${r[0]}">${mapLabel(ctx, r[0], board.maps[r[0]])}</a></div>`;
    })}
  </section>`;
}

/** A board's top five (`key` hundredths). The official one includes players inactive on osu!, tagged as such. */
function miniBoard(ctx: Ctx, players: Players, key: 'cv' | 'ul' | 'pp', cat: Cat): Safe {
  const { t, fmt } = ctx;
  const values = players[key];
  const rows: number[] = [];
  for (let row = 0; row < players.rows; row++) if (values[row] > 0) rows.push(row);
  rows.sort((a, b) => values[b] - values[a]);
  const slug = { c: 'converts', u: 'loved', r: 'ranked' }[cat];
  return html`<div class="card">
    <h3 class="board-title"><a class="title-link" href="/rankings/${slug}"><span class="cat cat-${cat}">${catLabel(ctx, cat)}</span></a></h3>
    <div class="mini-board">
      ${rows.slice(0, 5).map((row, i) => {
        const id = players.id[row];
        const offOsu = cat === 'r' && isInactiveOnOsu(players, row);
        return html`<a class="line ${id === ctx.me ? 'me' : ''}" href="/player/${id}">
          <span class="n">${i + 1}<span class="sr-only">.</span></span>
          <span class="player">${avatar(ctx, players, row, 'avatar-sm')}<span class="${nameClass(ctx, players, row)}">${players.name.at(row)}</span>${isLegend(ctx, players, row)
            ? tipTag(t('legend'), t('A former Portuguese top 5 player, now inactive.'), { plain: true })
            : offOsu ? inactiveTagPlain(ctx, players, row) : ''}</span>
          <span class="sr-only">, </span>${offOsu ? officialPpCompact(ctx, players, row) : html`<span class="pp">${fmt.pp(values[row] / 100)}<small>pp</small></span>`}
        </a>`;
      })}
    </div>
  </div>`;
}

/** The "inactive" tag inside a link: the bare tag, with its explanation for screen readers and as a hover title. */
function inactiveTagPlain(ctx: Ctx, players: Players, row: number): Safe {
  const seen = players.ppSeen[row];
  return tipTag(ctx.t('inactive'), `${ctx.t('Inactive on osu!, which shows them at 0 pp.')}${seen ? ` ${ctx.t('Last seen there {date}.', { date: ctx.fmt.date(seen) })}` : ''}`, { plain: true });
}

/** December's greeting, in the visitor's month. */
const isChristmas = (ctx: Ctx) => new Date(ctx.now() * 1000).getMonth() === 11;

export function render(ctx: Ctx, { core, home, invite, signIn }: Data): Safe {
  const { t, th, fmt } = ctx;
  const players = core.players;
  const mine = ctx.me === null ? -1 : rowOf(players, ctx.me);
  const boss = rowOf(players, THRONE_PLAYER);
  const bossHeld = home.throne ?? (boss >= 0 ? players.firstsC[boss] + players.firstsU[boss] + players.firstsR[boss] : 0);
  const week = home.week;
  const weekMeta = week ? home.maps[week.map] : null;
  const weekText = week ? mapText(ctx, week.map, weekMeta) : null;
  const counts = passCounts(players);

  return html`
    <header class="page-head home-head">
      <h1>${th('Portugal’s {catch} community', { catch: html`<em>osu!catch</em>` })}</h1>
      <p>${t('Leaderboards, the Dan course and weekly challenges, from everything the PT-CTB Discord’s bot tracks: {scores} scores by {players} players on {maps} maps.',
        { scores: fmt.num(home.totals.scores), players: fmt.num(home.totals.players), maps: fmt.num(home.totals.maps) })}</p>
      <div class="hero-actions">
        ${invite ? html`<a class="btn btn-primary" href="${invite}" target="_blank" rel="noopener">${t('Join the Discord')}</a>` : ''}
        <a href="/join">${t('How to join')}</a>
        ${mine >= 0 ? html`<a href="/player/${ctx.me}">${t('Your profile')}</a>` : signIn ? html`<button type="button" class="link-button" data-signin>${t('Sign in with osu!')}</button>`
          : html`<button type="button" class="link-button" data-find>${t('Find yourself')}</button>`}
      </div>
    </header>
    <div class="hero-ladder">
      ${ladderBand(ctx, counts, { mine: mine >= 0 ? highestDan(players, mine) : -1 })}
      <p class="hero-caption">${ladderCaption(ctx, counts)} <a href="/challenges/dan">${t('Open the Dan course')}</a></p>
      ${goalBand(ctx, home.completion)}
    </div>

    ${isChristmas(ctx) ? html`<p class="mt-4 notice">${th('{greeting}, you lot. Play less, eat more. 🎅', { greeting: html`<span lang="pt-PT">Feliz Natal</span>` })}</p>` : ''}

    ${boss >= 0 && bossHeld ? html`<a class="throne-strip card-link" href="/records?at=throne">
      ${avatar(ctx, players, boss, 'avatar-md')}
      <span><b>${t('{name} still holds {n} #1s.', { name: players.name.at(boss), n: fmt.num(bossHeld) })}</b> <span class="muted">${t('Snipe him. He keeps asking.')}</span></span>
      <span class="throne-go">${t('Dethrone Tris')}</span>
    </a>` : ''}

    <section class="section">
      <div class="section-head"><h2>${t('Portugal’s best')}</h2><a href="/rankings">${t('All leaderboards')}</a></div>
      <div class="grid grid-3">
        ${miniBoard(ctx, players, 'cv', 'c')}
        ${miniBoard(ctx, players, 'ul', 'u')}
        ${miniBoard(ctx, players, 'pp', 'r')}
      </div>
    </section>

    <section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('Map of the week')}</h2><a href="/challenges/week">${t('Challenges')}</a></div>
        ${week && weekText ? html`<a class="card-flush card card-link" href="/map/${week.map}">
          ${cover(weekMeta, 'cover', 'week-cover')}
          <div class="card-body">
            <div class="text-lg map-title">${weekText.title}</div>
            <div class="map-sub">${starsBadge(ctx, weekMeta?.[M.STARS])} ${weekText.sub}</div>
            <p class="m-0 mt-2 small muted">${t('{plays} this week · {players} in total. Ends {when}.', { plays: fmt.plural(week.plays, 'play'), players: fmt.plural(week.players, 'player'), when: fmt.ago(week.end) })}</p>
          </div>
        </a>` : html`<div class="empty">${t('No map of the week yet.')}</div>`}
        ${weeklySummary(ctx, home.weekly, home.maps, players)}
        ${goalNext(ctx, home.completion, players)}
      </div>
      <div>
        <div class="section-head"><h2>${t('Recent activity')}</h2><a href="/activity">${t('See all')}</a></div>
        <div class="feed feed-open">${home.events.map(e => eventItem(ctx, e, players, home.maps))}</div>
        ${hillSummary(ctx, home.hill, players)}
        ${bountySummary(ctx, home.bounties)}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('Since 2018')}</h2><a href="/team">${t('Team Portugal')}</a></div>
      <ol class="since">${history(ctx).map(([year, text]) => html`<li><span class="since-year">${year}</span><p>${text}</p></li>`)}</ol>
    </section>

  `;
}
