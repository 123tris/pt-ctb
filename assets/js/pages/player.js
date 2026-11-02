import { html, raw } from '../core/html.js';
import { playerFile, playerHead, playerIndex, history, records, bounties } from '../core/data.js';
import {
  economy, session, bananas, RULES, ledgerList, signInButton, sendRequest, myRequests, requestList, pendingSpend, closeOnEscape, signInHere,
} from '../core/bananas.js';
import { S, CATS, PLAY_SOURCES, DAN_STAGES, DAN_MAPS, HILL_SLOTS, HILL_TIERS, danRole } from '../core/model.js';
import { danName } from '../core/events.js';
import { lineChart, chartHover } from '../core/charts.js';
import { playerBadges, era, signatureMap, localBadge, localEra } from '../core/badges.js';
import { THRONE_PLAYER } from '../core/lore.js';
import { jersey } from '../core/ladder.js';
import { SLOT_NAME, TIER_NAME, titleName, titleWhen, slotTally } from '../core/hill.js';
import { GOAL_LABEL } from '../core/bounty.js';
import {
  setTitle, tabs, avatar, stat, scoreRow, paginate, empty, mapText, prefs, osuUser, CAT_LABEL, SLUG_CAT,
  mapLink, scoreStats, catChip, writeQuery, announce, resultCount, emptyFiltered, isInactiveOnOsu, inactiveTag, officialPpNote,
  isLegend, legendTag, gradeBadge, chipGroup, setPressed, placeholderRows, mapLabel, nameClass, scoreUrl, osuMap,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

/** How many claimed bounties the trophies list by name before linking to the rest. */
const CLAIMS_SHOWN = 3;

/**
 * Trophies: what the player has won in the challenges. King of the hill's titles (gold once settled) and Bounty hunter
 * as chips, then their crowns by slot, the slots they hold this month and the bounties they claimed. Nothing for a
 * player with none of it. `crowns` is the profile's slice (players/{id}.json `crowns`, tools/lib/hill.mjs); `claims`
 * their claimed rows of bounties.json's hall, newest first, with its `maps`.
 */
function trophies(crowns, claims, maps) {
  const titles = crowns?.titles ?? [];
  const holding = [...(crowns?.holding ?? [])].sort((a, b) => HILL_SLOTS.indexOf(a[0]) - HILL_SLOTS.indexOf(b[0]) || HILL_TIERS.indexOf(a[1]) - HILL_TIERS.indexOf(b[1]));
  if (!crowns?.total && !holding.length && !claims.length) return '';
  return html`<section class="section card trophies">
    <h2 class="card-h">${t('Trophies')}</h2>
    ${titles.length || claims.length ? html`<ul class="trophy-chips" aria-label="${t('Titles')}">
      ${titles.map(title => html`<li class="badge ${title.final ? 'badge-gold' : ''}">${titleName(title)} <span class="trophy-when">· ${titleWhen(title)}</span></li>`)}
      ${claims.length ? html`<li class="badge badge-gold">${t('Bounty hunter')} <span class="trophy-when">· ${fmt.plural(claims.length, 'bounty', 'bounties')}</span></li>` : ''}
    </ul>` : ''}
    ${crowns?.total ? html`<p class="small muted">${t('{crowns} on King of the hill: {tally}', { crowns: fmt.plural(crowns.total, 'crown'), tally: slotTally(crowns.slots) })}</p>` : ''}
    ${holding.length ? html`<p class="small muted">${t('Holding this month: {slots}.', { slots: holding.map(([slot, tier]) => `${SLOT_NAME[slot]} (${TIER_NAME[tier]})`).join(', ') })}
      <a href="/challenges/hill">${t('See the pool')}</a></p>` : ''}
    ${claims.slice(0, CLAIMS_SHOWN).map(([id, , goal, , , at]) => html`<p class="small muted">${th('Bounty claimed: {goal} on {map}', {
      goal: GOAL_LABEL[goal], map: html`<a href="/map/${id}">${mapLabel(id, maps[id])}</a>`,
    })}${at ? html` <span class="faint">· ${fmt.date(at)}</span>` : ''}</p>`)}
    ${claims.length > CLAIMS_SHOWN ? html`<p class="small"><a href="/challenges/bounties">${t('{n} more in the hall of fame', { n: fmt.num(claims.length - CLAIMS_SHOWN) })}</a></p>` : ''}
  </section>`;
}

/**
 * The signature play the player pinned with bananas (players/{id}.json `pinned`: [category, ...play], tools/lib/build.mjs),
 * as one score row and a link to it on osu!. It takes the place of the automatic "Signature map".
 */
function pinnedPlay([cat, ...s], maps) {
  const url = scoreUrl(s) ?? osuMap(s[S.MAP]);
  return html`<section class="section card signature pinned-play">
    <h2 class="card-h">${t('Signature play')}</h2>
    <div class="rows">${scoreRow({ s, meta: maps[s[S.MAP]], pos: s[S.POS], cat })}</div>
    <p class="small m-0"><a href="${url}" target="_blank" rel="noopener">${scoreUrl(s) ? t('See the play on osu!') : t('See the map on osu!')}</a></p>
  </section>`;
}

/**
 * Bananas: the player's wallet (economy.json, tools/lib/economy.mjs) with its latest lines (the profile file's
 * `ledger`), or their pouch while they've never signed in. Their own profile, signed in, adds their requests and the
 * snipe shield; someone else's, a tip form with the shop's two steps. Nothing before the bot starts Bananas, or for a
 * player it has no wallet for.
 */
function bananaSection(p, w, ledger) {
  if (!w) return '';
  const me = session();
  const own = me?.id === p.id;
  // Signed out, it could be theirs: the way to collect. Signed in as someone else, it isn't.
  const mayBeThem = !me && signInHere();
  const head = html`<h2 class="card-h">${t('Bananas')} <a class="card-h-link" href="/glossary?at=bananas">${t('What are bananas?')}</a></h2>`;
  if (!w.s) {
    return html`<section class="section card bananas" id="bananas">${head}
      ${w.p > 0 ? html`
        <p class="pouch">${own ? th('Your {n} are on their way to your wallet', { n: html`<b>${bananas(w.p)}</b>` })
          : th('{n} waiting in {name}’s pouch', { n: html`<b>${bananas(w.p)}</b>`, name: p.name })}</p>
        <p class="small muted">${own
          ? t('You’ve signed in: the bot moves them into your wallet at its next update, within 15 minutes.')
          : t('Bananas earned before signing in on this site wait in a pouch. The first sign-in with osu! collects them. The pouch holds {cap} at most; anything past that is lost.', { cap: bananas(RULES.pouchCap) })}</p>
        ${mayBeThem ? html`<div class="btn-row">${signInButton(t('Is this you? Sign in to collect'))}</div>` : ''}`
        : html`<p class="small muted">${t('No bananas yet. They’re earned by playing: snipes, first FCs on hard maps, crowns, the daily game and more.')}</p>`}
      ${ledgerList(ledger)}
    </section>`;
  }
  const gateLeft = RULES.gate - w.e;
  return html`<section class="section card bananas" id="bananas">${head}
    <dl class="kv kv-strip">
      <div><dt>${t('Wallet')}</dt><dd>${bananas(w.b)}</dd></div>
      <div><dt>${t('Earned')}</dt><dd>${bananas(w.e)}</dd></div>
      ${w.x ? html`<div><dt>${t('In open bounties')}</dt><dd>${bananas(w.x)}</dd></div>` : ''}
    </dl>
    <p class="small muted">${gateLeft > 0
      ? t('{n} more earned to post a bounty (it takes {gate} earned; tips, refunds and the launch grant don’t count).', { n: fmt.num(gateLeft), gate: fmt.num(RULES.gate) })
      : t('Past the {gate} earned that posting a bounty takes.', { gate: fmt.num(RULES.gate) })}${w.sh ? ` ${t('Snipe shield on: snipe bounties can’t target them.')}` : ''}</p>
    ${ledgerList(ledger)}
    ${own ? html`<div class="wallet-own">
      <div class="btn-row">
        <a class="btn btn-small" href="/shop">${t('Shop')}</a>
        <a class="btn btn-small" href="/challenges/bounties">${t('Bounties')}</a>
        <button class="btn btn-small" type="button" id="shield" aria-pressed="${w.sh ? 'true' : 'false'}" aria-describedby="shield-note">${t('Snipe shield')}</button>
      </div>
      <p class="small faint" id="shield-note" aria-live="polite">${t('The shield keeps snipe bounties from targeting your #1s. Changing it goes through the bot.')}</p>
      <div id="my-requests"></div>
    </div>` : me ? html`<div class="tip-box" id="tip-box">
      <form class="tip-form" id="tip" novalidate>
        <div class="field"><label for="tip-amount">${t('Tip {name}', { name: p.name })}</label>
          <input class="input" id="tip-amount" type="number" inputmode="numeric" min="${RULES.tipMin}" max="${RULES.tipMax}" step="1" value="10"></div>
        <div class="field"><label for="tip-reason">${t('Why (optional)')}</label>
          <input class="input" id="tip-reason" maxlength="80" placeholder="${t('that FC, the crown…')}"></div>
        <button class="btn btn-small" type="submit">${t('Tip…')}</button>
        <p class="small muted tip-note" aria-live="polite"></p>
        <p class="small faint">${t('{min} to {max} a day. A tip goes from your wallet to theirs; it doesn’t count towards their 1,000 earned.', { min: fmt.num(RULES.tipMin), max: bananas(RULES.tipMax) })}</p>
      </form>
    </div>` : ''}
  </section>`;
}

/**
 * Wires the wallet: the shield toggle (waiting for the bot while a change is pending), the player's requests (fetched
 * now and after each new one) and the tip form (amount, then a confirmation with the wallet before and after).
 */
function wireBananas(root, p, index, query, isCurrent, eco, maps) {
  const me = session();
  const myWallet = me ? eco?.players?.[me.id] : null;
  let requests = [];
  const free = () => (myWallet ? myWallet.b - pendingSpend(requests) : 0);

  const shield = root.querySelector('#shield');
  const shieldNote = root.querySelector('#shield-note');
  const showShield = () => {
    if (!shield) return;
    const pending = requests.find(r => r.type === 'shield' && r.status === 'pending');
    shield.disabled = Boolean(pending);
    if (pending) shieldNote.textContent = pending.payload.on ? t('Turning the shield on: waiting for the bot.') : t('Turning the shield off: waiting for the bot.');
  };
  shield?.addEventListener('click', async () => {
    shield.disabled = true;
    const on = shield.getAttribute('aria-pressed') !== 'true';
    const sent = await sendRequest('shield', { on });
    if (sent.ok) requests = [{ type: 'shield', status: 'pending', payload: { on }, t: new Date().toISOString() }, ...requests];
    else { shield.disabled = false; shieldNote.textContent = sent.message; }
    showShield();
  });

  const box = root.querySelector('#my-requests');
  const draw = async () => {
    if (!isCurrent()) { window.removeEventListener('ptctb:requests', draw); return; }
    const list = me ? await myRequests() : null;
    if (!isCurrent() || !list) return;
    requests = list;
    showShield();
    if (box) box.innerHTML = String(list.length ? html`<h3 class="small-h">${t('Your requests')}</h3>${requestList(list, index, { maps })}` : '');
    if (tipBox?.querySelector('.tip-note')) tipNote();
  };
  if (me) { draw(); window.addEventListener('ptctb:requests', draw); }

  const tipBox = root.querySelector('#tip-box');
  if (!tipBox) return;
  const form = () => tipBox.querySelector('#tip');
  const amountOf = () => Math.round(Number(tipBox.querySelector('#tip-amount')?.value) || 0);
  const tipNote = () => {
    const amount = amountOf();
    const ok = amount >= RULES.tipMin && amount <= RULES.tipMax && amount <= free();
    tipBox.querySelector('[type=submit]').disabled = !ok;
    tipBox.querySelector('.tip-note').textContent = !myWallet ? t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')
      : amount < RULES.tipMin || amount > RULES.tipMax ? t('A tip is {min} to {max}.', { min: fmt.num(RULES.tipMin), max: fmt.num(RULES.tipMax) })
        : amount > free() ? t('Your wallet has {balance} free.', { balance: bananas(free()) })
          : t('Your wallet: {balance}, then {after}.', { balance: bananas(free()), after: bananas(free() - amount) });
  };
  const pickHtml = tipBox.innerHTML;
  const backToPick = (amount, reason) => {
    tipBox.innerHTML = pickHtml;
    tipBox.querySelector('#tip-amount').value = String(amount);
    tipBox.querySelector('#tip-reason').value = reason ?? '';
    tipNote();
    tipBox.querySelector('#tip-amount').focus();
  };
  tipNote();
  if (query.tip) tipBox.querySelector('#tip-amount').focus();
  tipBox.addEventListener('input', tipNote);
  tipBox.addEventListener('submit', e => {
    e.preventDefault();
    const amount = amountOf();
    if (form().querySelector('[type=submit]').disabled) return;
    const reason = tipBox.querySelector('#tip-reason').value.trim() || null;
    tipBox.innerHTML = String(html`<div class="tip-confirm">
      <p>${th('Tip {name} {amount}?', { name: html`<b>${p.name}</b>`, amount: html`<b>${bananas(amount)}</b>` })}${reason ? html` <span class="muted">“${reason}”</span>` : ''}</p>
      <p class="small muted">${t('Your wallet goes from {balance} to {after}.', { balance: bananas(free()), after: bananas(free() - amount) })}</p>
      <div class="btn-row">
        <button class="btn btn-small btn-primary" type="button" data-confirm>${t('Confirm')}</button>
        <button class="btn btn-small" type="button" data-cancel>${t('Cancel')}</button>
      </div>
      <p class="small tip-error" aria-live="polite"></p>
    </div>`);
    tipBox.dataset.amount = String(amount);
    tipBox.dataset.reason = reason ?? '';
    tipBox.querySelector('[data-confirm]').focus();
  });
  tipBox.addEventListener('click', async e => {
    if (e.target.closest('[data-cancel]')) { backToPick(tipBox.dataset.amount, tipBox.dataset.reason); return; }
    const go = e.target.closest('[data-confirm]');
    if (!go || go.disabled) return;
    go.disabled = true;
    const amount = Number(tipBox.dataset.amount);
    const sent = await sendRequest('tip', { to: p.id, amount, reason: tipBox.dataset.reason || null });
    if (sent.ok) {
      requests = [{ type: 'tip', status: 'pending', payload: { to: p.id, amount }, t: new Date().toISOString() }, ...requests];
      backToPick(10, '');
    } else {
      go.disabled = false;
      tipBox.querySelector('.tip-error').textContent = sent.message;
    }
  });
  closeOnEscape(tipBox, () => { if (tipBox.querySelector('[data-cancel]')) backToPick(tipBox.dataset.amount, tipBox.dataset.reason); });
}

const SORTS = {
  pp: [t('Most pp'), (a, b) => b[S.PP] - a[S.PP]],
  recent: [t('Most recent'), (a, b) => b[S.TIME] - a[S.TIME]],
  pos: [t('Best position in PT'), (a, b) => (a[S.POS] || 1e9) - (b[S.POS] || 1e9) || b[S.PP] - a[S.PP]],
  acc: [t('Best accuracy'), (a, b) => b[S.ACC] - a[S.ACC]],
  combo: [t('Highest combo'), (a, b) => b[S.COMBO] - a[S.COMBO]],
};

/** Rows per list in a head file (HEAD_ROWS in tools/lib/build.mjs): one page of the list. */
const HEAD_ROWS = 50;

/** Each play's category, for the lists that mix them (a score tuple doesn't carry its own). */
const playCat = new WeakMap();

/**
 * The plays of several categories in one list. A head file has only each category's first page, so there it's the
 * first page of them together: the 50 with most pp of those first pages, which are the whole list's 50 too.
 */
function mixedPlays(f, cats) {
  const list = cats.flatMap(cat => f.scores[cat].map(s => { playCat.set(s, cat); return s; }));
  const whole = !f.head || list.length >= cats.reduce((n, cat) => n + f.counts[cat], 0);
  return whole ? list : list.sort(SORTS.pp[1]).slice(0, HEAD_ROWS);
}

/** The score lists. `cats` marks one that mixes categories, whose rows say which each play is. */
const TAB_LIST = [
  { slug: 'all', label: t('All|plays'), cats: CATS },
  { slug: 'converts', label: t('Converts'), list: f => f.scores.c },
  { slug: 'loved', label: t('Loved'), list: f => f.scores.u },
  // Ranked is what osu! gives pp for: ranked catch-specific maps and converts (every convert here is of a ranked map).
  { slug: 'ranked', label: t('Ranked'), cats: PLAY_SOURCES.r },
  { slug: 'dan', label: 'Dan', list: f => f.dan },
  { slug: 'pre', label: t('Pre-rank'), list: f => f.pre || [] },
];

/**
 * A pp tile that leads with the rank: the rank big ("#5 PT") and the pp under it, before `sub` if there is one. With
 * no rank (unranked, or no official rank) the pp stays the big figure and `noRank` says why. The rank links to its
 * leaderboard (`board`, a slug of rankings.js), which scrolls to and marks this player's row (`at`).
 */
function rankStat(label, rank, where, pp, { sub = '', noRank, cls, board, id }) {
  const ppText = `${fmt.pp(pp)} pp`;
  const boardName = t('{board} leaderboard', { board: board === 'ranked' ? t('Ranked') : label }); // as the Leaderboards page names it
  return rank
    ? stat(label, html`<a class="stat-link" href="/rankings/${board}?at=${id}" aria-label="${boardName}, ${fmt.rank(rank)} ${where}" title="${t('See the {board}', { board: boardName })}">${fmt.rank(rank)} <span class="stat-unit">${where}</span></a>`, sub ? html`<span class="keep">${ppText}</span> · <span class="keep">${sub}</span>` : ppText, cls)
    : stat(label, ppText, noRank, cls);
}

/** Two arrows facing each other: "compare". */
const COMPARE_ICON = raw('<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5h10M9 2l3 3-3 3M14 11H4M7 8l-3 3 3 3"/></svg>');

/**
 * The in-joke badges, folded into one small "6 badges" button beside the others: hovering or keyboard focus opens a
 * card with each badge and what earned it; on touch a tap toggles it (wired up in the page, with Escape and an
 * outside click to close).
 */
const badgePeek = badges => html`<span class="peek">
  <button type="button" class="peek-btn" aria-expanded="false" aria-controls="badge-pop">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>
    ${fmt.plural(badges.length, 'badge')}
  </button>
  <span class="peek-pop" id="badge-pop" role="group" aria-label="${t('Badges')}">
    <ul class="badge-list">${badges.map(b => html`<li><b>${b.name}</b><span>${b.tip}</span></li>`)}</ul>
  </span>
</span>`;

function danGrid(file) {
  const passes = new Map(file.dan.map(([i, s]) => [i, s]));
  return html`<div class="dan-ladder">${DAN_STAGES.map(stage => {
    const s = passes.get(stage.index);
    return html`<a class="dan-stage ${stage.index > 10 ? 'hebrew' : ''} ${s ? '' : 'locked'}" href="/map/${DAN_MAPS[stage.index]}">
      <span class="points">${stage.points} pts</span>
      <div class="dan-glyph">${stage.glyph}</div>
      <b>${danName(stage.index)}</b>
      <div class="small ${s ? 'dan-pass' : 'faint'}">${s ? `${fmt.acc(s[S.ACC])} · ${fmt.date(s[S.TIME])}` : t('Needs {acc}', { acc: `${fmt.num(stage.passAcc)}%` })}</div>
    </a>`;
  })}</div>`;
}

const HISTORY_LINES = [[t('Converts'), 'var(--cat-c)', 1], [t('Loved'), 'var(--cat-u)', 2], [t('Official'), 'var(--cat-r)', 3]];
const REBUILT_TIP = t('Rebuilt month by month from the dates of this player’s stored scores. Only their best play on each map is kept, and past totals use today’s pp values, so the real numbers back then were different.');

/** The ranges the chart offers: everything, the last 12 months, or only the days the site recorded itself. */
function historyRanges(recorded, rebuilt) {
  const all = [...rebuilt, ...recorded];
  if (all.length < 2) return [];
  const end = all[all.length - 1][0];
  const ranges = [['all', t('All|time'), -Infinity]];
  if (end - all[0][0] > 400 * 86400) ranges.push(['year', t('Last 12 months'), end - 365 * 86400]);
  if (rebuilt.length && recorded.length >= 2) ranges.push(['tracked', t('Since tracking'), recorded[0][0]]);
  return ranges;
}

/** Only the points from `from` on, starting with the value the line had at `from` (so it begins at the left edge). */
function clipFrom(points, from) {
  const before = points.filter(p => p[0] < from).at(-1);
  const rest = points.filter(p => p[0] >= from);
  return before ? [[from, before[1]], ...rest] : rest;
}

/**
 * `recorded` = [[time, convertPp, lovedPp, officialPp]], one per day something changed since the site started
 * tracking; `rebuilt` = the same, monthly, rebuilt from score dates for the time before. Any value can be null (no
 * official pp for an inactive player): those points are skipped, never drawn as 0. Each rebuilt line is dashed and
 * holds its last value until its solid line starts (or to the last recorded day if it never does); the two may not
 * join exactly.
 */
function historyLines(recorded, rebuilt, from) {
  const lastDay = recorded[recorded.length - 1]?.[0];
  return HISTORY_LINES.map(([label, color, k]) => {
    const pick = list => list.filter(p => p[k] != null).map(p => [p[0], p[k]]);
    const solid = pick(recorded);
    const dashed = pick(rebuilt);
    const until = solid[0]?.[0] ?? lastDay;
    if (dashed.length && until > dashed[dashed.length - 1][0]) dashed.push([until, dashed[dashed.length - 1][1]]);
    const clipped = clipFrom(dashed, from);
    // A dashed line needs some length: from where its solid line starts, all that's left of it is that one point.
    return { label, color, dashed: clipped.length > 1 && clipped[clipped.length - 1][0] > clipped[0][0] ? clipped : [], solid: clipFrom(solid, from) };
  });
}

function historyChart(lines) {
  const shown = lines.flatMap(l => [...l.dashed, ...l.solid]);
  if (shown.length < 2) return html`<p class="muted small">${t('Not enough points in this range.')}</p>`;
  const span = shown.map(p => p[0]);
  const summary = t('pp over time, {from} to {to}: {lines}.', {
    from: fmt.date(Math.min(...span)),
    to: fmt.date(Math.max(...span)),
    lines: lines.map(l => [...l.dashed, ...l.solid])
      .map((pts, i) => pts.length && t('{line} {from} to {to}', { line: HISTORY_LINES[i][0], from: fmt.num(pts[0][1]), to: fmt.num(pts[pts.length - 1][1]) }))
      .filter(Boolean).join(', '),
  });
  const anyDashed = lines.some(l => l.dashed.length);
  return html`${lineChart(lines.flatMap(l => [
    { label: t('{line} (reconstructed)', { line: l.label }), color: l.color, points: l.dashed, dashed: true, step: true },
    { label: l.label, color: l.color, points: l.solid },
  ]), { format: v => fmt.num(v), label: anyDashed ? `${summary} ${t('Dashed parts are reconstructed from score dates and approximate.')}` : summary })}
    <div class="legend">${lines.filter(l => l.dashed.length || l.solid.length).map(l => html`<span><i style="background:${l.color}"></i>${l.label}</span>`)}
      ${anyDashed ? html`<span class="legend-dashed" title="${REBUILT_TIP}"><i aria-hidden="true"></i>${t('dashed = reconstructed from score dates (approximate)')}<span class="sr-only">. ${REBUILT_TIP}</span></span>` : ''}</div>`;
}

/** The value a line has at `t`: its last point at or before `t`. */
const valueAt = (points, t) => {
  let value = null;
  for (const p of points) { if (p[0] > t) break; value = p[1]; }
  return value;
};

/**
 * What the hover readout steps through: every time any line has a point, with each line's value then (from the solid
 * line once it has started, otherwise the dashed one, marked approximate). Rows where everything is approximate are
 * monthly reconstructions, so they're dated by month.
 */
function historyRows(lines) {
  const times = [...new Set(lines.flatMap(l => [...l.dashed, ...l.solid].map(p => p[0])))].sort((a, b) => a - b);
  return times.map(t => {
    const items = lines.map(l => {
      const exact = l.solid.length && t >= l.solid[0][0];
      return { name: l.label, color: l.color, value: valueAt(exact ? l.solid : l.dashed, t), approx: !exact };
    }).filter(item => item.value != null);
    return { t, title: items.every(item => item.approx) ? fmt.monthYear(t) : fmt.date(t), items };
  }).filter(row => row.items.length);
}

/** Collapsed by default (the choice is remembered); the chart is only drawn once it's opened. */
function historySection(recorded, rebuilt) {
  const ranges = historyRanges(recorded, rebuilt);
  if (!ranges.length) return '';
  return html`<details class="section card history" id="history" ${prefs.get('ppchart', false) ? raw('open') : ''}>
    <summary><h2 class="card-h">${t('pp over time')}</h2><span class="history-toggle" aria-hidden="true"></span></summary>
    <div class="history-body">
      ${ranges.length > 1 ? chipGroup(t('Range'), 'range', ranges, 'all') : ''}
      <div class="chart-wrap" id="history-chart"></div>
    </div>
  </details>`;
}

/**
 * Whether a link to a list needs the whole player file: the small head file shows only the first page in the default
 * order, not a search, sort, filter or later page.
 */
const needsAll = query => Boolean(query.q || query.firsts || (query.sort && query.sort !== 'pp') || Number(query.page) > 1);

/** The last full player file this page loaded, so switching tabs on that profile doesn't go back to the head file. */
let lastFull = null;

/**
 * The profile on the page: { id, p, counts, file, section }. Switching between its score lists only redraws them
 * (app.js keeps the page in place for it), so the page doesn't jump back to the top or flash.
 */
let onScreen = null;

export default async function player(root, { params, query, isCurrent }) {
  const id = Number(params.id);
  if (onScreen?.id === id && root.contains(onScreen.section)) {
    showPlays(onScreen, params.tab, query, isCurrent);
    return;
  }
  // The small head file shows the first page in the default order. A link straight to a search, sort, filter or later
  // page needs the whole file, as does data from before head files (playerHead gives null).
  const loaded = lastFull?.id === id ? lastFull : null;
  const head = needsAll(query) || loaded ? null : playerHead(id);
  const filePromise = loaded ? Promise.resolve(loaded) : head ? head.then(h => h ?? playerFile(id)) : playerFile(id);
  // Records only feed the badges, which a head file brings already worked out.
  const recsPromise = (head ?? Promise.resolve(null)).then(h => (h ? null : records().catch(() => null)));
  // bounties.json is small and cached: the trophies list the bounties this player claimed.
  // economy.json (Bananas) is small and cached too: the wallet or pouch.
  let [file, index, hist, recs, board, eco] = await Promise.all([
    filePromise, playerIndex(), history(), recsPromise, bounties().catch(() => null), economy().catch(() => null),
  ]);
  if (!isCurrent()) return;
  if (!file.head) lastFull = file;
  const p = index.get(id);
  const wallet = eco?.players?.[id] ?? null;
  setTitle(p.name);
  const extras = file.extras;
  const badges = (extras ? extras.badges : playerBadges(p, file, recs)).map(localBadge);
  const playerEra = localEra(extras ? extras.era : era(p, file));
  const signature = extras ? extras.signature : signatureMap(file);

  const counts = file.counts ? { ...file.counts } : {
    c: file.scores.c.length, u: file.scores.u.length, r: file.scores.r.length, dan: file.dan.length, pre: file.pre?.length ?? 0,
  };
  Object.assign(counts, { converts: counts.c, loved: counts.u });
  for (const item of TAB_LIST) if (item.cats) counts[item.slug] = item.cats.reduce((n, cat) => n + counts[cat], 0);
  const role = danRole(p.danScore);
  const firsts = p.firsts.c + p.firsts.u + p.firsts.r;
  const dayTime = d => Date.parse(`${d}T12:00:00Z`) / 1000;
  const points = (hist.series[id] || []).map(([d, cv, ul, pp]) => [dayTime(hist.days[d]), cv, ul, pp]);
  // Monthly points rebuilt from score dates (history.json `reconstructed`, as of 00:00 UTC), only for the time before
  // the site's own records begin. Older data has no `reconstructed`.
  const rebuiltDays = hist.reconstructed?.days ?? [];
  const rebuilt = (hist.reconstructed?.series?.[id] ?? [])
    .map(([d, cv, ul, pp]) => [Date.parse(`${rebuiltDays[d]}T00:00:00Z`) / 1000, cv, ul, pp])
    .filter(p => Number.isFinite(p[0]) && (!points.length || p[0] < points[0][0]));

  root.innerHTML = String(html`
    <header class="profile-head">
      <a class="avatar-link" href="${osuUser(id)}" target="_blank" rel="noopener" aria-label="${t('{name} on osu!', { name: p.name })}" title="${t('{name} on osu!', { name: p.name })}">${avatar(id, 'avatar-lg')}</a>
      <div class="profile-info">
        <h1><a class="title-link ${nameClass(p)}" href="${osuUser(id)}" target="_blank" rel="noopener" title="${t('{name} on osu!', { name: p.name })}">${p.name}</a>${isLegend(p) ? legendTag() : ''}</h1>
        <p class="profile-line">${[
          role && html`<span class="profile-role">${role}</span>`,
          firsts && tn(firsts, '{n} #1 in Portugal', '{n} #1s in Portugal'),
          p.last && t('last played {ago}', { ago: fmt.ago(p.last) }),
          playerEra && t('era: {era}', { era: playerEra }),
          wallet?.t && html`<span class="profile-title">${wallet.t}</span>`,
          // Bananas waiting in the pouch and nobody signed in here: if it's theirs, the way to collect them, up top.
          wallet && !wallet.s && wallet.p > 0 && !session() && signInHere()
            && html`<button class="link-button" type="button" data-signin>${t('Is this you? Sign in to collect {n}', { n: bananas(wallet.p) })}</button>`,
        ].filter(Boolean).map((part, i) => html`${i ? html`<span class="sep-dot" aria-hidden="true"> · </span>` : ''}${part}`)}</p>
        <div class="links">
          <a class="btn btn-small btn-icon" href="/compare/${id}" aria-label="${t('Compare {name} with another player', { name: p.name })}" title="${t('Compare with another player')}">${COMPARE_ICON}</a>
          ${badges.length ? badgePeek(badges) : ''}
        </div>
      </div>
      ${jersey(p)}
    </header>

    <div class="stats">
      ${rankStat(t('Converts'), p.rank.c, 'PT', p.cv, { noRank: t('Unranked'), cls: 'stat-c', board: 'converts', id })}
      ${rankStat(t('Loved & Unranked'), p.rank.u, 'PT', p.ul, { noRank: t('Unranked'), cls: 'stat-u', board: 'loved', id })}
      ${!isInactiveOnOsu(p)
        // osu!'s own country rank leads, like the two tiles before it; the global rank goes under the pp.
        ? p.country
          ? rankStat(t('Official pp'), p.country, 'PT', p.pp, { sub: p.global ? `${fmt.rank(p.global)} global` : '', cls: 'stat-r', board: 'ranked', id })
          : rankStat(t('Official pp'), p.global, 'global', p.pp, { noRank: t('No official rank'), cls: 'stat-r', board: 'ranked', id })
        : p.pp > 0
          ? stat(t('Official pp'), p.ppSource === 'estimated'
            // "(estimated)" is only for screen readers here: the subtitle already says it, and the value stays one line.
            ? html`<span title="${t('Estimated from their stored plays, so probably a little low')}"><span aria-hidden="true">≈ </span>${fmt.pp(p.pp)} pp</span><span class="sr-only"> (${t('estimated')})</span>`
            : html`${fmt.pp(p.pp)} pp`,
            html`${inactiveTag(p)} ${officialPpNote(p)}`, 'stat-r')
          // Inactive with nothing to go on (no last-known value, no plays to estimate from).
          : stat(t('Official pp'), '—', html`${inactiveTag(p)} ${t('no official pp known')}`, 'stat-r')}
      ${stat(t('Accuracy'), fmt.acc(p.acc), t('Level {level}', { level: fmt.num(p.level, 0) }))}
      ${stat(t('Play count'), fmt.num(p.plays), html`<span class="grade-counts">${['X', 'S', 'A'].map((g, i) => html`<span>${gradeBadge(g)}${fmt.num(p.grades[i])}</span>`)}</span>`)}
      ${stat(t('Dan points'), fmt.num(p.danScore), t('{done} of {total} stages', { done: fmt.num(p.dan.length), total: fmt.num(DAN_STAGES.length) }))}    </div>

    ${id === THRONE_PLAYER ? html`<p class="mt-4 notice">${th('Every #1 on this profile is up for grabs. {link}', { link: html`<a href="/records?at=throne">${t('Dethrone Tris')}</a>` })}</p>` : ''}

    ${file.pinned ? pinnedPlay(file.pinned, file.maps) : signature ? html`<section class="section card signature">
      <h2 class="card-h">${t('Signature map')} <span class="faint">· ${t(signature.kind)}</span></h2>
      ${mapLink(signature.s[S.MAP], signature.meta)}
      <div class="mt-2 score-line">${catChip(signature.cat)} ${scoreStats(signature.s)} <span>${fmt.pp(signature.s[S.PP])} pp</span> <span class="faint">${fmt.date(signature.s[S.TIME])}</span></div>
    </section>` : ''}

    ${trophies(file.crowns, (board?.hall ?? []).filter(r => r[4] === id && r[3] === 'claimed'), board?.maps ?? {})}

    ${bananaSection(p, wallet, file.ledger)}

    ${historySection(points, rebuilt)}

    <section class="section" id="plays">
      <h2 class="sr-only">${t('Plays')}</h2>
      <div id="play-tabs"></div>
      <div id="play-list"></div>
    </section>
  `);

  onScreen = { id, p, counts, file, section: root.querySelector('#plays') };
  showPlays(onScreen, params.tab, query, isCurrent);

  wireBananas(root, p, index, query, isCurrent, eco, board?.maps);

  // The pp chart: drawn when its section is first opened, redrawn (chart only) when the range changes.
  const ranges = historyRanges(points, rebuilt);
  const historyEl = root.querySelector('#history');
  let range = ranges[0], drawn = false;
  const drawHistory = () => {
    drawn = true;
    const lines = historyLines(points, rebuilt, range[2]);
    const wrap = root.querySelector('#history-chart');
    wrap.innerHTML = String(historyChart(lines));
    chartHover(wrap, historyRows(lines), { onKey: announce });
  };
  historyEl?.addEventListener('toggle', () => {
    prefs.set('ppchart', historyEl.open);
    if (historyEl.open && !drawn) drawHistory();
  });
  if (historyEl?.open) drawHistory();
  historyEl?.querySelector('.chips')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-range]');
    const picked = chip && ranges.find(r => r[0] === chip.dataset.range);
    if (!picked) return;
    range = picked;
    setPressed(historyEl, 'range', range[0]);
    drawHistory();
  });

  // The badges card opens on hover (site.css, pointers only); a click or tap opens it until a second click, Escape or a
  // click anywhere else.
  const peek = root.querySelector('.peek');
  if (peek) {
    const peekButton = peek.querySelector('.peek-btn');
    const setOpen = open => {
      peek.classList.toggle('open', open);
      peekButton.setAttribute('aria-expanded', String(open));
    };
    peekButton.addEventListener('click', () => setOpen(!peek.classList.contains('open')));
    const outside = e => {
      if (!peek.isConnected) document.removeEventListener('click', outside);
      else if (!peek.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', outside);
    peek.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      peek.classList.add('shut');
      peekButton.focus();
    });
    peek.addEventListener('mouseleave', () => peek.classList.remove('shut'));
  }
}

/**
 * The score lists of the profile on screen (`view`, see onScreen): marks the open tab and draws its list. A switch to
 * another list runs only this, so the tab that was clicked keeps focus and the page stays where it was scrolled.
 */
function showPlays(view, slug, query, isCurrent) {
  const { id, p, counts, section } = view;
  const tab = TAB_LIST.find(item => item.slug === slug) ?? TAB_LIST.find(item => !['dan', 'pre'].includes(item.slug) && counts[item.slug]) ?? TAB_LIST[0];
  const href = `/player/${id}/${tab.slug}`;
  const links = [...section.querySelectorAll('.tabs a')];
  if (links.some(a => a.getAttribute('href') === href)) {
    links.forEach(a => {
      const on = a.getAttribute('href') === href;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  } else {
    // Only lists with something in them get a tab (so they fit on a phone), plus whichever one is open.
    const shownTabs = TAB_LIST.filter(item => counts[item.slug] || item === tab);
    section.querySelector('#play-tabs').innerHTML = String(tabs(shownTabs.map(item => ({
      href: `/player/${id}/${item.slug}`, label: item.label, count: counts[item.slug], active: item === tab,
    })), t('Score lists')));
  }

  const body = section.querySelector('#play-list');
  if (tab.slug === 'dan') {
    body.innerHTML = String(danGrid(view.file));
    return;
  }
  body.innerHTML = String(html`
    ${tab.slug === 'pre' ? html`<p class="muted small">${t('Plays set before their map was ranked. They’re kept for the record but count toward nothing: no pp, no leaderboard spot.')}</p>` : ''}
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="${t('Search maps…')}" aria-label="${t('Search these plays')}" value="${query.q || ''}">
      <select class="select" id="sort" aria-label="${t('Sort')}">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}" ${k === query.sort ? raw('selected') : ''}>${label}</option>`)}</select>
      ${tab.slug !== 'pre' ? html`<span class="checks"><label><input type="checkbox" id="firsts" ${query.firsts ? raw('checked') : ''}> ${t('Only #1s')}</label></span>` : ''}
    </div>
    <p class="result-count" id="count"></p>
    <div id="scores"></div>`);

  const cat = SLUG_CAT[tab.slug] ?? null;
  const listOf = f => (tab.cats ? mixedPlays(f, tab.cats) : tab.list(f));
  let all = listOf(view.file);
  const total = counts[tab.slug];
  // A head file holds this list's first page only (in the default order). Until the whole file is in, `items` is that
  // page padded with nulls to the list's real length, so the pager and the count are right from the start.
  let partial = all.length < total;
  if (!total) {
    const none = {
      pre: t('{name} has no plays from before their map was ranked yet.', { name: p.name }),
      all: t('{name} has no plays yet.', { name: p.name }),
    }[tab.slug] ?? t('{name} has no plays in {category} yet.', { name: p.name, category: CAT_LABEL[cat] });
    body.querySelector('#scores').innerHTML = String(empty(none));
    return;
  }
  const q = body.querySelector('#q');
  const sort = body.querySelector('#sort');
  const onlyFirsts = body.querySelector('#firsts');
  const label = s => {
    const { title, sub } = mapText(s[S.MAP], view.file.maps[s[S.MAP]]);
    return `${title} ${sub}`.toLowerCase();
  };
  // The lowercase labels are built once per list, on the first search, not again on every keystroke.
  let labels = null;
  const visible = () => {
    if (partial) return [...all, ...new Array(total - all.length).fill(null)];
    const text = q.value.trim().toLowerCase();
    if (text) labels ??= new Map(all.map(s => [s, label(s)]));
    return all
      .filter(s => (!text || labels.get(s).includes(text)) && (!onlyFirsts?.checked || s[S.POS] === 1))
      .sort(SORTS[sort.value][1]);
  };
  // The whole file, loaded on the first search, sort, filter or page change of a list that came from the head.
  let fullPromise = null;
  const loadAll = () => (fullPromise ??= playerFile(id).then(full => {
    if (!isCurrent()) return false;
    lastFull = full;
    view.file = full;
    all = listOf(full);
    labels = null;
    partial = false;
    return true;
  }, e => {
    fullPromise = null;
    count.textContent = t('Couldn’t load all plays ({error}). Try again.', { error: e.message });
    return false;
  }));
  // Search, sort, "Only #1s" and page live in the URL, so Back from a map comes back to the same list.
  const count = body.querySelector('#count');
  let page = Math.max(0, (Number(query.page) || 1) - 1);
  const save = () => writeQuery({ q: q.value.trim(), sort: sort.value, firsts: Boolean(onlyFirsts?.checked), page: page + 1 }, { sort: 'pp', page: 1 });
  let items = visible();
  const showCount = speak => {
    count.textContent = resultCount(items.length, partial ? total : all.length, 'play');
    if (speak) announce(count.textContent);
  };
  // A page of nulls (past the head's first page) shows placeholder rows until the whole file is in.
  const redraw = paginate(body.querySelector('#scores'), items, slice => (slice[0]
    ? html`<div class="rows">${slice.map(s => scoreRow({
      s, meta: view.file.maps[s[S.MAP]], pos: tab.slug === 'pre' ? null : s[S.POS], cat: tab.cats ? playCat.get(s) : null,
    }))}</div>`
    : placeholderRows(slice.length)), 50, {
    page,
    onPage: n => {
      page = n;
      save();
      upgrade();
    },
    empty: () => emptyFiltered(q.value.trim()
      ? (onlyFirsts?.checked ? t('No play matches “{q}” among the #1s.', { q: q.value.trim() }) : t('No play matches “{q}”.', { q: q.value.trim() }))
      : t('No #1s in this list.')),
  });
  showCount(false);
  // Swaps the head's first page for the whole list, staying on the same page.
  function upgrade() {
    if (partial) loadAll().then(ok => { if (ok) { items = visible(); redraw(items, true); showCount(false); } });
  }
  // A switch on the page to a list's later page or sort (Back, say) while only the head file is in.
  if (needsAll(query)) upgrade();
  // The whole file can be 500 KB: start it when the pointer or focus reaches the search, sort or pages, so it's
  // usually in by the time they're used.
  const intent = e => { if (e.target.closest?.('.toolbar, .pager')) upgrade(); };
  body.addEventListener('pointerover', intent);
  body.addEventListener('focusin', intent);
  const refilter = () => {
    if (partial) {
      count.textContent = t('Loading all plays…');
      loadAll().then(ok => { if (ok) refilter(); });
      return;
    }
    items = visible();
    redraw(items);
    showCount(true);
  };
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refilter, 120); });
  sort.addEventListener('change', refilter);
  onlyFirsts?.addEventListener('change', refilter);
  body.querySelector('#scores').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    q.value = '';
    if (onlyFirsts) onlyFirsts.checked = false;
    refilter();
    q.focus();
  });
}
