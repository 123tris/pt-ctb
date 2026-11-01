// #/shop: what bananas buy (core/bananas.js SHOP, CURRENCY-DESIGN.md §5). Every purchase is a request the bot judges,
// like a bounty, and it can take up to 15 minutes.
//
// Each item is one disclosure: its whole header is a single button (aria-expanded) that opens or folds its panel, and
// only one is open at a time, so there's one primary action on screen. The header says at a glance what matters for you:
// the price (dim when you can't afford it, with how much you're short), and whether it's already yours, active or
// waiting for the bot. The panel says why you can't buy it when you can't, and buying takes two steps: pick what you
// want, then a confirmation with the price and your wallet after, which you can cancel.

import { html, raw } from '../core/html.js';
import { playerHead, playerIndex } from '../core/data.js';
import { setTitle, pageHead, empty, announce } from '../core/ui.js';
import { localBadge } from '../core/badges.js';
import { economy, session, bananas, SHOP, signInButton, sendRequest, myRequests, requestList, mapIdFrom } from '../core/bananas.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

/** The colours a name or a Discord role can take: the site's own, by name (the bot maps them). */
const COLOURS = [['rosa', t('Rosa')], ['gold', t('Gold')], ['mint', t('Mint')], ['sky', t('Sky')], ['lilac', t('Lilac')], ['sand', t('Sand')]];
const colourName = key => COLOURS.find(c => c[0] === key)?.[1] ?? key;

const GROUPS = [['look', t('Your look')], ['community', t('Community picks')]];
const DAY = 86400;
const CHEVRON = raw('<svg class="shop-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>');

/** The extra thing an item needs: { label, field, read(panel) → arg or null, missing }. */
function argField(item, titles) {
  const id = `arg-${item}`;
  const select = options => html`<select class="select" id="${id}">${options.map(([v, label]) => html`<option value="${v}">${label}</option>`)}</select>`;
  const mapInput = html`<input class="input" id="${id}" placeholder="${t('Map id or osu! link')}" autocomplete="off" aria-describedby="why-${item}">`;
  const value = panel => panel.querySelector(`#${id}`).value;
  const map = label => ({ label, field: mapInput, read: panel => mapIdFrom(value(panel)), missing: t('Add the map first: its id or its osu! link.') });
  switch (item) {
    case 'title': return { label: t('Which title'), field: select(titles), read: value };
    case 'signature': return map(t('The map of the play to pin'));
    case 'motw': return map(t('The map to nominate'));
    case 'wildcard': return map(t('The convert map for next month'));
    default: return { label: t('Colour'), field: select(COLOURS), read: value };
  }
}

/**
 * Where an item stands for this visitor: { tag (a few words for the header), why (the reason it can't be bought, or
 * null), owned (a line for the panel) }.
 */
function standing(s, { me, w, titles, requests }) {
  const mine = requests.filter(r => r.payload?.item === s.item);
  const pending = mine.find(r => r.status === 'pending');
  const accepted = mine.find(r => r.status === 'accepted');
  const now = Date.now() / 1000;
  // A timed item bought through the site: active for its days from when the bot accepted it.
  const timedLeft = accepted && s.days ? Math.ceil((Date.parse(accepted.decided ?? accepted.t) / 1000 + s.days * DAY - now) / DAY) : 0;
  let owned = null;
  if (w && s.item === 'title' && w.t) owned = t('Yours now: {title}.', { title: w.t });
  if (w && s.item === 'signature' && w.sg) owned = t('You have a play pinned. Buying again replaces it.');
  if (w && s.item === 'colour' && w.c) owned = tn(Math.ceil((w.cu - now) / DAY), 'Active: {colour}, {n} day left.', 'Active: {colour}, {n} days left.', { colour: colourName(w.c) });
  else if (s.days && timedLeft > 0) owned = tn(timedLeft, 'Active: {n} day left.', 'Active: {n} days left.');

  // Signed out, the page says it once at the top; each panel says it again with the button.
  if (!me) return { tag: '', why: t('Sign in with osu! to buy. You can look around first.'), owned };
  if (!w) return { tag: '', why: t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.'), owned };
  if (pending) return { tag: t('Waiting for the bot'), why: t('You asked for this {ago}. The bot answers within 15 minutes; it shows under “Your purchases”.', { ago: fmt.ago(Date.parse(pending.t) / 1000) }), owned };
  if (s.item === 'title' && !titles.length) return { tag: '', why: t('You have no titles or badges to show yet. Badges come from your plays; titles from King of the hill.'), owned };
  if (w.b < s.price) return { tag: t('{n} short', { n: bananas(s.price - w.b) }), why: t('You need {n} more: your wallet has {balance}.', { n: bananas(s.price - w.b), balance: bananas(w.b) }), owned };
  const tag = s.item === 'colour' && w.c ? t('Active') : timedLeft > 0 ? t('Active') : (s.item === 'title' && w.t) || (s.item === 'signature' && w.sg) ? t('Yours') : '';
  return { tag, why: null, owned };
}

export default async function shop(root, { isCurrent }) {
  setTitle(t('Shop'));
  const me = session();
  const [eco, index, head] = await Promise.all([economy().catch(() => null), playerIndex(), me ? playerHead(me.id).catch(() => null) : null]);
  if (!isCurrent()) return;
  const w = me ? eco?.players?.[me.id] : null;
  // Titles you can show: your badges, sent in English for the bot, shown in your language.
  const titles = (head?.extras?.badges ?? []).map(b => [b.name, localBadge(b).name]);
  let requests = [];
  let open = null; // the item whose panel is open

  const item = s => {
    const st = standing(s, { me, w, titles, requests });
    const short = w && w.b < s.price;
    return html`<div class="shop-item" data-item="${s.item}">
      <button class="shop-head" type="button" id="head-${s.item}" aria-expanded="${open === s.item ? 'true' : 'false'}" aria-controls="panel-${s.item}">
        <span class="shop-name">${s.name}${s.approval ? html` <span class="shop-mark">${t('moderator approves')}</span>` : ''}</span>
        <span class="shop-about">${s.about}</span>
        <span class="shop-side"><span class="shop-price ${short ? 'shop-short' : ''}">${bananas(s.price)}</span>${st.tag ? html`<span class="shop-tag">${st.tag}</span>` : ''}</span>
        ${CHEVRON}
      </button>
      <div class="shop-panel" id="panel-${s.item}" role="region" aria-labelledby="head-${s.item}" ${open === s.item ? '' : raw('hidden')}>${open === s.item ? panel(s, st) : ''}</div>
    </div>`;
  };

  /** Step one: what the item does, what it needs, and why not when it can't be bought. */
  const panel = (s, st) => {
    const arg = argField(s.item, titles);
    return html`
      ${st.owned ? html`<p class="shop-owned">${st.owned}</p>` : ''}
      ${s.approval ? html`<p class="small muted">${t('A moderator checks it fits first. If they say no, the bananas come back.')}</p>` : ''}
      ${st.why ? html`<p class="small muted" id="why-${s.item}">${st.why}</p>${!me ? html`<div class="btn-row">${signInButton()}</div>` : ''}`
        : html`<div class="shop-step" data-step="pick">
          <div class="field"><label for="arg-${s.item}">${arg.label}</label>${arg.field}</div>
          <button class="btn btn-small" type="button" data-review>${t('Buy…')}</button>
          <p class="small muted shop-why" id="why-${s.item}" aria-live="polite">${t('Your wallet: {balance}, then {after}.', { balance: bananas(w.b), after: bananas(w.b - s.price) })}</p>
        </div>`}`;
  };

  /** Step two: the confirmation, with the price, the choice and the wallet after; Cancel goes back. */
  const confirmStep = (s, choice) => html`<div class="shop-step shop-confirm" data-step="confirm">
    <p>${th('Buy {item} ({choice}) for {price}?', { item: html`<b>${s.name}</b>`, choice, price: html`<b>${bananas(s.price)}</b>` })}</p>
    <p class="small muted">${t('Your wallet goes from {balance} to {after}. Bananas spent in the shop are burned: they don’t come back.', { balance: bananas(w.b), after: bananas(w.b - s.price) })}${s.approval ? ` ${t('Unless a moderator says no: then they do.')}` : ''}</p>
    <div class="btn-row">
      <button class="btn btn-small btn-primary" type="button" data-confirm>${t('Confirm purchase')}</button>
      <button class="btn btn-small" type="button" data-cancel>${t('Cancel')}</button>
    </div>
  </div>`;

  const draw = () => {
    root.innerHTML = String(html`
      ${pageHead({ title: t('Shop'), intro: t('Spend bananas on your look or on community picks. What you spend here is burned: bananas are never bought, sold or turned into supporter.') })}
      ${!eco ? empty(t('Bananas haven’t started yet. The shop opens with them.')) : html`
        <section class="shop-wallet">
          ${!me ? html`<p class="muted">${t('Sign in with osu! to buy. You can look around first.')}</p><div class="btn-row">${signInButton()}</div>`
            : w ? html`<p>${th('Your wallet: {amount}', { amount: html`<b>${bananas(w.b)}</b>` })} <a class="small" href="#/player/${me.id}">${t('See your wallet')}</a></p>
              ${!w.s && w.p ? html`<p class="small muted">${t('Plus {n} in your pouch: the bot moves it into your wallet at its next update, within 15 minutes.', { n: bananas(w.p) })}</p>` : ''}`
              : html`<p class="muted">${t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`}
          ${requests.some(r => r.type === 'shop.buy') ? html`<h2 class="small-h">${t('Your purchases')}</h2>${requestList(requests.filter(r => r.type === 'shop.buy'), index)}` : ''}
        </section>
        ${GROUPS.map(([group, title]) => html`<section class="section">
          <h2>${title}</h2>
          <div class="rows shop-items">${SHOP.filter(s => s.group === group).map(item)}</div>
        </section>`)}`}
    `);
  };
  draw();
  if (!eco) return;
  if (me) {
    const refresh = async () => {
      if (!isCurrent()) { window.removeEventListener('ptctb:requests', refresh); return; }
      const list = await myRequests();
      if (!isCurrent() || !list) return;
      requests = list;
      const focused = document.activeElement?.id;
      draw();
      if (focused) document.getElementById(focused)?.focus();
    };
    refresh();
    window.addEventListener('ptctb:requests', refresh);
  }

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
      const arg = argField(s.item, titles);
      const value = arg.read(panelBox);
      if (value === null || value === '') {
        panelBox.querySelector('.shop-why').textContent = arg.missing;
        panelBox.querySelector(`#arg-${s.item}`).focus();
        return;
      }
      const select = panelBox.querySelector(`select#arg-${s.item}`);
      const choice = select ? select.selectedOptions[0].textContent : t('map {id}', { id: value });
      const kept = step.outerHTML;
      step.outerHTML = String(confirmStep(s, choice));
      panelBox.dataset.pick = kept;
      panelBox.dataset.value = String(value);
      panelBox.querySelector('[data-confirm]').focus();
      announce(t('Check the price, then confirm.'));
      return;
    }
    if (e.target.closest('[data-cancel]')) {
      panelBox.querySelector('.shop-confirm').outerHTML = panelBox.dataset.pick;
      panelBox.querySelector(`#arg-${s.item}`).value = panelBox.dataset.value;
      panelBox.querySelector(`#arg-${s.item}`).focus();
      return;
    }
    if (e.target.closest('[data-confirm]')) {
      const button = e.target.closest('[data-confirm]');
      button.disabled = true;
      const picked = panelBox.dataset.value;
      const value = /^\d+$/.test(picked) && s.item !== 'title' ? Number(picked) : picked;
      if (await sendRequest('shop.buy', { item: s.item, arg: value })) {
        open = null;
        requests = [{ type: 'shop.buy', payload: { item: s.item, arg: value }, status: 'pending', t: new Date().toISOString() }, ...requests];
        draw();
        document.getElementById(`head-${s.item}`)?.focus();
      } else button.disabled = false;
    }
  });
}
