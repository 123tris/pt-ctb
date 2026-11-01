// #/shop: what bananas buy (core/bananas.js SHOP, CURRENCY-DESIGN.md §5). Every purchase is a request the bot judges,
// like a bounty, and it can take up to 15 minutes.
//
// Each item is one disclosure: its whole header is a single button (aria-expanded) that opens or folds its panel, and
// only one is open at a time, so there's one primary action on screen. Items go cheapest first in each group. The header
// says at a glance what matters for you: the price (dim when you can't afford it, with how much you're short), and
// whether it's already yours, active, waiting for the bot or behind the 1,000-earned gate. The panel says why you can't
// buy it when you can't, and buying takes two steps: pick what you want, then a confirmation with the price and your
// wallet after, which you can cancel. What's already waiting for the bot comes off the wallet you plan with. Esc steps
// back: from the confirmation to the choice, then folds the item.

import { html, raw } from '../core/html.js';
import { playerHead, playerIndex } from '../core/data.js';
import { S, CATS } from '../core/model.js';
import { setTitle, pageHead, empty, announce, mapLabel } from '../core/ui.js';
import { localBadge } from '../core/badges.js';
import {
  economy, session, bananas, SHOP, COLOURS, colourName, signInButton, sendRequest, myRequests, requestList, mapIdFrom,
  pendingSpend, walletLine, periodsText, priceText,
} from '../core/bananas.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

const GROUPS = [['look', t('Your look')], ['community', t('Community picks')]];
const DAY = 86400;
const SIGNATURE_CHOICES = 30; // the player's best plays offered for the signature
const CHEVRON = raw('<svg class="shop-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>');

/**
 * The extra thing an item needs: { label, field, read(panel) → arg or null, missing }. `ctx` has the player's titles,
 * their best plays (for the signature) and what's active now (a colour or role starts on the current one).
 */
function argField(item, { titles, plays, w, cur }) {
  const id = `arg-${item}`;
  const select = (options, selected) => html`<select class="select" id="${id}" aria-describedby="effect-${item}">${options.map(([v, label]) => html`<option value="${v}" ${String(v) === String(selected) ? raw('selected') : ''}>${label}</option>`)}</select>`;
  const mapInput = html`<input class="input" id="${id}" placeholder="${t('Map id or osu! link')}" autocomplete="off" aria-describedby="effect-${item} why-${item}">`;
  const value = panel => panel.querySelector(`#${id}`).value;
  const map = label => ({ label, field: mapInput, read: panel => mapIdFrom(value(panel)), missing: t('Add the map first: its id or its osu! link.') });
  switch (item) {
    // Starts on a title that isn't already yours.
    case 'title': return { label: t('Which title'), field: select(titles, titles.find(([v]) => v.toLowerCase() !== w?.t?.toLowerCase())?.[0]), read: value };
    case 'signature': return { label: t('Which play'), field: select(plays, plays.find(([v]) => v !== w?.sg)?.[0]), read: panel => Number(value(panel)) || null };
    case 'motw': return map(t('The map to nominate'));
    case 'wildcard': return map(t('The convert map for next month'));
    // Starts on the colour you have, so buying it again (adding days) is the obvious choice.
    default: return { label: t('Colour'), field: select(COLOURS, cur?.[0] ?? COLOURS[0][0]), read: value };
  }
}

/**
 * A timed item's current [palette name, end] (unix seconds), or null. The wallet says it (colour and colourUntil, role and
 * roleUntil); for a role, while the bot doesn't write roleUntil yet, the end is worked out from when it accepted the
 * purchase.
 */
function currentTimed(s, w, requests, now) {
  if (!w || !s.days) return null;
  if (s.item === 'colour') return w.c ? [w.c, w.cu] : null;
  if (w.ro && w.ru) return w.ru > now ? [w.ro, w.ru] : null;
  const accepted = requests.find(r => r.payload?.item === s.item && r.status === 'accepted');
  const until = accepted ? Date.parse(accepted.decided ?? accepted.t) / 1000 + s.days * DAY : 0;
  return until > now ? [w.ro ?? accepted.payload.arg, until] : null;
}

/**
 * What buying `value` would do, by the bot's repeat-buy rule (bananas-contract.md §6): a colour or role's new end is the
 * later of now and the current end, plus its days, whether it's the same one or another; a new title or signature play
 * replaces the old one; the one you already have can't be bought. { text, blocked }.
 */
function effectOf(s, value, w, cur, now, periods = 1) {
  if (s.days) {
    const days = s.days * periods;
    const until = Math.max(now, cur?.[1] ?? 0) + days * DAY;
    if (cur && cur[0] === value) return { text: t('Adds {n} days: in use until {date}.', { n: days, date: fmt.date(until) }) };
    if (cur) return { text: t('Switches from {current} to {colour}, keeping the time left and adding {n} days: in use until {date}.', { current: colourName(cur[0]), colour: colourName(value), n: days, date: fmt.date(until) }) };
    return { text: t('In use until {date}.', { date: fmt.date(until) }) };
  }
  if (s.item === 'title' && w?.t) return String(value).toLowerCase() === w.t.toLowerCase() ? { text: t('Already yours.'), blocked: true } : { text: t('Replaces {current}.', { current: w.t }) };
  if (s.item === 'signature' && w?.sg) return value === w.sg ? { text: t('That play is already pinned.'), blocked: true } : { text: t('Replaces the play you have pinned now.') };
  return { text: '' };
}

/**
 * Where an item stands for this visitor: { tag (a few words for the header), why (the reason it can't be bought, or
 * null), owned (a line for the panel), cur }. `free` is the wallet less what's waiting for the bot.
 */
function standing(s, { me, w, free, titles, plays, requests }) {
  const pending = requests.find(r => r.payload?.item === s.item && r.status === 'pending');
  const now = Date.now() / 1000;
  const cur = currentTimed(s, w, requests, now);
  let owned = null;
  if (w && s.item === 'title' && w.t) owned = t('Yours now: {title}.', { title: w.t });
  if (w && s.item === 'signature' && w.sg) owned = t('You have a play pinned. A new one replaces it.');
  if (cur) {
    const left = Math.max(1, Math.ceil((cur[1] - now) / DAY));
    owned = cur[0] ? tn(left, 'In use: {colour}, {n} day left.', 'In use: {colour}, {n} days left.', { colour: colourName(cur[0]) })
      : tn(left, 'In use: {n} day left.', 'In use: {n} days left.');
  }
  const gateTag = s.gate ? t('Needs {gate} earned', { gate: fmt.num(s.gate) }) : '';

  // Signed out, the page says it once at the top; each panel says it again with the button. The gate shows anyway.
  if (!me) return { tag: gateTag, why: t('Sign in with osu! to buy. You can look around first.'), owned };
  if (!w) return { tag: '', why: t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.'), owned };
  if (pending) return { tag: t('Waiting for the bot'), why: t('You asked for this {ago}. The bot answers within 15 minutes; it shows under “Your purchases”.', { ago: fmt.ago(Date.parse(pending.t) / 1000) }), owned };
  if (s.item === 'title' && !titles.length) return { tag: '', why: t('You have no titles or badges to show yet. Badges come from your plays; titles from King of the hill.'), owned };
  if (s.item === 'signature' && !plays.length) return { tag: '', why: t('The site has no plays of yours to pin yet.'), owned };
  if (s.gate && w.e < s.gate) return { tag: gateTag, why: t('This needs {gate} bananas earned, as posting a bounty does; you have {earned}. Tips, refunds and the launch grant don’t count.', { gate: fmt.num(s.gate), earned: fmt.num(w.e) }), owned };
  if (free < s.price) {
    return { tag: t('{n} short', { n: bananas(s.price - free) }), why: free < w.b
      ? t('You need {n} more: your wallet has {balance}, and {pending} of it is waiting for the bot.', { n: bananas(s.price - free), balance: bananas(w.b), pending: bananas(w.b - free) })
      : t('You need {n} more: your wallet has {balance}.', { n: bananas(s.price - free), balance: bananas(w.b) }), owned };
  }
  const tag = cur ? t('In use') : (s.item === 'title' && w.t) || (s.item === 'signature' && w.sg) ? t('Yours') : '';
  return { tag, why: null, owned, cur };
}

export default async function shop(root, { isCurrent }) {
  setTitle(t('Shop'));
  const me = session();
  const [eco, index, head] = await Promise.all([economy().catch(() => null), playerIndex(), me ? playerHead(me.id).catch(() => null) : null]);
  if (!isCurrent()) return;
  const w = me ? eco?.players?.[me.id] : null;
  const myName = me ? index.get(me.id)?.name ?? '' : '';
  // Titles you can show: your badges, sent in English for the bot, shown in your language.
  const titles = (head?.extras?.badges ?? []).map(b => [b.name, localBadge(b).name]);
  // Plays you can pin: your best ones by pp, one per map, as "map [diff] · 312 pp".
  const plays = [...new Map(CATS.flatMap(cat => head?.scores?.[cat] ?? []).sort((a, b) => b[S.PP] - a[S.PP])
    .map(s => [s[S.MAP], s])).values()].slice(0, SIGNATURE_CHOICES)
    .map(s => [s[S.MAP], `${mapLabel(s[S.MAP], head.maps[s[S.MAP]])} · ${fmt.pp(s[S.PP])} pp`]);
  let requests = [];
  let open = null; // the item whose panel is open
  const free = () => (w ? w.b - pendingSpend(requests) : 0);
  const ctx = s => ({ titles, plays, w, cur: currentTimed(s, w, requests, Date.now() / 1000) });

  const item = s => {
    const st = standing(s, { me, w, free: free(), titles, plays, requests });
    const short = w && free() < s.price;
    return html`<div class="shop-item" data-item="${s.item}">
      <button class="shop-head" type="button" id="head-${s.item}" aria-expanded="${open === s.item ? 'true' : 'false'}" aria-controls="panel-${s.item}">
        <span class="shop-name">${s.name}${s.approval ? html` <span class="shop-mark">${t('needs a moderator’s OK')}</span>` : ''}</span>
        <span class="shop-about">${s.about}</span>
        <span class="shop-side"><span class="shop-price ${short ? 'shop-short' : ''}">${priceText(s)}</span>${st.tag ? html`<span class="shop-tag">${st.tag}</span>` : ''}</span>
        ${CHEVRON}
      </button>
      <div class="shop-panel" id="panel-${s.item}" role="region" aria-labelledby="head-${s.item}" ${open === s.item ? '' : raw('hidden')}>${open === s.item ? panel(s, st) : ''}</div>
    </div>`;
  };

  /** Step one: what the item does, what it needs, and why not when it can't be bought. */
  const panel = (s, st) => {
    const arg = argField(s.item, ctx(s));
    return html`
      ${st.owned ? html`<p class="shop-owned">${st.owned}</p>` : ''}
      ${s.approval ? html`<p class="small muted">${t('A moderator checks it fits first. If they say no, the bananas come back.')}</p>` : ''}
      ${s.monthly ? html`<p class="small muted">${t('One a month for all of PT: the first one the bot accepts takes it. If it’s gone, the bot says so and nothing is charged.')}</p>` : ''}
      ${st.why ? html`<p class="small muted" id="why-${s.item}">${st.why}</p>${!me ? html`<div class="btn-row">${signInButton()}</div>` : ''}`
        : html`<div class="shop-step" data-step="pick">
          <div class="field"><label for="arg-${s.item}">${arg.label}</label>${arg.field}</div>
          ${s.periods ? html`<div class="field"><label for="periods-${s.item}">${t('How long')}</label><select class="select" id="periods-${s.item}">${s.periods
            .map(n => html`<option value="${n}">${periodsText(s, n)} · ${bananas(s.price * n)}</option>`)}</select></div>` : ''}
          <button class="btn btn-small" type="button" data-review>${t('Buy…')}</button>
          ${s.item === 'colour' ? html`<p class="small shop-preview">${th('Your name will look like this: {name}', { name: html`<b class="name-colour" id="colour-preview">${myName}</b>` })}</p>` : ''}
          <p class="small shop-effect" id="effect-${s.item}" aria-live="polite"></p>
          <p class="small muted shop-why" id="why-${s.item}" aria-live="polite">${t('Your wallet: {balance}, then {after}.', { balance: bananas(free()), after: bananas(free() - s.price) })}</p>
        </div>`}`;
  };

  /** Step two: the confirmation, with the price, the choice and the wallet after; Cancel goes back. */
  const confirmStep = (s, choice, effect, total, periods) => html`<div class="shop-step shop-confirm" data-step="confirm">
    <p>${th('Buy {item} ({choice}) for {price}?', { item: html`<b>${s.days ? `${s.name}, ${periodsText(s, periods)}` : s.name}</b>`, choice, price: html`<b>${bananas(total)}</b>` })}</p>
    ${effect ? html`<p class="small shop-effect">${effect}</p>` : ''}
    <p class="small muted">${t('Your wallet goes from {balance} to {after}. Bananas spent in the shop are burned: they don’t come back.', { balance: bananas(free()), after: bananas(free() - total) })}${s.approval ? ` ${t('Unless a moderator says no: then they do.')}` : ''}</p>
    <div class="btn-row">
      <button class="btn btn-small btn-primary" type="button" data-confirm>${t('Confirm purchase')}</button>
      <button class="btn btn-small" type="button" data-cancel>${t('Cancel')}</button>
    </div>
    <p class="small shop-error" aria-live="polite"></p>
  </div>`;

  let draw = () => {
    const pending = pendingSpend(requests);
    root.innerHTML = String(html`
      ${pageHead({ title: t('Shop'), intro: t('Spend bananas on your look or on community picks. What you spend here is burned: bananas are never bought, sold or turned into supporter.') })}
      ${!eco ? empty(t('Bananas haven’t started yet. The shop opens with them.')) : html`
        <section class="shop-wallet">
          ${!me ? html`<p class="muted">${t('Sign in with osu! to buy. You can look around first.')}</p><div class="btn-row">${signInButton()}</div>`
            : w ? html`<p>${walletLine(w, pending)} <a class="small" href="#/player/${me.id}">${t('See your wallet')}</a></p>
              ${!w.s && w.p ? html`<p class="small muted">${t('Plus {n} in your pouch: the bot moves it into your wallet at its next update, within 15 minutes.', { n: bananas(w.p) })}</p>` : ''}`
              : html`<p class="muted">${t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`}
          ${requests.some(r => r.type === 'shop.buy') ? html`<h2 class="small-h">${t('Your purchases')}</h2>${requestList(requests.filter(r => r.type === 'shop.buy'), index)}` : ''}
        </section>
        ${GROUPS.map(([group, title]) => html`<section class="section">
          <h2>${title}</h2>
          <div class="rows shop-items">${SHOP.filter(s => s.group === group).sort((a, b) => a.price - b.price).map(item)}</div>
        </section>`)}`}
    `);
  };
  /** The open item's effect line (and the colour preview), for what's picked right now. */
  const showEffect = () => {
    const s = SHOP.find(x => x.item === open);
    const panelBox = s && root.querySelector(`#panel-${s.item}`);
    const line = panelBox?.querySelector(`#effect-${s.item}`);
    if (!line) return;
    const value = argField(s.item, ctx(s)).read(panelBox);
    const periods = periodsOf(panelBox, s);
    const total = s.price * periods;
    const now = Date.now() / 1000;
    const { text, blocked } = value === null || value === '' ? { text: '' } : effectOf(s, value, w, currentTimed(s, w, requests, now), now, periods);
    line.textContent = text;
    line.classList.toggle('shop-blocked', Boolean(blocked));
    const short = total > free();
    panelBox.querySelector('[data-review]').disabled = Boolean(blocked) || short;
    panelBox.querySelector('.shop-why').textContent = short ? t('Short by {n} for that: your wallet has {balance} free.', { n: bananas(total - free()), balance: bananas(free()) })
      : t('Your wallet: {balance}, then {after}.', { balance: bananas(free()), after: bananas(free() - total) });
    const preview = panelBox.querySelector('#colour-preview');
    if (preview) preview.className = `name-colour name-${value}`;
  };
  const drawAll = draw;
  draw = () => { drawAll(); showEffect(); };
  draw();
  root.addEventListener('input', showEffect);
  root.addEventListener('change', showEffect);
  if (!eco) return;
  if (me) {
    const refresh = async () => {
      if (!isCurrent()) { window.removeEventListener('ptctb:requests', refresh); return; }
      const list = await myRequests();
      if (!isCurrent() || !list) return;
      requests = list;
      // Redraw without losing the open step: only when nothing is being confirmed.
      if (root.querySelector('.shop-confirm')) return;
      const focused = document.activeElement?.id;
      draw();
      if (focused) document.getElementById(focused)?.focus();
    };
    refresh();
    window.addEventListener('ptctb:requests', refresh);
  }

  /** How many periods of a timed item are picked (1 for anything else). */
  const periodsOf = (panelBox, s) => Number(panelBox.querySelector(`#periods-${s.item}`)?.value) || 1;

  const fold = s => {
    open = null;
    draw();
    document.getElementById(`head-${s.item}`)?.focus();
  };
  const backToPick = (s, panelBox) => {
    panelBox.querySelector('.shop-confirm').outerHTML = panelBox.dataset.pick;
    panelBox.querySelector(`#arg-${s.item}`).value = panelBox.dataset.value;
    const periodsField = panelBox.querySelector(`#periods-${s.item}`);
    if (periodsField) periodsField.value = panelBox.dataset.periods;
    showEffect();
    panelBox.querySelector(`#arg-${s.item}`).focus();
  };

  // Esc: from the confirmation back to the choice; from the choice, fold the item.
  root.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const itemBox = e.target.closest?.('.shop-item');
    if (!itemBox || itemBox.dataset.item !== open) return;
    e.preventDefault();
    e.stopPropagation();
    const s = SHOP.find(x => x.item === open);
    const panelBox = itemBox.querySelector('.shop-panel');
    if (panelBox.querySelector('.shop-confirm')) backToPick(s, panelBox);
    else fold(s);
  });

  root.addEventListener('click', async e => {
    const headButton = e.target.closest('.shop-head');
    const itemBox = e.target.closest('.shop-item');
    if (!itemBox) return;
    const s = SHOP.find(x => x.item === itemBox.dataset.item);
    if (headButton) {
      open = open === s.item ? null : s.item;
      draw();
      document.getElementById(`head-${s.item}`).focus();
      return;
    }
    const panelBox = itemBox.querySelector('.shop-panel');
    const step = panelBox.querySelector('.shop-step');
    if (e.target.closest('[data-review]')) {
      const arg = argField(s.item, ctx(s));
      const value = arg.read(panelBox);
      if (value === null || value === '') {
        panelBox.querySelector('.shop-why').textContent = arg.missing;
        panelBox.querySelector(`#arg-${s.item}`).focus();
        return;
      }
      const now = Date.now() / 1000;
      const periods = periodsOf(panelBox, s);
      const effect = effectOf(s, value, w, currentTimed(s, w, requests, now), now, periods);
      if (effect.blocked || s.price * periods > free()) return;
      const select = panelBox.querySelector(`select#arg-${s.item}`);
      const choice = select ? select.selectedOptions[0].textContent : t('map {id}', { id: value });
      const kept = step.outerHTML;
      step.outerHTML = String(confirmStep(s, choice, effect.text, s.price * periods, periods));
      panelBox.dataset.pick = kept;
      panelBox.dataset.value = String(value);
      panelBox.dataset.periods = String(periods);
      panelBox.querySelector('[data-confirm]').focus();
      announce(t('Check the price, then confirm.'));
      return;
    }
    if (e.target.closest('[data-cancel]')) { backToPick(s, panelBox); return; }
    const button = e.target.closest('[data-confirm]');
    if (button && !button.disabled) {
      // Disabled while it's on its way, so a second press can't buy twice.
      button.disabled = true;
      const picked = panelBox.dataset.value;
      const value = /^\d+$/.test(picked) && s.item !== 'title' ? Number(picked) : picked;
      const periods = Number(panelBox.dataset.periods) || 1;
      const sent = await sendRequest('shop.buy', { item: s.item, arg: value, periods });
      if (sent.ok) {
        requests = [{ type: 'shop.buy', payload: { item: s.item, arg: value, periods }, status: 'pending', t: new Date().toISOString() }, ...requests];
        fold(s);
      } else {
        button.disabled = false;
        panelBox.querySelector('.shop-error').textContent = sent.message;
      }
    }
  });
}
