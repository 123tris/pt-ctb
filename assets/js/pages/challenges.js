import { html, raw } from '../core/html.js';
import { challenges, bounties, hill, playerIndex, dan, completion, meta } from '../core/data.js';
import { S, M } from '../core/model.js';
import {
  setTitle, mapLink, playerLink, scoreStats, ppText, posBadge, catChip, bannerArt, mapText, starsBadge, empty, osuMap, prefs,
  pageHead, scoreWhen, setCover, paginate, writeQuery, announce, resultCount, emptyFiltered, tabs, scrollBehavior,
} from '../core/ui.js';
import { economy, session, bananas, fee, RULES, signInButton, sendRequest, myRequests, mapIdFrom } from '../core/bananas.js';
import { passCounts, topStage } from '../core/ladder.js';
import { danName } from '../core/events.js';
import { ANY_STARS, parseStars, formatStars, starsLabel, inStars, isAnyStars } from '../core/star-range.js';
import { starSlider, bindStarSlider } from '../core/star-slider.js';
import { renderDan, DAN_INTRO } from './dan.js';
import { renderHill } from './hill.js';
import { GOAL_LABEL, goalLine, prizeTags, claimMods } from '../core/bounty.js';
import { timeLeft } from '../core/hill.js';
import { runningNow, challengeChips } from '../core/challenge-chips.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

// Six sub-pages with their own URLs (#/challenges/week, /hill, /dan, /targets, /bounties, /completion). "Dan" keeps the
// community's own word. They're tabs, like the leaderboards', and each tab shows where that challenge stands right now.
// The week, the month's King of the hill and the bounties are what's on now: a map in more than one of them carries
// the others' chips (core/challenge-chips.js), here and on its map page.
const TABS = [
  { slug: 'week', label: t('This week'), intro: th('A new map every Monday. The community votes for the next one on Discord; the week’s best plays and the vote are on {activity}.', { activity: html`<a href="#/activity?view=week">${t('Activity')}</a>` }) },
  // Only once the export has hill.json (the bot started King of the hill): see `shown` below.
  { slug: 'hill', label: t('King of the hill'), intro: t('Every month has one map per slot, in an Open and a Challenger tier. NM, HD, HR, DT and FM are catch-specific maps; CV is a convert. The best play there this month holds the crown, and whoever holds it when the month ends keeps it. HT, EZ and speed changes never count.') },
  { slug: 'dan', label: t('Dan course'), intro: DAN_INTRO },
  { slug: 'targets', label: t('Snipe targets'), intro: t('#1s that are begging to be sniped, maps with a single Portuguese player, and maps nobody in Portugal has played yet.') },
  { slug: 'bounties', label: t('Bounties'), intro: t('Prizes the community puts up for hard maps: full combo one, pass it first or take its #1, and the bot announces the claim on Discord.') },
  { slug: 'completion', label: t('Completion'), intro: t('A map counts once any Portuguese player passes it without NF. The goal is every ranked osu!catch-specific difficulty; converts are a separate count.') },
];

/**
 * Each tab's figure: the map of the week's time left, the month's, Portugal's highest Dan, #1s up for grabs, open
 * bounties, the share cleared.
 */
function tabFigures(data, board, index, goal, month) {
  const left = data.week ? Math.max(0, data.week.end - Date.now() / 1000) : 0;
  const top = topStage(passCounts(index.values()));
  return {
    week: data.week ? (left >= 86400 ? t('{n}d left', { n: Math.floor(left / 86400) }) : t('{n}h left', { n: Math.floor(left / 3600) })) : undefined,
    hill: month?.status === 'live' ? timeLeft(month.end) : undefined,
    dan: top >= 0 ? danName(top) : undefined,
    targets: data.beatable.length,
    bounties: board ? board.open.length : undefined,
    completion: goal?.total ? `${fmt.num((goal.cleared / goal.total) * 100, 1)}%` : undefined,
  };
}

function countdown(end) {
  const left = Math.max(0, end - Date.now() / 1000);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = Math.floor(left % 60);
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

/** On phones: rank, player (with the play under the name) and pp; score, play and time are desktop columns. */
function boardTable(rows, index, me, label) {
  return html`<div class="table-wrap" data-label="${label}"><table class="table-compact">
    <thead><tr><th>#</th><th>${t('Player')}</th><th class="num col-opt">${t('Score')}</th><th class="col-opt">${t('Play')}</th><th class="num">pp</th><th class="num col-opt">${t('When')}</th></tr></thead>
    <tbody>${rows.map(([uid, ...s], i) => html`<tr class="${uid === me ? 'me' : ''}">
      <td>${posBadge(i + 1)}</td>
      <td class="cell-player">${playerLink(uid, index, 'avatar-sm')}<span class="cell-sub"><span class="score-line">${scoreStats(s)}</span></span></td>
      <td class="num col-opt">${fmt.num(s[S.SCORE])}</td>
      <td class="col-opt"><span class="score-line">${scoreStats(s)}</span></td><td class="num">${ppText(s[S.PP])}</td>
      <td class="num faint col-opt">${scoreWhen(s, fmt.ago(s[S.TIME]))}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

function weekSection(week, maps, index, me, now) {
  if (!week) return empty(t('No map of the week yet.'));
  const meta = maps[week.map];
  const { title, sub } = mapText(week.map, meta);
  return html`
    <section class="banner">
      ${bannerArt(meta?.[M.SET])}
      <div class="banner-body">
        <div class="links">
          <span class="badge badge-accent">${t('Week {n}', { n: week.id.split('-W')[1] })}</span>
          ${catChip(week.cat)} ${meta ? starsBadge(meta[M.STARS]) : ''} ${challengeChips(week.map, now, 'week')}
        </div>
        <h3 class="banner-title"><a href="#/map/${week.map}">${title}</a></h3>
        <div class="sub">${sub}</div>
        <p class="m-0 mt-3">${th('Ends in {countdown}', { countdown: html`<span class="countdown" id="countdown">${countdown(week.end)}</span>` })}</p>
      </div>
    </section>
    <div class="mt-3 mb-6 btn-row">
      <a class="btn btn-primary" href="${osuMap(week.map)}" target="_blank" rel="noopener">${t('Open on osu!')} ↗</a>
      <a class="btn" href="#/map/${week.map}">${t('Full leaderboard')}</a>
    </div>
    <div class="section-head"><h2>${t('This week’s plays')}</h2></div>
    ${week.weekly.length ? boardTable(week.weekly, index, me, t('This week’s plays on the map of the week')) : empty(t('Nobody has played this map this week. Be the first!'))}
    <div class="mt-6 section-head"><h2>${t('All-time top')}</h2></div>
    ${boardTable(week.board.slice(0, 10), index, me, t('All-time top 10 on the map of the week'))}`;
}

export default async function challengesPage(root, { params, query, isCurrent }) {
  const asked = params.tab;
  // challenges.json (about 12 KB) and bounties.json (smaller), both cached, come on every tab for the tabs' figures and
  // chips; meta.json is already loaded, with the King of the hill month in brief. hill.json only comes for its tab.
  const [data, board, index, danData, goalData, m, crowns, eco] = await Promise.all([
    challenges(), bounties(), playerIndex(), asked === 'dan' ? dan() : null, asked === 'completion' ? completion() : null, meta(),
    asked === 'hill' ? hill() : null, asked === 'bounties' ? economy().catch(() => null) : null,
  ]);
  if (!isCurrent()) return;
  const shown = TABS.filter(x => x.slug !== 'hill' || m.files?.['hill.json']);
  const tab = shown.find(x => x.slug === asked) ?? shown[0];
  const goal = tab.slug === 'completion';
  const now = runningNow({ challenges: data, meta: m, bounties: board });
  setTitle(tab.slug === 'week' ? t('Challenges') : `${tab.label} · ${t('Challenges')}`);
  const me = prefs.get('me', null);
  const maps = data.maps;
  const figures = tabFigures(data, board, index, m.completion, m.hill);

  root.innerHTML = String(html`
    ${pageHead({ title: t('Challenges') })}
    ${tabs(shown.map(x => ({ href: `#/challenges/${x.slug}`, label: x.label, count: figures[x.slug], active: x === tab })), t('Challenges'))}
    <p class="muted tabs-intro">${tab.intro}</p>
    <div id="panel">${tab.slug === 'week' ? weekPanel(data, maps, index, me, now) : tab.slug === 'targets' ? targetsPanel(data, maps, index)
      : tab.slug === 'bounties' ? bountiesPanel(board, data, index, now, eco) : ''}</div>
  `);

  if (tab.slug === 'bounties' && eco) wireBounties(root, board, eco, isCurrent);
  if (tab.slug === 'hill') renderHill(root.querySelector('#panel'), { hill: crowns, index, me, query, now });
  if (tab.slug === 'dan') renderDan(root.querySelector('#panel'), danData, index, query);
  if (goal) renderCompletion(root.querySelector('#panel'), goalData, index, query);
  if (tab.slug === 'week' && data.week) {
    const el = root.querySelector('#countdown');
    const timer = setInterval(() => {
      if (!isCurrent() || !el.isConnected) return clearInterval(timer);
      el.textContent = countdown(data.week.end);
    }, 1000);
  }
}

function weekPanel(data, maps, index, me, now) {
  return html`
    <section>
      <div class="section-head"><h2>${t('Map of the week')}</h2></div>
      ${weekSection(data.week, maps, index, me, now)}
    </section>`;
}

function targetsPanel(data, maps, index) {
  return html`
    <section>
      <div class="section-head"><h2>${t('Vulnerable #1s')}</h2><span class="muted small">${t('Contested maps where the #1 has misses or under 97% accuracy.')}</span></div>
      ${data.beatable.length ? html`<div class="rows">${data.beatable.map(([id, cat, n, [uid, ...s]]) => html`<div class="row">
        <div>${mapLink(id, maps[id])}</div>
        <div class="row-meta">${catChip(cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span class="faint">#1</span> ${playerLink(uid, index, 'avatar-sm')} ${scoreStats(s, { combo: false })} ${ppText(s[S.PP])}</div>
      </div>`)}</div>` : empty(t('Every #1 is well defended. For now.'))}
    </section>

    <section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('One-player maps')}</h2></div>
        <p class="muted small">${t('Hard maps (5★ and up; loved and unranked ones under 10★) with a single Portuguese player. Just pass to take #2, or beat them for #1.')}</p>
        ${data.lonely.length ? html`<div class="rows">${data.lonely.map(([id, cat, [uid, ...s]]) => html`<div class="row-1col row">
          ${mapLink(id, maps[id])}
          <div class="justify-start row-meta">${catChip(cat)} ${playerLink(uid, index, 'avatar-sm')} ${ppText(s[S.PP])}</div>
        </div>`)}</div>` : empty(t('No one-player maps.'))}
      </div>
      <div>
        <div class="section-head"><h2>${t('Unclaimed')}</h2></div>
        <p class="muted small">${t('Popular ranked osu!catch maps with no Portuguese score recorded.')}</p>
        ${data.unclaimed.length ? html`<div class="rows">${data.unclaimed.map(([id, plays, favs]) => html`<div class="row-1col row">
          ${mapLink(id, maps[id])}
          <div class="justify-start row-meta">${t('{plays} plays on osu! · {favs} favourites', { plays: fmt.num(plays), favs: fmt.num(favs) })}</div>
        </div>`)}</div>` : empty(t('Nothing left to claim. Impressive.'))}
      </div>
    </section>`;
}

// ---- Bounties --------------------------------------------------------------------------------------------------------
// bounties.json (tools/lib/bounties.mjs): the bounties moderators post with the bot's !bounty add, the ones claimed, and
// the automatic wanted list. Data from before it has only the wanted list, in challenges.json as `bounties`.

function bountiesPanel(board, data, index, now, eco) {
  const maps = board?.maps ?? data.maps;
  const open = board?.open ?? [];
  const hall = board?.hall ?? [];
  const wanted = board?.wanted ?? data.bounties ?? [];
  return html`
    ${eco ? postSection(eco) : ''}
    <section class="${eco ? 'section' : ''}">
      <div class="section-head"><h2>${t('Open bounties')}</h2></div>
      ${open.length ? html`<div class="rows">${open.map(([id, cat, goal, posted, n, misses, target, pledges, bountyId, pot, funds, poster, expires, mods]) => html`<div class="row bounty">
        <div>${mapLink(id, maps[id])}</div>
        <div class="row-meta">${catChip(cat)}
          <span>${n ? tn(n, '{n} player tried', '{n} players tried') : t('nobody has tried')}</span>
          ${goal === 'fc' && misses !== null ? html`<span>${t('closest: {misses}', { misses: fmt.plural(misses, 'miss', 'misses') })}</span>` : ''}
          ${posted ? html`<span class="faint">${t('posted {ago}', { ago: fmt.ago(posted) })}</span>` : ''}
          ${challengeChips(id, now, 'bounty')}</div>
        <div class="bounty-foot">${goalLine(goal, target, index)}${mods ? claimMods(mods) : ''}${prizeTags(pledges)}</div>
        ${pot ? potLine({ pot, funds, poster, expires }, index) : ''}
        ${eco && bountyId ? html`<div class="bounty-fund"><button class="btn btn-small" type="button" data-fund="${bountyId}" aria-expanded="false">${t('Fund')}</button>
          <div class="fund-form" hidden></div></div>` : ''}
      </div>`)}</div>` : empty(t('No open bounties right now.'))}
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('Hall of fame')}</h2><span class="muted small">${t('Bounties claimed, newest first.')}</span></div>
      ${hall.length ? html`<div class="rows">${hall.map(([id, cat, goal, status, uid, at, mods, acc, combo, pp, prizes]) => html`<div class="row bounty ${status === 'done' ? 'bounty-done' : ''}">
        <div class="row-main">${mapLink(id, maps[id])}
          <div class="justify-start row-meta">${playerLink(uid, index, 'avatar-sm')} <span>${GOAL_LABEL[goal]}</span>
            ${at ? html`<time class="faint" datetime="${new Date(at * 1000).toISOString()}">${fmt.date(at)}</time>` : ''}</div></div>
        <div class="row-meta">${claimMods(mods)} ${acc !== null ? html`<span class="acc">${fmt.acc(acc)}</span>` : ''}
          ${combo !== null ? html`<span class="combo">${fmt.num(combo)}x</span>` : ''} ${pp !== null ? ppText(pp) : ''}</div>
        ${status === 'done' ? html`<div class="bounty-foot"><span class="faint">${t('already done before it was posted')}</span></div>`
          : prizes.length ? html`<div class="bounty-foot">${prizeTags(prizes)}</div>` : ''}
      </div>`)}</div>` : empty(t('Nobody has claimed a bounty yet.'))}
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('Wanted')}</h2><span class="muted small">${t('Boss maps (6.5★ and up) that several Portuguese players have passed but nobody has FC’d.')}</span></div>
      <p class="muted small">${eco ? th('Post any of these with {command} or the form above.', { command: html`<code>!bounty create</code>` })
        : th('A moderator can post any of these with {command}.', { command: html`<code>!bounty add</code>` })}</p>
      ${wanted.length ? html`<div class="rows">${wanted.map(([id, cat, n, fewest]) => html`<div class="row">
        <div>${mapLink(id, maps[id])}</div>
        <div class="row-meta">${catChip(cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span>${t('closest: {misses}', { misses: fmt.plural(fewest, 'miss', 'misses') })}</span><span class="bounty-tag">${t('Nobody’s FC’d this. Yet.')}</span>
          ${eco ? html`<button class="link-button" type="button" data-post-map="${id}">${t('Post a bounty on it')}</button>` : ''}</div>
      </div>`)}</div>` : empty(t('Every boss map has an FC or a bounty on it.'))}
    </section>`;
}

// ---- Bananas on the board -----------------------------------------------------------------------------------------
// With Bananas on (economy.json), a bounty also has a pot: the poster's stake plus what others funded. Posting needs
// RULES.gate earned, a stake of RULES.minStake or more plus the 20% fee, and one post a month; the form shows the cost,
// the balance and each rule before you confirm, then sends a request the bot judges (core/bananas.js).

/** The pot, who posted it and who funded it, and when it ends. */
function potLine({ pot, funds, poster, expires }, index) {
  const named = funds.filter(f => f[0]);
  const others = funds.length - named.length;
  const funders = named.slice(0, 3).map(f => playerLink(f[0], index));
  const more = named.length - funders.length + others;
  return html`<div class="bounty-pot">
    <span class="pot">${th('{amount} pot', { amount: html`<b>${bananas(pot)}</b>` })}</span>
    <span>${poster ? th('posted by {who}', { who: playerLink(poster, index) }) : t('house bounty')}</span>
    ${funders.length || more ? html`<span>${th('funded by {who}', {
      who: html`${funders.map((f, i) => html`${i ? ', ' : ''}${f}`)}${more ? (funders.length ? ` ${t('and {n} more', { n: fmt.num(more) })}` : fmt.plural(more, 'player')) : ''}`,
    })}</span>` : ''}
    ${expires ? html`<span class="faint" title="${fmt.dateTime(expires)}">${t('ends {date}', { date: fmt.date(expires) })}</span>` : ''}
  </div>`;
}

/** The "Post a bounty" section: the rules in one line, then the form (signed in) or a sign-in button. */
function postSection(eco) {
  const me = session();
  const w = me ? eco.players?.[me.id] : null;
  return html`<section id="post-bounty">
    <div class="section-head"><h2>${t('Post a bounty')}</h2></div>
    <p class="muted small">${t('Posting takes {gate} bananas earned, a stake of {stake} or more held until the bounty ends, and a fee of 20% of the stake, which is burned. One a month, two open at most. Anyone signed in can add {fund} or more to a pot.', {
      gate: fmt.num(RULES.gate), stake: fmt.num(RULES.minStake), fund: fmt.num(RULES.minFund),
    })}</p>
    ${!me ? html`<div class="btn-row">${signInButton(t('Sign in to post or fund'))}</div>`
      : !w ? html`<p class="small muted">${t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`
        : html`<div class="btn-row"><button class="btn" type="button" id="post-open" aria-expanded="false" aria-controls="post-form">${t('Post a bounty…')}</button>
          <span class="small muted">${t('Your wallet: {amount}', { amount: bananas(w.b) })}</span></div>
        <form class="post-form" id="post-form" hidden novalidate></form>`}
  </section>`;
}

const lisbonMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit' });
const monthOf = sec => lisbonMonth.format(new Date(sec * 1000));

/**
 * The rules the bot will check, as the site sees them now: [ok, text] each. `asked` are the player's bounty.create
 * requests the bot hasn't refused: one it accepted since the last export isn't on the board yet, so a map counts once
 * whichever of the two has it.
 */
function postChecks(w, stake, open, me, asked) {
  const total = stake + fee(stake);
  const month = monthOf(Date.now() / 1000);
  const mine = open.filter(r => r[11] === me);
  const waiting = asked.filter(r => monthOf(Date.parse(r.t) / 1000) === month);
  const thisMonth = new Set([...mine.filter(r => r[3] && monthOf(r[3]) === month).map(r => r[0]), ...waiting.map(r => r.payload.map)]).size;
  const openCount = new Set([...mine.map(r => r[0]), ...waiting.map(r => r.payload.map)]).size;
  return [
    [w.e >= RULES.gate, t('{gate} earned (you: {earned})', { gate: fmt.num(RULES.gate), earned: fmt.num(w.e) })],
    [stake >= RULES.minStake, t('A stake of {min} or more', { min: fmt.num(RULES.minStake) })],
    [w.b >= total, t('Your wallet covers {total} (you have {balance})', { total: bananas(total), balance: bananas(w.b) })],
    [thisMonth < RULES.postsPerMonth, t('One bounty a month (this month: {n})', { n: fmt.num(thisMonth) })],
    [openCount < RULES.openAtOnce, t('Two open at most (you have {n})', { n: fmt.num(openCount) })],
  ];
}

const checkList = checks => html`<ul class="checks-list">${checks.map(([ok, text]) => html`<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✕'}</span> ${text}<span class="sr-only"> (${ok ? t('met') : t('not met')})</span></li>`)}</ul>`;

/** Wires the Bounties tab's Bananas: the post form, "Post a bounty on it" from the wanted list, and each Fund button. */
function wireBounties(root, board, eco, isCurrent) {
  const me = session();
  const w = me ? eco.players?.[me.id] : null;
  const open = board?.open ?? [];
  let asked = []; // the player's bounty.create requests the bot hasn't refused (postChecks)

  // ---- Post: the fields are drawn once; the cost and the rules under them follow every change ----
  const form = root.querySelector('#post-form');
  const opener = root.querySelector('#post-open');
  const state = { goal: 'fc', mods: [], days: RULES.defaultDays };
  const chip = (attr, value, label, on) => html`<button class="chip ${on ? 'active' : ''}" type="button" data-${raw(attr)}="${value}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
  const chipGroupOf = (attr, label, items, on) => html`<div class="field"><span class="field-label" id="post-${raw(attr)}-label">${label}</span>
    <div class="chips" role="group" aria-labelledby="post-${raw(attr)}-label">${items.map(([value, text]) => chip(attr, value, text, on(value)))}</div></div>`;
  const read = () => ({ map: mapIdFrom(form.querySelector('#post-map').value), stake: Math.max(0, Math.round(Number(form.querySelector('#post-stake').value) || 0)) });
  function drawSummary() {
    if (!form || form.hidden || !form.querySelector('#post-sum')) return;
    const { map, stake } = read();
    const checks = postChecks(w, stake, open, me.id, asked);
    const ready = map && checks.every(c => c[0]);
    form.querySelector('#post-snipe').hidden = state.goal !== 'snipe';
    form.querySelector('#post-sum').innerHTML = String(html`
      <dl class="kv post-cost">
        <div><dt>${t('Stake')}</dt><dd>${bananas(stake)}</dd></div>
        <div><dt>${t('Fee (burned)')}</dt><dd>${bananas(fee(stake))}</dd></div>
        <div><dt>${t('Total')}</dt><dd>${bananas(stake + fee(stake))}</dd></div>
        <div><dt>${t('Left after')}</dt><dd>${bananas(w.b - stake - fee(stake))}</dd></div>
      </dl>
      ${checkList(checks)}`);
    form.querySelector('[type=submit]').disabled = !ready;
    form.querySelector('#post-why').textContent = !map ? t('Add the map first.') : ready ? t('The bot checks it all again and answers within 15 minutes.') : t('Every rule above has to be met.');
  }
  function drawPost(mapText = '') {
    form.innerHTML = String(html`
      <div class="post-grid">
        <div class="field"><label for="post-map">${t('Map')}</label>
          <input class="input" id="post-map" value="${mapText}" placeholder="${t('Map id or osu! link')}" autocomplete="off"></div>
        <div class="field"><label for="post-stake">${t('Stake')}</label>
          <input class="input" id="post-stake" type="number" inputmode="numeric" min="${RULES.minStake}" step="50" value="${RULES.minStake}"></div>
        ${chipGroupOf('goal', t('Goal'), [['fc', t('Full combo')], ['pass', t('First pass')], ['snipe', t('Take the #1')]], v => state.goal === v)}
        ${chipGroupOf('mod', t('Mods asked for (optional)'), RULES.mods.map(m => [m, m]), v => state.mods.includes(v))}
        ${chipGroupOf('days', t('Runs for'), RULES.days.map(d => [d, t('{n} days', { n: d })]), v => state.days === Number(v))}
      </div>
      <p class="small muted" id="post-snipe" hidden>${t('A snipe bounty targets whoever holds the #1 when it’s posted, unless they have the snipe shield on.')}</p>
      <div id="post-sum" aria-live="polite"></div>
      <div class="btn-row">
        <button class="btn btn-primary" type="submit" disabled>${t('Post bounty')}</button>
        <span class="small muted" id="post-why"></span>
      </div>`);
    drawSummary();
  }
  const openPost = (mapText = '') => {
    form.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    drawPost(mapText);
  };
  opener?.addEventListener('click', () => {
    if (form.hidden) { openPost(); form.querySelector('#post-map').focus(); } else { form.hidden = true; opener.setAttribute('aria-expanded', 'false'); }
  });
  root.querySelectorAll('[data-post-map]').forEach(b => b.addEventListener('click', () => {
    root.querySelector('#post-bounty').scrollIntoView({ behavior: scrollBehavior() });
    if (!form) return;
    openPost(b.dataset.postMap);
    form.querySelector('#post-stake').focus();
  }));
  form?.addEventListener('input', drawSummary);
  form?.addEventListener('click', e => {
    const b = e.target.closest('[data-goal], [data-mod], [data-days]');
    if (!b) return;
    if (b.dataset.goal) state.goal = b.dataset.goal;
    if (b.dataset.days) state.days = Number(b.dataset.days);
    if (b.dataset.mod) state.mods = state.mods.includes(b.dataset.mod) ? state.mods.filter(m => m !== b.dataset.mod) : [...state.mods, b.dataset.mod];
    // Only the pressed state changes; the fields keep what was typed.
    for (const [attr, on] of [['goal', v => state.goal === v], ['mod', v => state.mods.includes(v)], ['days', v => state.days === Number(v)]]) {
      form.querySelectorAll(`[data-${attr}]`).forEach(c => {
        c.classList.toggle('active', on(c.dataset[attr]));
        c.setAttribute('aria-pressed', String(on(c.dataset[attr])));
      });
    }
    drawSummary();
  });
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const { map, stake } = read();
    if (!map || !postChecks(w, stake, open, me.id, asked).every(c => c[0])) return;
    const mods = RULES.mods.filter(m => state.mods.includes(m)).join('') || null;
    if (await sendRequest('bounty.create', { map, goal: state.goal, stake, mods, days: state.days })) {
      asked = [...asked, { t: new Date().toISOString(), payload: { map } }];
      form.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
    }
  });
  // The player's posts the board doesn't show yet count towards the month's one (and the two open).
  if (me) myRequests().then(list => { if (list && isCurrent()) { asked = list.filter(r => r.type === 'bounty.create' && r.status !== 'rejected'); drawSummary(); } });

  // ---- Fund: an amount, the wallet before and after, and the button ----
  root.querySelectorAll('[data-fund]').forEach(button => {
    const box = button.nextElementSibling;
    const id = Number(button.dataset.fund);
    const note = amount => (amount < RULES.minFund ? t('At least {min}.', { min: bananas(RULES.minFund) })
      : amount > w.b ? t('Your wallet has {balance}.', { balance: bananas(w.b) })
        : t('Your wallet: {balance}, then {after}. No fee. If nobody claims it, 70% comes back.', { balance: bananas(w.b), after: bananas(w.b - amount) }));
    const update = () => {
      const amount = Math.round(Number(box.querySelector('input').value) || 0);
      const submit = box.querySelector('[type=submit]');
      submit.disabled = !(amount >= RULES.minFund && amount <= w.b);
      submit.textContent = t('Fund {amount}', { amount: bananas(amount) });
      box.querySelector('.fund-note').textContent = note(amount);
      return amount;
    };
    button.addEventListener('click', () => {
      const opening = box.hidden;
      box.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (!opening || box.dataset.ready) { if (opening) box.querySelector('input')?.focus(); return; }
      if (!me) { box.innerHTML = String(html`<p class="small muted">${t('Sign in with osu! to fund a bounty.')}</p>${signInButton()}`); return; }
      if (!w) { box.innerHTML = String(html`<p class="small muted">${t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`); return; }
      const start = Math.min(50, Math.max(RULES.minFund, w.b));
      box.innerHTML = String(html`<form class="fund-row" novalidate>
        <div class="field"><label for="fund-${id}">${t('Add to the pot')}</label>
          <input class="input" id="fund-${id}" type="number" inputmode="numeric" min="${RULES.minFund}" step="5" value="${start}"></div>
        <button class="btn btn-small btn-primary" type="submit"></button>
        <p class="small muted fund-note" aria-live="polite"></p>
      </form>`);
      box.dataset.ready = '1';
      update();
      box.addEventListener('input', update);
      box.addEventListener('submit', async e => {
        e.preventDefault();
        const amount = update();
        if (amount >= RULES.minFund && amount <= w.b && await sendRequest('bounty.fund', { bountyId: id, amount })) {
          box.hidden = true;
          button.setAttribute('aria-expanded', 'false');
        }
      });
      box.querySelector('input').focus();
    });
  });
}

// ---- Completion ------------------------------------------------------------------------------------------------------
// completion.json (tools/lib/completion.mjs): how many ranked catch-specific maps Portugal has cleared, and the rest as a
// to-do list. Rows of `left`: [mapId, setId, version, stars, rankedDay, osu! plays, length]; `sets`: { setId: [artist,
// title] }. Length (drain seconds) is newer than the rest: data from before it has none, and then the length sorts hide.

const byPlays = (a, b) => b[5] - a[5] || a[0] - b[0];
/** Shortest (1) or longest (-1) first; maps without a length go last either way, ties keep the default order. */
const byLength = dir => (a, b) => !a[6] - !b[6] || dir * ((a[6] ?? 0) - (b[6] ?? 0)) || byPlays(a, b);
/** key: [label, compare, needs lengths] */
const LEFT_SORTS = {
  popular: [t('Most played on osu!'), byPlays],
  easy: [t('Fewest stars'), (a, b) => a[3] - b[3] || a[0] - b[0]],
  hard: [t('Most stars'), (a, b) => b[3] - a[3] || a[0] - b[0]],
  new: [t('Newest ranked'), (a, b) => (b[4] ?? 0) - (a[4] ?? 0) || b[0] - a[0]],
  short: [t('Shortest first'), byLength(1), true],
  long: [t('Longest first'), byLength(-1), true],
};
const LEFT_PAGE = 50;
const percent = (n, total) => (total ? (n / total) * 100 : 0);

function leftRow([id, set, version, stars, rankedDay, plays, length], sets) {
  const named = sets[set];
  const title = named ? `${named[0]} - ${named[1]}` : t('Map #{id}', { id });
  return html`<a class="row card-link" href="#/map/${id}">
    <span class="map">
      ${setCover(set)}
      <span class="map-text">
        <span class="map-title" title="${title}">${title}</span>
        <span class="map-sub">${starsBadge(stars)} [${version}]</span>
      </span>
    </span>
    <span class="row-meta">
      ${length ? html`<span>${fmt.duration(length)}</span><span class="sep"></span>` : ''}
      ${rankedDay ? html`<span>${t('Ranked {date}', { date: fmt.monthYear(rankedDay * 86400) })}</span><span class="sep"></span>` : ''}
      <span>${t('{plays} on osu!', { plays: fmt.plural(plays, 'play') })}</span>
    </span>
  </a>`;
}

function renderCompletion(panel, goal, index, query) {
  if (!goal) {
    panel.innerHTML = String(empty(t('The completion goal arrives with the next data update.')));
    return;
  }
  const pct = percent(goal.cleared, goal.total);
  const conv = goal.converts;
  let stars = parseStars(query);
  const timed = goal.left.some(r => r[6]);
  const sorts = Object.entries(LEFT_SORTS).filter(([, [, , needsLength]]) => timed || !needsLength);
  let sortKey = sorts.some(([k]) => k === query.sort) ? query.sort : 'popular';
  let page = Math.max(0, (Number(query.page) || 1) - 1);

  panel.innerHTML = String(html`
    <section class="goal">
      <p class="goal-figure">${fmt.num(pct, 1)}%</p>
      <p class="goal-of">${goal.players
        ? th('{cleared} of {total} ranked osu!catch maps cleared, by {players}', { cleared: html`<b>${fmt.num(goal.cleared)}</b>`, total: html`<b>${fmt.num(goal.total)}</b>`, players: fmt.plural(goal.players, 'player') })
        : th('{cleared} of {total} ranked osu!catch maps cleared', { cleared: html`<b>${fmt.num(goal.cleared)}</b>`, total: html`<b>${fmt.num(goal.total)}</b>` })}</p>
      <div class="goal-bar" role="meter" aria-label="${t('Ranked osu!catch maps cleared')}" aria-valuemin="0" aria-valuemax="${goal.total}"
        aria-valuenow="${goal.cleared}" aria-valuetext="${t('{pct}% cleared', { pct: fmt.num(pct, 1) })}" style="--done:${pct.toFixed(2)}%"><span></span></div>
      ${conv?.total ? html`<p class="goal-aside">${t('Converts, the long road: {cleared} of {total} ranked osu!standard maps ({pct}%).', { cleared: fmt.num(conv.cleared), total: fmt.num(conv.total), pct: fmt.num(percent(conv.cleared, conv.total), 1) })}</p>` : ''}
    </section>

    ${goal.recent.length || goal.sole.length ? html`<section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('Recently cleared')}</h2></div>
        <p class="muted small">${t('The newest first clears: the earliest pass on record for each map.')}</p>
        ${goal.recent.length ? html`<div class="rows">${goal.recent.map(([id, uid, t]) => html`<div class="row">
          ${mapLink(id, goal.maps[id])}
          <div class="row-meta">${playerLink(uid, index, 'avatar-sm')} <span class="faint">${fmt.ago(t)}</span></div>
        </div>`)}</div>` : empty(t('No dated clears yet.'))}
      </div>
      <div>
        <div class="section-head"><h2>${t('Only they have cleared')}</h2></div>
        <p class="muted small">${t('Ranked maps no other Portuguese player has passed.')}</p>
        ${goal.sole.length ? html`<div class="rows">${goal.sole.map(([uid, n], i) => html`<div class="row">
          <span class="goal-who"><span class="faint">${i + 1}</span> ${playerLink(uid, index, 'avatar-sm')}</span>
          <span class="row-meta">${fmt.plural(n, 'map')}</span>
        </div>`)}</div>` : empty(t('Every cleared map has at least two players on it.'))}
      </div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>${t('Not cleared yet')}</h2><span class="muted small">${t('Ranked maps no Portuguese player has passed.')}</span></div>
      ${goal.left.length ? html`
        <div class="toolbar">
          <select class="select" id="left-sort" aria-label="${t('Sort')}">${sorts.map(([k, [label]]) => html`<option value="${k}" ${k === sortKey ? raw('selected') : ''}>${label}</option>`)}</select>
        </div>
        ${starSlider(stars)}
        <p class="result-count" id="left-count"></p>
        <div id="left-list"></div>` : empty(t('Every ranked osu!catch map is cleared. Converts next?'))}
    </section>
  `);
  if (!goal.left.length) return;

  const sort = panel.querySelector('#left-sort');
  const count = panel.querySelector('#left-count');
  const visible = () => goal.left.filter(r => inStars(r[3], stars)).sort(LEFT_SORTS[sortKey][1]);
  const save = () => writeQuery({ sort: sortKey, stars: formatStars(stars), page: page + 1 }, { sort: 'popular', page: 1 });
  let items = visible();
  const showCount = speak => {
    count.textContent = resultCount(items.length, goal.left.length, 'map');
    if (speak) announce(count.textContent);
  };
  const redraw = paginate(panel.querySelector('#left-list'), items, slice => html`<div class="rows">${slice.map(r => leftRow(r, goal.sets))}</div>`, LEFT_PAGE, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => emptyFiltered(t('No uncleared maps at {stars}.', { stars: starsLabel(stars) })),
  });
  showCount(false);
  // A new sort or range starts again from the first page (paginate's redraw, which saves it).
  const refilter = () => {
    items = visible();
    redraw(items);
    showCount(true);
  };
  sort.addEventListener('change', () => { sortKey = sort.value; refilter(); });
  const slider = bindStarSlider(panel, stars, next => { stars = next; refilter(); });
  panel.querySelector('#left-list').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    stars = [...ANY_STARS];
    slider.set(stars);
    refilter();
  });
}
