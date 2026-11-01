// The Bounties tab of Challenges (pages/challenges.js shows it): bounties.json (tools/lib/bounties.mjs), the bounties
// posted with the bot's !bounty, the ones claimed and the automatic wanted list, and with Bananas on (economy.json) each
// bounty's pot, "Post a bounty" and Fund. Data from before bounties.json has only the wanted list, in challenges.json.
//
// Posting needs RULES.gate earned, a stake of RULES.minStake or more plus the 20% fee, and one post a month. The form
// shows the cost, the wallet (less what's already waiting for the bot) and each rule as a checklist before the button;
// Fund has the shop's two steps (amount, then confirm). Both send a request the bot judges (core/bananas.js); a refusal
// shows in the form's own line, Esc closes a form and gives focus back to what opened it.

import { html, raw } from '../core/html.js';
import { M } from '../core/model.js';
import { mapLink, playerLink, catChip, empty, ppText, scrollBehavior } from '../core/ui.js';
import {
  session, bananas, fee, RULES, signInButton, sendRequest, myRequests, mapIdFrom, pendingSpend, walletLine, closeOnEscape,
} from '../core/bananas.js';
import { GOAL_LABEL, goalLine, prizeTags, claimMods, potLine } from '../core/bounty.js';
import { challengeChips } from '../core/challenge-chips.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

/** A map's name as plain text, for a button's accessible name. */
const mapName = (id, meta) => (meta?.[M.TITLE] ? `${meta[M.ARTIST]} - ${meta[M.TITLE]} [${meta[M.VERSION]}]` : `#${id}`);

export function bountiesPanel(board, data, index, now, eco) {
  const maps = board?.maps ?? data.maps;
  const open = board?.open ?? [];
  const hall = board?.hall ?? [];
  const wanted = board?.wanted ?? data.bounties ?? [];
  const openSection = html`<section class="${eco && session() ? 'section' : ''}">
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
      ${eco && bountyId ? html`<div class="bounty-fund" data-map="${id}"><button class="btn btn-small" type="button" data-fund="${bountyId}" aria-expanded="false"
          aria-label="${t('Fund the bounty on {map}', { map: mapName(id, maps[id]) })}">${t('Fund')}</button>
        <div class="fund-form" hidden></div></div>` : ''}
    </div>`)}</div>` : empty(t('No open bounties right now.'))}
  </section>`;
  // Signed in, posting comes first (it's what you can do); signed out, what's on offer does.
  const post = eco ? postSection(eco) : '';
  return html`
    ${session() ? html`${post}${openSection}` : html`${openSection}${post ? html`<div class="section">${post}</div>` : ''}`}

    <section class="section">
      <div class="section-head"><h2>${t('Hall of fame')}</h2><span class="muted small">${t('Bounties claimed, newest first.')}</span></div>
      ${hall.length ? html`<div class="rows">${hall.map(([id, cat, goal, status, uid, at, mods, acc, combo, pp, prizes, payout]) => html`<div class="row bounty ${status === 'done' ? 'bounty-done' : ''}">
        <div class="row-main">${mapLink(id, maps[id])}
          <div class="justify-start row-meta">${playerLink(uid, index, 'avatar-sm')} <span>${GOAL_LABEL[goal]}</span>
            ${at ? html`<time class="faint" datetime="${new Date(at * 1000).toISOString()}">${fmt.date(at)}</time>` : ''}</div></div>
        <div class="row-meta">${claimMods(mods)} ${acc !== null ? html`<span class="acc">${fmt.acc(acc)}</span>` : ''}
          ${combo !== null ? html`<span class="combo">${fmt.num(combo)}x</span>` : ''} ${pp !== null ? ppText(pp) : ''}</div>
        ${status === 'done' ? html`<div class="bounty-foot"><span class="faint">${t('already done before it was posted')}</span></div>`
          : prizes.length || payout ? html`<div class="bounty-foot">${payout ? html`<span class="pot">${th('took {amount}', { amount: html`<b>${bananas(payout)}</b>` })}</span>` : ''}${prizeTags(prizes)}</div>` : ''}
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
          ${eco && session() ? html`<button class="link-button" type="button" data-post-map="${id}">${t('Post a bounty on it')}</button>` : ''}</div>
      </div>`)}</div>` : empty(t('Every boss map has an FC or a bounty on it.'))}
    </section>`;
}

/** The "Post a bounty" section: the rules in one line, then the form (signed in) or a sign-in button. */
function postSection(eco) {
  const me = session();
  const w = me ? eco.players?.[me.id] : null;
  return html`<section id="post-bounty">
    <div class="section-head"><h2>${t('Post a bounty')}</h2></div>
    <p class="muted small">${t('Posting takes {gate} bananas earned, a stake of {stake} or more held until the bounty ends, and a fee of 20% of the stake, which is burned. One a month, two open at most. Anyone signed in can add {fund} or more to a pot.', {
      gate: fmt.num(RULES.gate), stake: fmt.num(RULES.minStake), fund: fmt.num(RULES.minFund),
    })} ${t('Nobody can claim a bounty they posted or funded.')}</p>
    ${!me ? html`<div class="btn-row">${signInButton(t('Sign in to post or fund'))}</div>`
      : !w ? html`<p class="small muted">${t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`
        : html`<div class="btn-row"><button class="btn" type="button" id="post-open" aria-expanded="false" aria-controls="post-form">${t('Post a bounty…')}</button>
          <span class="small muted" id="post-wallet">${walletLine(w, 0)}</span></div>
          <p class="small post-hint" id="post-hint"></p>
        <form class="post-form" id="post-form" hidden novalidate></form>`}
  </section>`;
}

const lisbonMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit' });
const monthOf = sec => lisbonMonth.format(new Date(sec * 1000));

/**
 * The rules the bot will check, as the site sees them now: [ok, text, short] each (`short` names what's missing, for
 * the line next to "Post a bounty…"). `asked` are the player's bounty.create requests the bot hasn't refused: one it
 * accepted since the last export isn't on the board yet, so a map counts once whichever of the two has it. `free` is
 * the wallet less what's waiting for the bot.
 */
function postChecks(w, free, stake, open, me, asked) {
  const total = stake + fee(stake);
  const month = monthOf(Date.now() / 1000);
  const mine = open.filter(r => r[11] === me);
  const waiting = asked.filter(r => monthOf(Date.parse(r.t) / 1000) === month);
  const thisMonth = new Set([...mine.filter(r => r[3] && monthOf(r[3]) === month).map(r => r[0]), ...waiting.map(r => r.payload.map)]).size;
  const openCount = new Set([...mine.map(r => r[0]), ...waiting.map(r => r.payload.map)]).size;
  return [
    [w.e >= RULES.gate, t('{gate} earned (you: {earned})', { gate: fmt.num(RULES.gate), earned: fmt.num(w.e) }),
      t('{n} more earned needed to post.', { n: fmt.num(RULES.gate - w.e) })],
    [stake >= RULES.minStake, t('A stake of {min} or more', { min: fmt.num(RULES.minStake) }), t('The stake starts at {min}.', { min: bananas(RULES.minStake) })],
    [free >= total, t('Your wallet covers {total} (you have {balance})', { total: bananas(total), balance: bananas(free) }),
      t('Short by {n} for a stake of {stake}.', { n: bananas(total - free), stake: fmt.num(stake) })],
    [thisMonth < RULES.postsPerMonth, t('One bounty a month (this month: {n})', { n: fmt.num(thisMonth) }), t('You’ve posted this month’s bounty. Next month!')],
    [openCount < RULES.openAtOnce, t('Two open at most (you have {n})', { n: fmt.num(openCount) }), t('You have two bounties open already.')],
  ];
}

const checkList = checks => html`<ul class="checks-list">${checks.map(([ok, text]) => html`<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✕'}</span> ${text}<span class="sr-only"> (${ok ? t('met') : t('not met')})</span></li>`)}</ul>`;

/** Wires the Bounties tab's Bananas: the post form, "Post a bounty on it" from the wanted list, and each Fund button. */
export function wireBounties(root, board, eco, isCurrent) {
  const me = session();
  const w = me ? eco.players?.[me.id] : null;
  const open = board?.open ?? [];
  const maps = board?.maps ?? {};
  let requests = [];
  let asked = []; // the player's bounty.create requests the bot hasn't refused (postChecks)
  const free = () => (w ? w.b - pendingSpend(requests) : 0);

  // ---- Post: the fields are drawn once; the cost and the rules under them follow every change ----
  const form = root.querySelector('#post-form');
  const opener = root.querySelector('#post-open');
  const state = { goal: 'fc', mods: [], days: RULES.defaultDays };
  const chip = (attr, value, label, on) => html`<button class="chip ${on ? 'active' : ''}" type="button" data-${raw(attr)}="${value}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
  const chipGroupOf = (attr, label, items, on) => html`<div class="field"><span class="field-label" id="post-${raw(attr)}-label">${label}</span>
    <div class="chips" role="group" aria-labelledby="post-${raw(attr)}-label">${items.map(([value, text]) => chip(attr, value, text, on(value)))}</div></div>`;
  const read = () => ({ map: mapIdFrom(form.querySelector('#post-map').value), stake: Math.max(0, Math.round(Number(form.querySelector('#post-stake').value) || 0)) });

  /** The first rule that fails at the minimum stake, next to the button that opens the form. */
  function drawHint() {
    const hint = root.querySelector('#post-hint');
    if (!hint) return;
    root.querySelector('#post-wallet').innerHTML = String(walletLine(w, pendingSpend(requests)));
    const failing = postChecks(w, free(), RULES.minStake, open, me.id, asked).find(c => !c[0]);
    hint.textContent = failing ? failing[2] : '';
  }
  function drawSummary() {
    if (!form || form.hidden || !form.querySelector('#post-sum')) return;
    const { map, stake } = read();
    const checks = postChecks(w, free(), stake, open, me.id, asked);
    const failing = checks.find(c => !c[0]);
    const ready = map && !failing;
    const total = stake + fee(stake);
    form.querySelector('#post-snipe').hidden = state.goal !== 'snipe';
    form.querySelector('#post-sum').innerHTML = String(html`
      <dl class="kv post-cost">
        <div><dt>${t('Stake')}</dt><dd>${bananas(stake)}</dd></div>
        <div><dt>${t('Fee (burned)')}</dt><dd>${bananas(fee(stake))}</dd></div>
        <div><dt>${t('Total')}</dt><dd>${bananas(total)}</dd></div>
        ${total > free() ? html`<div><dt>${t('Short by')}</dt><dd>${bananas(total - free())}</dd></div>`
          : html`<div><dt>${t('Left after')}</dt><dd>${bananas(free() - total)}</dd></div>`}
      </dl>
      ${checkList(checks)}`);
    form.querySelector('[type=submit]').disabled = !ready;
    form.querySelector('#post-why').textContent = failing ? failing[2] : !map ? t('Add the map first.') : t('The bot checks it all again and answers within 15 minutes.');
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
      <div id="post-sum"></div>
      <div class="btn-row">
        <button class="btn btn-primary" type="submit" disabled>${t('Post bounty')}</button>
        <span class="small muted" id="post-why" aria-live="polite"></span>
      </div>`);
    drawSummary();
  }
  const openPost = (mapText = '') => {
    form.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    drawPost(mapText);
  };
  const closePost = () => {
    form.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    opener.focus();
  };
  opener?.addEventListener('click', () => {
    if (form.hidden) { openPost(); form.querySelector('#post-map').focus(); } else closePost();
  });
  if (form) closeOnEscape(form, closePost);
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
    const submit = form.querySelector('[type=submit]');
    if (submit.disabled || !map || postChecks(w, free(), stake, open, me.id, asked).some(c => !c[0])) return;
    // Disabled while it's on its way, so a second press can't send it twice.
    submit.disabled = true;
    const mods = RULES.mods.filter(m => state.mods.includes(m)).join('') || null;
    const sent = await sendRequest('bounty.create', { map, goal: state.goal, stake, mods, days: state.days });
    if (sent.ok) {
      asked = [...asked, { t: new Date().toISOString(), payload: { map } }];
      requests = [{ type: 'bounty.create', status: 'pending', payload: { map, stake }, t: new Date().toISOString() }, ...requests];
      closePost();
      drawHint();
      hideAsked();
    } else {
      submit.disabled = false;
      form.querySelector('#post-why').textContent = sent.message;
    }
  });
  /** "Post a bounty on it" goes from maps you've already asked to post on. */
  const hideAsked = () => {
    const mapsAsked = new Set(asked.map(r => String(r.payload.map)));
    root.querySelectorAll('[data-post-map]').forEach(b => { b.hidden = mapsAsked.has(b.dataset.postMap); });
  };
  // The player's requests: what's waiting comes off the wallet shown, and posts the board doesn't show yet count.
  if (me) {
    myRequests().then(list => {
      if (!list || !isCurrent()) return;
      requests = list;
      asked = list.filter(r => r.type === 'bounty.create' && r.status !== 'rejected');
      drawHint();
      drawSummary();
      hideAsked();
    });
    if (w) drawHint();
  }

  // ---- Fund: an amount, then a confirmation with the wallet before and after ----
  root.querySelectorAll('[data-fund]').forEach(button => {
    const box = button.nextElementSibling;
    const id = Number(button.dataset.fund);
    const mapId = Number(button.closest('[data-map]').dataset.map);
    const name = mapName(mapId, maps[mapId]);
    const close = () => {
      box.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.focus();
    };
    const note = amount => (amount < RULES.minFund ? t('At least {min}.', { min: bananas(RULES.minFund) })
      : amount > free() ? t('Your wallet has {balance} free.', { balance: bananas(free()) })
        : t('Your wallet: {balance}, then {after}. No fee. If nobody claims it, 70% comes back.', { balance: bananas(free()), after: bananas(free() - amount) }));
    const pick = (amount = Math.min(50, Math.max(RULES.minFund, free()))) => {
      box.innerHTML = String(html`<form class="fund-row" novalidate>
        <div class="field"><label for="fund-${id}">${t('Add to the pot')}</label>
          <input class="input" id="fund-${id}" type="number" inputmode="numeric" min="${RULES.minFund}" step="5" value="${amount}"></div>
        <button class="btn btn-small" type="submit">${t('Fund…')}</button>
        <p class="small muted fund-note" aria-live="polite"></p>
        <p class="small faint">${t('Funding a bounty means you can’t claim it yourself.')}</p>
      </form>`);
      update();
    };
    const update = () => {
      const input = box.querySelector('input');
      if (!input) return 0;
      const amount = Math.round(Number(input.value) || 0);
      box.querySelector('[type=submit]').disabled = !(amount >= RULES.minFund && amount <= free());
      box.querySelector('.fund-note').textContent = note(amount);
      return amount;
    };
    const confirm = amount => {
      box.innerHTML = String(html`<div class="fund-confirm">
        <p>${th('Add {amount} to the pot on {map}?', { amount: html`<b>${bananas(amount)}</b>`, map: name })}</p>
        <p class="small muted">${t('Your wallet goes from {balance} to {after}. You won’t be able to claim this bounty.', { balance: bananas(free()), after: bananas(free() - amount) })}</p>
        <div class="btn-row">
          <button class="btn btn-small btn-primary" type="button" data-confirm>${t('Confirm')}</button>
          <button class="btn btn-small" type="button" data-cancel>${t('Cancel')}</button>
        </div>
        <p class="small fund-error" aria-live="polite"></p>
      </div>`);
      box.dataset.amount = String(amount);
      box.querySelector('[data-confirm]').focus();
    };
    box.addEventListener('input', update);
    box.addEventListener('submit', e => {
      e.preventDefault();
      const amount = update();
      if (amount >= RULES.minFund && amount <= free()) confirm(amount);
    });
    box.addEventListener('click', async e => {
      if (e.target.closest('[data-cancel]')) {
        pick(Number(box.dataset.amount));
        box.querySelector('input').focus();
        return;
      }
      const go = e.target.closest('[data-confirm]');
      if (!go || go.disabled) return;
      go.disabled = true;
      const amount = Number(box.dataset.amount);
      const sent = await sendRequest('bounty.fund', { bountyId: id, amount });
      if (sent.ok) {
        requests = [{ type: 'bounty.fund', status: 'pending', payload: { bountyId: id, amount }, t: new Date().toISOString() }, ...requests];
        drawHint();
        close();
      } else {
        go.disabled = false;
        box.querySelector('.fund-error').textContent = sent.message;
      }
    });
    // Esc steps back: from the confirmation to the amount, then closes.
    closeOnEscape(box, () => {
      if (box.querySelector('[data-cancel]')) { pick(Number(box.dataset.amount)); box.querySelector('input').focus(); } else close();
    });
    button.addEventListener('click', () => {
      const opening = box.hidden;
      box.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (!opening) return;
      if (!me) { box.innerHTML = String(html`<p class="small muted">${t('Sign in with osu! to fund a bounty.')}</p>${signInButton()}`); return; }
      if (!w) { box.innerHTML = String(html`<p class="small muted">${t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`); return; }
      pick();
      box.querySelector('input').focus();
    });
  });
}
