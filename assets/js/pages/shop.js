// #/shop: what bananas buy (core/bananas.js SHOP, CURRENCY-DESIGN.md §5). Every purchase is a request the bot judges,
// like a bounty: the page shows the price, your wallet before and after, and what the bot said.

import { html, raw } from '../core/html.js';
import { playerHead, playerIndex } from '../core/data.js';
import { setTitle, pageHead, empty } from '../core/ui.js';
import { localBadge } from '../core/badges.js';
import { economy, session, bananas, SHOP, signInButton, sendRequest, myRequests, requestList, mapIdFrom } from '../core/bananas.js';
import { t } from '../core/i18n.js';

/** The colours a name or a Discord role can take: the site's own, by name (the bot maps them). */
const COLOURS = [['rosa', t('Rosa')], ['gold', t('Gold')], ['mint', t('Mint')], ['sky', t('Sky')], ['lilac', t('Lilac')], ['sand', t('Sand')]];

/** The extra thing an item needs, as a field: [label, input markup, read(form) → arg or null]. */
function argField(item, titles) {
  const id = `arg-${item}`;
  const select = options => html`<select class="select" id="${id}">${options.map(([v, label]) => html`<option value="${v}">${label}</option>`)}</select>`;
  const mapInput = html`<input class="input" id="${id}" placeholder="${t('Map id or osu! link')}" autocomplete="off">`;
  const value = form => form.querySelector(`#${id}`).value;
  switch (item) {
    case 'title': return titles.length ? [t('Which title'), select(titles), value] : [null, html`<p class="small muted">${t('You have no titles or badges to show yet.')}</p>`, () => null];
    case 'signature': return [t('The map of the play to pin'), mapInput, form => mapIdFrom(value(form))];
    case 'motw': return [t('The map to nominate'), mapInput, form => mapIdFrom(value(form))];
    case 'wildcard': return [t('The convert map for next month'), mapInput, form => mapIdFrom(value(form))];
    case 'colour': case 'role': return [t('Colour'), select(COLOURS), value];
    default: return [null, '', () => null];
  }
}

export default async function shop(root, { isCurrent }) {
  setTitle(t('Shop'));
  const me = session();
  const [eco, index, head] = await Promise.all([economy().catch(() => null), playerIndex(), me ? playerHead(me.id).catch(() => null) : null]);
  if (!isCurrent()) return;
  const w = me ? eco?.players?.[me.id] : null;
  // Titles you can show: your King of the hill titles and badges, in English for the bot, shown in your language.
  const titles = (head?.extras?.badges ?? []).map(b => [b.name, localBadge(b).name]);

  root.innerHTML = String(html`
    ${pageHead({ title: t('Shop'), intro: t('Cosmetics bought with bananas. What you spend here is burned: bananas are never bought, sold or turned into supporter.') })}
    ${!eco ? empty(t('Bananas haven’t started yet. The shop opens with them.')) : html`
      <section class="shop-wallet">
        ${!me ? html`<p class="muted">${t('Sign in with osu! to buy. You can look around first.')}</p><div class="btn-row">${signInButton()}</div>`
          : w ? html`<p>${t('Your wallet: {amount}', { amount: bananas(w.b) })} <a class="small" href="#/player/${me.id}">${t('See your wallet')}</a></p>`
            : html`<p class="muted">${t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`}
        <div id="shop-requests"></div>
      </section>
      <section class="section">
        <h2 class="sr-only">${t('Items')}</h2>
        <div class="rows shop-items">${SHOP.map(s => html`<div class="row shop-item">
          <div class="row-main"><b>${s.name}</b>
            <p class="small muted m-0">${s.about}${s.approval ? ` ${t('A moderator says yes first; if not, the bananas come back.')}` : ''}</p></div>
          <div class="shop-buy"><span class="shop-price">${bananas(s.price)}</span>
            ${w ? html`<button class="btn btn-small" type="button" data-buy="${s.item}" aria-expanded="false">${t('Buy…')}</button>` : ''}</div>
          <div class="shop-form" id="buy-${s.item}" hidden></div>
        </div>`)}</div>
      </section>`}
  `);
  if (!eco || !me) return;

  const box = root.querySelector('#shop-requests');
  const drawRequests = async () => {
    if (!isCurrent()) { window.removeEventListener('ptctb:requests', drawRequests); return; }
    const list = (await myRequests())?.filter(r => r.type === 'shop.buy');
    if (isCurrent() && list) box.innerHTML = String(list.length ? html`<h2 class="small-h">${t('Your purchases')}</h2>${requestList(list, index)}` : '');
  };
  drawRequests();
  window.addEventListener('ptctb:requests', drawRequests);

  root.querySelectorAll('[data-buy]').forEach(button => button.addEventListener('click', () => {
    const s = SHOP.find(x => x.item === button.dataset.buy);
    const form = root.querySelector(`#buy-${s.item}`);
    const opening = form.hidden;
    form.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
    if (!opening || form.dataset.ready) return;
    form.dataset.ready = '1';
    const [label, field, read] = argField(s.item, titles);
    const enough = w.b >= s.price;
    form.innerHTML = String(html`<form class="fund-row" novalidate>
      ${label ? html`<div class="field"><label for="arg-${s.item}">${label}</label>${field}</div>` : field}
      <button class="btn btn-small btn-primary" type="submit" ${enough ? '' : raw('disabled')}>${t('Buy for {price}', { price: bananas(s.price) })}</button>
      <p class="small muted">${enough ? t('Your wallet: {balance}, then {after}.', { balance: bananas(w.b), after: bananas(w.b - s.price) })
        : t('Your wallet has {balance}.', { balance: bananas(w.b) })}</p>
    </form>`);
    form.querySelector('input, select, button')?.focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const arg = read(form);
      if (label && arg === null) { form.querySelector('.muted').textContent = t('Add the map first.'); return; }
      if (await sendRequest('shop.buy', { item: s.item, arg })) { form.hidden = true; button.setAttribute('aria-expanded', 'false'); }
    });
  }));
}
