// The Records page (/records), as assets/js/pages/records.js draws it: the biggest marks across every score the bot
// keeps. From records.json and economy.json (when Bananas is on), with players from the core pack.

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { M, S } from '../kernel/model.ts';
import { stat } from '../ui/page.ts';
import { avatar, nameClass, playerLinkId, ppText, rowOf, type Players } from '../ui/players.ts';
import { mapLink, type MapMeta } from '../ui/maps.ts';
import { catChip, catLabel, posBadge, scoreStats, type Cat, type Play } from '../ui/scores.ts';
import { barChart } from '../ui/charts.ts';
import { bananas } from '../ui/bananas.ts';
import { first10k } from '../ui/lore.ts';

/** A record that is one play: [player, category, ...play]. */
type PlayRow = [number, Cat, ...unknown[]];

export interface Records {
  totals: { scores: number; maps: number; ss: number };
  maps: Record<string, MapMeta>;
  byHour: number[];
  topPlay: Record<Cat, PlayRow | null>;
  hardest: Record<Cat, PlayRow | null>;
  topCombo: PlayRow | null;
  longest: PlayRow | null;
  oldestFirst: PlayRow | null;
  throne?: { u: number; held: number; contested: number; oldest: [Cat, number, ...unknown[]][]; challengers: [number, number][] } | null;
  oneMiss?: [number, number][] | null;
  highestChoke?: PlayRow | null;
  wysi?: PlayRow[];
  hard?: { stars: number; firsts: [number, number][]; fc?: PlayRow | null } | null;
  wall?: [number, number][];
  mostSS: [number, number][];
  mostFC: [number, number][];
}

export interface Economy {
  month: string;
  totals: { supply: number; escrow: number };
  boards: { earned: [number, number][]; hunters: [number, number, number?][]; generous: [number, number][] };
}

export interface Data {
  core: CorePack;
  records: Records;
  economy: Economy | null;
}

const CATS: Cat[] = ['c', 'u', 'r'];
const nameOf = (players: Players, id: number) => {
  const row = rowOf(players, id);
  return row < 0 ? String(id) : players.name.at(row);
};
const avatarOf = (ctx: Ctx, players: Players, id: number, cls: string) => {
  const row = rowOf(players, id);
  return row < 0 ? html`<img class="avatar ${cls}" src="https://a.ppy.sh/${id}" alt="" width="22" height="22" loading="lazy" decoding="async" data-hide-broken>` : avatar(ctx, players, row, cls);
};
const nameClassOf = (ctx: Ctx, players: Players, id: number) => {
  const row = rowOf(players, id);
  return row < 0 ? '' : nameClass(ctx, players, row);
};

/** Tris's #1s that still stand, and who's closest to taking them. */
function throneSection(ctx: Ctx, throne: NonNullable<Records['throne']>, maps: Record<string, MapMeta>, players: Players): Safe | '' {
  const { t, fmt } = ctx;
  if (rowOf(players, throne.u) < 0) return '';
  const name = nameOf(players, throne.u);
  return html`<section class="section" id="throne">
    <div class="section-head"><h2>${t('Dethrone {name}', { name })}</h2><a href="/player/${throne.u}">${t('{name}’s profile', { name })}</a></div>
    <div class="throne-head card">
      ${avatarOf(ctx, players, throne.u, 'avatar-lg')}
      <div>
        <div class="stat-value">${t('{n} #1s', { n: fmt.num(throne.held) })}</div>
        <p class="m-0 mt-1 muted">${t('{name} still holds {held} Portuguese #1s, {contested} of them on maps someone else has played too. He keeps asking to be sniped. Go on.', { name, held: fmt.num(throne.held), contested: fmt.num(throne.contested) })}</p>
      </div>
    </div>
    <div class="mt-4 grid grid-2">
      <div>
        <h3 class="small muted">${t('His oldest #1s still standing')}</h3>
        <div class="rows">${throne.oldest.map(([cat, runner, ...rest]) => {
          const s = rest as Play;
          return html`<div class="row-1col row">
          ${mapLink(ctx, s[S.MAP], maps[s[S.MAP]])}
          <div class="justify-start row-meta">${catChip(ctx, cat)} <span class="faint">${t('#1 since {date}', { date: fmt.date(s[S.TIME]) })}</span><span class="sep"></span>
            <span class="faint">${t('next in line:')}</span> ${playerLinkId(ctx, players, runner, 'avatar-sm')}</div>
        </div>`;
        })}</div>
      </div>
      <div class="card">
        <h3>${t('Closest challengers')}</h3>
        <p class="small muted">${t('Who sits at #2, right behind {name}, on the most maps.', { name })}</p>
        <div class="mini-board">${throne.challengers.map(([uid, n], i) => html`<a class="line" href="/compare/${uid}/${throne.u}">
          <span class="n">${i + 1}<span class="sr-only">.</span></span>
          <span class="player">${avatarOf(ctx, players, uid, 'avatar-sm')}<span class="${nameClassOf(ctx, players, uid)}">${nameOf(players, uid)}</span></span>
          <span class="sr-only">, </span><span class="pp">${fmt.num(n)}<small><span class="sr-only"> </span>${t('maps')}</small></span>
        </a>`)}</div>
      </div>
    </div>
  </section>`;
}

/** A record that is one play, with its headline figure. */
function playRecord(ctx: Ctx, title: string, row: PlayRow | null | undefined, maps: Record<string, MapMeta>, players: Players, highlight: (s: Play, meta: MapMeta) => Value): Safe | '' {
  if (!row) return '';
  const [uid, cat, ...rest] = row;
  const s = rest as Play;
  return html`<div class="card">
    <h3>${title}</h3>
    <div class="mb-2 stat-value">${highlight(s, maps[s[S.MAP]])}</div>
    <div class="mb-2">${mapLink(ctx, s[S.MAP], maps[s[S.MAP]])}</div>
    <div class="score-line">${playerLinkId(ctx, players, uid, 'avatar-sm')} ${catChip(ctx, cat)} ${scoreStats(ctx, s)} ${ppText(ctx, s[S.PP])}</div>
  </div>`;
}

/** A top-5 list: [[player, value]], with an optional line under the title and a footer. */
function leaders(ctx: Ctx, title: string, rows: readonly (readonly [number, number, ...unknown[]])[], players: Players, unit = '', { note, foot }: { note?: string; foot?: Value } = {}): Safe {
  const { fmt } = ctx;
  return html`<div class="card">
    <h3>${title}</h3>
    ${note ? html`<p class="small muted">${note}</p>` : ''}
    <div class="mini-board">${rows.map(([uid, value], i) => html`<a class="line" href="/player/${uid}">
      <span class="n">${i + 1}<span class="sr-only">.</span></span>
      <span class="player">${avatarOf(ctx, players, uid, 'avatar-sm')}<span class="${nameClassOf(ctx, players, uid)}">${nameOf(players, uid)}</span></span>
      <span class="sr-only">, </span><span class="pp">${fmt.num(value)}${unit ? html`<small><span class="sr-only"> </span>${unit}</small>` : ''}</span>
    </a>`)}</div>
    ${foot || ''}
  </div>`;
}

/** Most #1s with only hard maps counted, and the hardest full combo. */
function hardFirsts(ctx: Ctx, h: NonNullable<Records['hard']>, maps: Record<string, MapMeta>, players: Players): Safe {
  const { t, fmt } = ctx;
  let foot: Safe | '' = '';
  if (h.fc) {
    const [uid, cat, ...rest] = h.fc;
    const s = rest as Play;
    foot = html`<div class="card-foot">
    <div class="mb-2 muted">${t('Hardest full combo')}</div>
    ${mapLink(ctx, s[S.MAP], maps[s[S.MAP]])}
    <div class="mt-2 score-line">${playerLinkId(ctx, players, uid, 'avatar-sm')} ${catChip(ctx, cat)} ${scoreStats(ctx, s)}</div>
  </div>`;
  }
  return leaders(ctx, t('Most #1s on {stars}★+ maps', { stars: fmt.num(h.stars) }), h.firsts, players, '', {
    note: t('The same count, but only on maps of {stars}★ and up (nomod stars, no EZ or HT).', { stars: fmt.num(h.stars) }), foot,
  });
}

/**
 * Bananas (economy.json boards): who earned most this month, the top bounty hunters and the most generous. On purpose
 * there's no "richest" board: what counts is what you earn and give, not what you sit on.
 */
function economySection(ctx: Ctx, eco: Economy, players: Players): Safe | '' {
  const { t, fmt } = ctx;
  const { earned, hunters, generous } = eco.boards;
  if (!earned.length && !hunters.length && !generous.length) return '';
  const month = fmt.monthYear(Date.parse(`${eco.month}-15T12:00:00Z`) / 1000);
  return html`<section class="section" id="economy">
    <h2>${t('Economy')}</h2>
    <p class="muted">${t('Bananas are earned by playing and spent on bounties, tips and the shop. {supply} are around right now, {escrow} of them in open bounties.', {
      supply: bananas(ctx, eco.totals.supply), escrow: bananas(ctx, eco.totals.escrow),
    })} <a href="/glossary?at=bananas">${t('What are bananas?')}</a></p>
    <div class="grid grid-3">
      ${leaders(ctx, t('Earned in {month}', { month }), earned.slice(0, 5), players, '🍌', { note: earned.length ? '' : t('Nobody yet this month.') })}
      ${leaders(ctx, t('Top bounty hunters'), hunters.slice(0, 5) as [number, number][], players, '🍌', { note: t('Bananas taken from bounty pots, all time.') })}
      ${leaders(ctx, t('Most generous'), generous.slice(0, 5), players, '🍌', { note: t('Tips and bounty funding given, all time.') })}
    </div>
  </section>`;
}

export function render(ctx: Ctx, { core, records: r, economy: eco }: Data): Safe {
  const { t, tn, fmt } = ctx;
  const players = core.players;
  const maps = r.maps;
  const hours = r.byHour.map((value, hour) => ({ label: `${hour}h`, value, title: t('{from}h–{to}h: {plays}', { from: hour, to: hour + 1, plays: fmt.plural(value, 'play') }) }));
  const peak = r.byHour.indexOf(Math.max(...r.byHour));
  // Most #1s across all three categories, from the core pack (the records file has them per category only).
  const mostFirsts: [number, number][] = [];
  for (let row = 0; row < players.rows; row++) {
    const n = players.firstsC[row] + players.firstsU[row] + players.firstsR[row];
    if (n > 0) mostFirsts.push([players.id[row], n]);
  }
  mostFirsts.sort((a, b) => b[1] - a[1] || a[0] - b[0]).splice(5);
  const jumps = ([['legendary', t('Legendary plays')], r.throne && ['throne', t('Dethrone Tris')], r.oneMiss && ['choke', 'Choke d’Or'],
    r.wysi?.length && ['wysi', 'WYSI'], ['first10k', t('First 10k')], ['collectors', t('Collectors')], eco && ['economy', t('Economy')], ['when', t('When we play')]]
    .filter(Boolean)) as [string, string][];

  return html`
    <header class="page-head">
      <h1>${t('Records')}</h1>
      <p>${t('The biggest marks across every score the bot keeps: each player’s best play on each map.')}</p>
    </header>

    <nav class="jump-links" aria-label="${t('On this page')}">${jumps.map(([id, label]) => html`<a href="/records?at=${id}">${label}</a>`)}</nav>

    <div class="stats">
      ${stat(t('Scores'), fmt.num(r.totals.scores))}
      ${stat(t('Different maps'), fmt.num(r.totals.maps))}
      ${stat('SS', fmt.num(r.totals.ss))}
    </div>

    <section class="section" id="legendary">
      <h2>${t('Legendary plays')}</h2>
      <div class="grid grid-3">
        ${CATS.map(cat => playRecord(ctx, t('Most pp in {category}', { category: catLabel(ctx, cat) }), r.topPlay[cat], maps, players, s => html`${fmt.pp(s[S.PP])} pp`))}
        ${playRecord(ctx, t('Highest combo'), r.topCombo, maps, players, s => `${fmt.num(s[S.COMBO])}x`)}
        ${playRecord(ctx, t('Longest map passed'), r.longest, maps, players, (s, meta) => (meta ? fmt.duration(meta[M.LENGTH]) : '—'))}
        ${playRecord(ctx, t('Oldest #1'), r.oldestFirst, maps, players, s => t('since {date}', { date: fmt.date(s[S.TIME]) }))}
        ${CATS.map(cat => playRecord(ctx, t('Hardest map ({category})', { category: catLabel(ctx, cat) }), r.hardest[cat], maps, players, (s, meta) => (meta ? `★ ${fmt.num(meta[M.STARS], 2)}` : '—')))}
      </div>
      <p class="mt-2 small faint">${t('Plays with EZ or HT don’t count for the hardest and longest maps.')}</p>
    </section>

    ${r.throne ? throneSection(ctx, r.throne, maps, players) : ''}

    ${r.oneMiss ? html`<section class="section" id="choke">
      <h2>${t('The Choke d’Or')}</h2>
      <p class="muted">${t('Plays with exactly one miss: the community’s favourite subject. The 1-miss gods bless some players more than others.')}</p>
      <div class="grid grid-2">
        ${leaders(ctx, t('Most 1-miss plays'), r.oneMiss, players)}
        ${playRecord(ctx, t('The highest choke'), r.highestChoke, maps, players, s => t('{pp} pp, 1 miss', { pp: fmt.pp(s[S.PP]) }))}
      </div>
    </section>` : ''}

    ${r.wysi?.length ? html`<section class="section" id="wysi">
      <h2>${t('WYSI hall')}</h2>
      <p class="muted">${tn(r.wysi.length, '{n} play ended on exactly 727 combo. When you see it…', '{n} plays ended on exactly 727 combo. When you see it…')}</p>
      <div class="rows">${r.wysi.slice(0, 12).map(([uid, cat, ...rest]) => {
        const s = rest as Play;
        return html`<div class="row">
        <div class="row-main">${mapLink(ctx, s[S.MAP], maps[s[S.MAP]])}<div>${playerLinkId(ctx, players, uid, 'avatar-sm')}</div></div>
        <div class="row-meta">${catChip(ctx, cat)} ${scoreStats(ctx, s)}</div>
      </div>`;
      })}</div>
    </section>` : ''}

    <section class="section" id="first10k">
      <h2>${t('First past {pp} pp', { pp: fmt.num(10000) })}</h2>
      <p class="muted">${t('The first Portuguese players to break 10k, and the play that took them there.')}</p>
      <div class="rows">${first10k(ctx).map(([day, name, uid, play], i) => html`<div class="row">
        <div class="score-line">${posBadge(ctx, i + 1)} ${uid && rowOf(players, uid) >= 0 ? playerLinkId(ctx, players, uid, 'avatar-sm') : html`<b>${name}</b>`} <span class="muted">${play}</span></div>
        <div class="row-meta"><span class="faint">${fmt.date(Date.parse(`${day}T12:00:00Z`) / 1000)}</span></div>
      </div>`)}</div>
    </section>

    <section class="section" id="collectors">
      <h2>${t('The collectors')}</h2>
      <p class="muted">${t('Each category’s own #1 count is on the leaderboards.')}</p>
      <div class="grid grid-2">
        ${leaders(ctx, t('Most #1s'), mostFirsts, players)}
        ${r.hard?.firsts.length ? hardFirsts(ctx, r.hard, maps, players) : ''}
        ${r.wall?.length ? leaders(ctx, t('The biggest walls (#1s standing 2+ years)'), r.wall, players) : ''}
        ${leaders(ctx, t('Most SSs'), r.mostSS, players)}
        ${leaders(ctx, t('Most full combos'), r.mostFC, players)}
      </div>
    </section>

    ${eco ? economySection(ctx, eco, players) : ''}

    <section class="section card" id="when">
      <h2 class="card-h">${t('When does Portugal play?')}</h2>
      ${barChart(ctx, hours, { every: 3 })}
      <p class="m-0 mt-2 small muted">${t('Lisbon time when each score was set. Peak time is between {from}h and {to}h.', { from: peak, to: peak + 1 })}</p>
    </section>
  `;
}
